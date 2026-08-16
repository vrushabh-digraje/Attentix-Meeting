import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Chart, registerables } from 'chart.js';
import { ArrowLeft, Users, AlertOctagon } from 'lucide-react';
import { UserSession, MeetingSession } from '../App';

Chart.register(...registerables);

interface UsageReportProps {
    user: UserSession;
    meeting: MeetingSession;
    onReturnToMeeting: () => void;
}

interface ParticipantRecord {
    user_id: number;
    username: string;
    score: number;
    state: 'Attentive' | 'Distracted' | 'Inactive';
    warnings: number;
    lastActive: number;
    lowAttentionStart: number | null;
    alertTriggered: boolean;
}

interface DistractionLog {
    username: string;
    state: string;
    score: number;
    warnings: number;
    timestamp: string;
}

const UsageReport: React.FC<UsageReportProps> = ({ user, meeting, onReturnToMeeting }) => {
    const apiBase = window.location.origin;

    const trendCanvasRef = useRef<HTMLCanvasElement>(null);
    const stateCanvasRef = useRef<HTMLCanvasElement>(null);

    const trendChartRef = useRef<Chart | null>(null);
    const stateChartRef = useRef<Chart | null>(null);
    const socketRef = useRef<Socket | null>(null);

    // States
    const [participants, setParticipants] = useState<{ [key: number]: ParticipantRecord }>({});
    const [logs, setLogs] = useState<DistractionLog[]>([]);
    
    // Critical alert states
    const [criticalAlertStudent, setCriticalAlertStudent] = useState<string | null>(null);

    // Synthesize Host Alarm Tone
    const playHostAlarm = () => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) return;
            const audioCtx = new AudioContextClass();
            const now = audioCtx.currentTime;
            
            [now, now + 0.3].forEach((start) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.frequency.setValueAtTime(880, start); // high pitch alarm tone
                gain.gain.setValueAtTime(0.2, start);
                osc.start(start);
                osc.stop(start + 0.2);
            });
        } catch (e) {
            console.warn('Host audio alarm blocked');
        }
    };

    // 1. Initialize Sockets & Charts
    useEffect(() => {
        // Initialize Trend line chart
        if (trendCanvasRef.current) {
            trendChartRef.current = new Chart(trendCanvasRef.current, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Average Attention Score (%)',
                        data: [],
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.05)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 2,
                        pointBackgroundColor: '#06b6d4'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                        y: { min: 0, max: 100, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }

        // Initialize State distribution doughnut chart
        if (stateCanvasRef.current) {
            stateChartRef.current = new Chart(stateCanvasRef.current, {
                type: 'doughnut',
                data: {
                    labels: ['Attentive', 'Distracted', 'Inactive'],
                    datasets: [{
                        data: [0, 0, 0],
                        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                        borderWidth: 1,
                        borderColor: '#1e1e21'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#94a3b8', font: { size: 10 } }
                        }
                    },
                    cutout: '70%'
                }
            });
        }

        // Connect Socket
        const socket = io(apiBase);
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Host Usage reports portal active.');
            socket.emit('join-room', {
                meeting_id: meeting.meetingId,
                user_id: user.id,
                username: user.username
            });
        });

        // Listen for real-time focus log updates
        socket.on('attention-update', (data: any) => {
            setParticipants(prev => {
                const previousRecord = prev[data.user_id];
                let lowAttentionStart = previousRecord ? previousRecord.lowAttentionStart : null;
                let alertTriggered = previousRecord ? previousRecord.alertTriggered : false;

                // 3 minutes focus drop alarm: check < 30% focus
                if (data.attention_score < 30) {
                    if (!lowAttentionStart) {
                        lowAttentionStart = Date.now();
                    } else if (Date.now() - lowAttentionStart >= 180000 && !alertTriggered) { // 180,000ms = 3 mins
                        alertTriggered = true;
                        setCriticalAlertStudent(data.username);
                        playHostAlarm();
                    }
                } else {
                    lowAttentionStart = null;
                    alertTriggered = false;
                }

                const updated = {
                    ...prev,
                    [data.user_id]: {
                        user_id: data.user_id,
                        username: data.username,
                        score: data.attention_score,
                        state: data.state,
                        warnings: data.warnings_count,
                        lastActive: Date.now(),
                        lowAttentionStart,
                        alertTriggered
                    }
                };

                // Update Doughnut states dynamically on data arrival
                updateDoughnutStates(Object.values(updated));
                return updated;
            });

            // Write logs if focus is not Attentive
            if (data.state !== 'Attentive') {
                const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                setLogs(prev => [
                    {
                        username: data.username,
                        state: data.state,
                        score: data.attention_score,
                        warnings: data.warnings_count,
                        timestamp: nowStr
                    },
                    ...prev.slice(0, 29) // cap logs at 30 rows
                ]);
            }
        });

        // Peer disconnected
        socket.on('peer-left', (data: any) => {
            const peerId = data.user_id;
            setParticipants(prev => {
                const copy = { ...prev };
                delete copy[peerId];
                updateDoughnutStates(Object.values(copy));
                return copy;
            });
        });

        return () => {
            socket.disconnect();
            if (trendChartRef.current) trendChartRef.current.destroy();
            if (stateChartRef.current) stateChartRef.current.destroy();
        };
    }, [meeting.meetingId]);

    // 2. Periodically update the trend line chart (every 3 seconds)
    useEffect(() => {
        const interval = setInterval(() => {
            const pList = Object.values(participants);
            if (pList.length === 0 || !trendChartRef.current) return;

            const totalScore = pList.reduce((acc, curr) => acc + curr.score, 0);
            const avg = Math.round(totalScore / pList.length);
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const chart = trendChartRef.current;
            chart.data.labels?.push(timeStr);
            chart.data.datasets[0].data.push(avg);

            if (chart.data.labels && chart.data.labels.length > 20) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }
            chart.update();
        }, 3000);

        return () => clearInterval(interval);
    }, [participants]);

    const updateDoughnutStates = (records: ParticipantRecord[]) => {
        if (!stateChartRef.current) return;
        
        let attentive = 0;
        let distracted = 0;
        let inactive = 0;

        records.forEach(p => {
            if (p.state === 'Attentive') attentive++;
            else if (p.state === 'Distracted') distracted++;
            else inactive++;
        });

        stateChartRef.current.data.datasets[0].data = [attentive, distracted, inactive];
        stateChartRef.current.update();
    };

    // Remove Participant (Emit kick signal to server)
    const handleRemoveParticipant = (peerId: number, peerName: string) => {
        if (confirm(`Are you sure you want to remove ${peerName} from the meeting?`)) {
            if (socketRef.current) {
                socketRef.current.emit('kick-participant', {
                    meeting_id: meeting.meetingId,
                    user_id: peerId
                });
            }
            setParticipants(prev => {
                const copy = { ...prev };
                delete copy[peerId];
                updateDoughnutStates(Object.values(copy));
                return copy;
            });
        }
    };

    const handleDownloadCSV = () => {
        const activeList = Object.values(participants);
        if (activeList.length === 0) {
            alert("No participant data available to download.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Add header info
        csvContent += `Attentix Classroom Engagement Report\n`;
        csvContent += `Meeting ID,${meeting.roomCode}\n`;
        csvContent += `Date,${new Date().toLocaleDateString()}\n`;
        csvContent += `Total Participants,${activeList.length}\n`;
        csvContent += `Average Classroom Attention,${avgScore}%\n\n`;
        
        // Add table headers
        csvContent += `Participant Name,Attention Score (%),State,Warnings Count,Last Active Time\n`;
        
        // Add row data
        activeList.forEach(p => {
            const timeStr = new Date(p.lastActive).toLocaleTimeString();
            csvContent += `"${p.username}",${p.score}%,${p.state},${p.warnings},"${timeStr}"\n`;
        });

        // Append distraction incidents log if available
        if (logs.length > 0) {
            csvContent += `\nDistraction Incidents Log\n`;
            csvContent += `Student,Incident State,Attention Score,Warnings,Timestamp\n`;
            logs.forEach(log => {
                csvContent += `"${log.username}",${log.state},${log.score}%,${log.warnings},"${log.timestamp}"\n`;
            });
        }

        // Create download link and click it
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Attentix_Report_${meeting.roomCode}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadHTML = () => {
        const activeList = Object.values(participants);
        if (activeList.length === 0) {
            alert("No participant data available to download.");
            return;
        }

        let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Attentix Classroom Engagement Report - ${meeting.roomCode}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #000000; color: #E2E8F0; margin: 0; padding: 40px; }
        .container { max-width: 800px; margin: 0 auto; background: #090A0F; border: 1px solid #1A1D2D; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.7); }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00F2FE; padding-bottom: 20px; margin-bottom: 30px; }
        .title { font-size: 24px; font-weight: 800; color: #00F2FE; margin: 0; }
        .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 30px; }
        .meta-card { background: #0C0D15; border: 1px solid #1A1D2D; padding: 15px; border-radius: 8px; }
        .meta-label { font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; }
        .meta-val { font-size: 20px; font-weight: 800; color: #00F2FE; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #1A1D2D; }
        th { font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; background: #0C0D15; letter-spacing: 0.05em; }
        td { font-size: 13px; font-weight: 500; }
        .status-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .status-attentive { background: rgba(16, 185, 129, 0.15); color: #10B981; }
        .status-distracted { background: rgba(245, 158, 11, 0.15); color: #F59E0B; }
        .status-inactive { background: rgba(239, 68, 68, 0.15); color: #EF4444; }
        .print-btn { display: block; width: 100%; text-align: center; margin-top: 40px; padding: 12px; background: #00F2FE; color: #000000; border: none; border-radius: 6px; font-weight: 800; cursor: pointer; font-size: 13px; transition: background 0.2s; text-transform: uppercase; }
        .print-btn:hover { background: #05B6D4; }
        @media print { .print-btn { display: none; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1 class="title">Attentix Engagement Report</h1>
                <p style="margin: 4px 0 0 0; color: #57534E; font-size: 12px;">Classroom focus & attention analysis</p>
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 800; font-size: 14px; color: #1C1917;">Room: ${meeting.roomCode}</div>
                <div style="color: #57534E; font-size: 11px; margin-top: 2px;">Date: ${new Date().toLocaleDateString()}</div>
            </div>
        </div>
        
        <div class="meta-grid">
            <div class="meta-card">
                <span class="meta-label">Total Participants</span>
                <div class="meta-val">${activeList.length}</div>
            </div>
            <div class="meta-card">
                <span class="meta-label">Average Classroom Attention</span>
                <div class="meta-val" style="color: ${avgScore >= 75 ? '#15803D' : (avgScore >= 45 ? '#CA8A04' : '#BE123C')};">${avgScore}%</div>
            </div>
        </div>

        <h3 style="font-size: 14px; font-weight: 800; margin-bottom: 10px; color: #1C1917;">Participant Engagement Matrix</h3>
        <table>
            <thead>
                <tr>
                    <th>Participant Name</th>
                    <th>Average Score</th>
                    <th>Engagement State</th>
                    <th>Warnings Triggered</th>
                    <th>Last Active Time</th>
                </tr>
            </thead>
            <tbody>
        `;

        activeList.forEach(p => {
            const timeStr = new Date(p.lastActive).toLocaleTimeString();
            let stateClass = "status-attentive";
            if (p.state === "Distracted") stateClass = "status-distracted";
            else if (p.state === "Inactive") stateClass = "status-inactive";

            htmlContent += `
                <tr>
                    <td style="font-weight: 700; color: #1C1917;">${p.username}</td>
                    <td style="font-weight: 800; color: ${p.score >= 75 ? '#15803D' : (p.score >= 45 ? '#CA8A04' : '#BE123C')};">${p.score}%</td>
                    <td><span class="status-badge ${stateClass}">${p.state}</span></td>
                    <td style="color: #57534E;">${p.warnings} / 3</td>
                    <td style="font-family: monospace; font-size: 11px; color: #57534E;">${timeStr}</td>
                </tr>
            `;
        });

        htmlContent += `
            </tbody>
        </table>
        `;

        if (logs.length > 0) {
            htmlContent += `
            <h3 style="font-size: 14px; font-weight: 800; margin-top: 40px; margin-bottom: 10px; color: #1C1917;">Distraction Incidents Log</h3>
            <table>
                <thead>
                    <tr>
                        <th>Student</th>
                        <th>Incident State</th>
                        <th>Attention Score</th>
                        <th>Warnings</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
            `;

            logs.forEach(log => {
                let stateClass = "status-distracted";
                if (log.state === "Inactive") stateClass = "status-inactive";

                htmlContent += `
                    <tr>
                        <td style="font-weight: 700; color: #1C1917;">${log.username}</td>
                        <td><span class="status-badge ${stateClass}">${log.state}</span></td>
                        <td style="font-weight: 800; color: #1C1917;">${log.score}%</td>
                        <td style="color: #57534E;">${log.warnings} / 3</td>
                        <td style="font-family: monospace; font-size: 11px; color: #57534E;">${log.timestamp}</td>
                    </tr>
                `;
            });

            htmlContent += `
                </tbody>
            </table>
            `;
        }

        htmlContent += `
        <button class="print-btn" onclick="window.print()">Print or Save as PDF</button>
    </div>
</body>
</html>
        `;

        const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", `Attentix_Report_${meeting.roomCode}.html`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const activeList = Object.values(participants);
    const avgScore = activeList.length > 0 
        ? Math.round(activeList.reduce((acc, curr) => acc + curr.score, 0) / activeList.length) 
        : 0;

    return (
        <div className="bg-zoomDarkBg text-zoomText min-h-screen flex flex-col font-sans">
            
            {/* Navigation header */}
            <nav className="flex justify-between items-center px-8 py-4 border-b border-zoomBorder bg-zoomControlBar backdrop-blur-md sticky top-0 z-50">
                <div className="text-xl font-black text-zoomBlue flex items-center">
                    Attentix<span className="text-xs text-zoomTextSec font-normal ml-3">Usage & Attention Reports</span>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleDownloadHTML}
                        className="flex items-center gap-1.5 px-4 py-2 bg-zoomBlue hover:bg-zoomBlueHover text-white font-semibold rounded-lg text-xs transition-all shadow-md"
                    >
                        📥 Download PDF/HTML Report
                    </button>
                    <button 
                        onClick={handleDownloadCSV}
                        className="flex items-center gap-1.5 px-4 py-2 bg-zoomControlBar border border-zoomBorder hover:bg-slate-200 text-zoomText font-semibold rounded-lg text-xs transition-all"
                    >
                        📄 Download CSV
                    </button>
                    <button 
                        onClick={onReturnToMeeting}
                        className="flex items-center gap-1 px-4 py-2 bg-zoomControlBar border border-zoomBorder hover:bg-slate-200 text-zoomText font-semibold rounded-lg text-xs transition-all"
                    >
                        <ArrowLeft size={12} /> Return to Room
                    </button>
                    <span className="bg-zoomControlBar border border-zoomBorder px-4 py-1.5 rounded-full text-xs text-zoomTextSec font-medium">
                        Host
                    </span>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto py-10 px-6 w-full flex-grow flex flex-col gap-8">
                
                {/* 2-Column Grid Layout: Left sidebar (scoreboard) vs Right content */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
                    
                    {/* 📋 LEFT SIDEBAR PANEL: Participant Name & Attention Score Only */}
                    <div className="lg:col-span-1 bg-zoomPanel border border-zoomBorder p-6 rounded-2xl flex flex-col gap-4 lg:sticky lg:top-24 max-h-[calc(100vh-140px)] overflow-y-auto shadow-sm">
                        <h3 className="text-[10px] font-bold text-zoomTextSec uppercase tracking-widest mb-2 flex items-center gap-2 pb-3 border-b border-zoomBorder">
                            <Users size={12} /> Live Scoreboard
                        </h3>
                        
                        <div className="flex flex-col gap-3">
                            {activeList.length === 0 ? (
                                <span className="text-zoomTextSec text-xs">No active participants.</span>
                            ) : (
                                activeList.map(p => {
                                    let colorClass = 'text-stateGreen';
                                    let bgClass = 'bg-stateGreen/10';
                                    if (p.state === 'Distracted') {
                                        colorClass = 'text-stateYellow';
                                        bgClass = 'bg-stateYellow/10';
                                    } else if (p.state === 'Inactive') {
                                        colorClass = 'text-stateRed';
                                        bgClass = 'bg-stateRed/10';
                                    }

                                    return (
                                        <div key={p.user_id} className="flex justify-between items-center bg-zoomCard border border-zoomBorder px-4 py-2.5 rounded-xl text-xs font-semibold">
                                            <span className="text-zoomText font-bold">{p.username}</span>
                                            <span className={`px-2 py-0.5 rounded ${bgClass} ${colorClass}`}>{p.score}%</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Charts, Details, Logs */}
                    <div className="lg:col-span-3 flex flex-col gap-8">
                        
                        {/* Summary Stats Header */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                            <div>
                                <h2 className="text-2xl font-extrabold tracking-tight text-zoomText">Meeting Room Dashboard</h2>
                                <p className="text-zoomTextSec text-xs mt-1">Classroom engagement metrics & continuous attention analysis.</p>
                            </div>
                            
                            <div className="flex gap-4 w-full sm:w-auto">
                                <div className="glass-panel px-5 py-3 rounded-xl flex-grow sm:flex-grow-0 text-center min-w-[120px]">
                                    <span className="text-[9px] font-semibold text-zoomTextSec uppercase tracking-wider block">Active Users</span>
                                    <h3 className="text-2xl font-extrabold text-zoomBlue mt-0.5">{activeList.length}</h3>
                                </div>
                                <div className="glass-panel px-5 py-3 rounded-xl flex-grow sm:flex-grow-0 text-center min-w-[120px]">
                                    <span className="text-[9px] font-semibold text-zoomTextSec uppercase tracking-wider block">Average Attention</span>
                                    <h3 className={`text-2xl font-extrabold mt-0.5 ${avgScore >= 75 ? 'text-stateGreen' : (avgScore >= 45 ? 'text-stateYellow' : 'text-stateRed')}`}>{avgScore}%</h3>
                                </div>
                            </div>
                        </div>

                        {/* Chart Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-[300px]">
                                <h3 className="text-xs font-bold text-zoomTextSec uppercase tracking-wider mb-2">Class Attention Trend</h3>
                                <div className="relative flex-grow h-[200px]">
                                    <canvas ref={trendCanvasRef}></canvas>
                                </div>
                            </div>
                            <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-[300px]">
                                <h3 className="text-xs font-bold text-zoomTextSec uppercase tracking-wider mb-2">State Distribution</h3>
                                <div className="relative flex-grow h-[200px] flex justify-center">
                                    <canvas ref={stateCanvasRef}></canvas>
                                </div>
                            </div>
                        </div>

                        {/* Detailed Participant Cards Grid */}
                        <div>
                            <h3 className="text-sm font-bold text-zoomTextSec uppercase tracking-wider mb-4">Detailed Participant Matrix</h3>
                            {activeList.length === 0 ? (
                                <div className="glass-panel py-12 rounded-2xl text-center text-xs text-zoomTextSec">
                                    No active participants connected.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                                    {activeList.map(p => {
                                        let borderClass = 'border-stateGreen/40 hover:border-stateGreen';
                                        let scoreColor = 'text-stateGreen';
                                        let dotColor = 'bg-stateGreen';
                                        
                                        if (p.state === 'Distracted') {
                                            borderClass = 'border-stateYellow/40 hover:border-stateYellow';
                                            scoreColor = 'text-stateYellow';
                                            dotColor = 'bg-stateYellow';
                                        } else if (p.state === 'Inactive') {
                                            borderClass = 'border-stateRed/40 hover:border-stateRed';
                                            scoreColor = 'text-stateRed';
                                            dotColor = 'bg-stateRed';
                                        }

                                        return (
                                            <div key={p.user_id} className={`glass-panel p-5 rounded-xl border-2 ${borderClass} relative flex flex-col items-center text-center transition-all duration-300`}>
                                                <div className={`absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${dotColor}`}></div>
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-zoomBlue to-amber-500 flex items-center justify-center text-white font-extrabold text-lg mb-3 shadow-md">
                                                    {p.username.charAt(0).toUpperCase()}
                                                </div>
                                                <h4 className="font-bold text-sm text-zoomText">{p.username}</h4>
                                                <p className="text-[10px] text-zoomTextSec mt-0.5">State: <strong className={scoreColor}>{p.state}</strong></p>
                                                <div className={`text-2xl font-black ${scoreColor} mt-2.5`}>{p.score}%</div>
                                                <p className="text-[9px] text-zoomTextSec mt-0.5">Warnings: {p.warnings}/3</p>
                                                <button 
                                                    onClick={() => handleRemoveParticipant(p.user_id, p.username)}
                                                    className="mt-4 w-full py-1.5 border border-stateRed/40 hover:bg-stateRed hover:text-white rounded-lg text-[10px] font-bold text-stateRed bg-transparent transition-all"
                                                >
                                                    Remove Participant
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Logs Table */}
                        <div className="glass-panel p-6 rounded-2xl">
                            <h3 className="text-xs font-bold text-zoomTextSec uppercase tracking-wider mb-4">Distraction Logs</h3>
                            
                            <div className="overflow-x-auto w-full">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-zoomBorder text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider">
                                            <th className="py-2.5 px-4">Student</th>
                                            <th className="py-2.5 px-4">Incident State</th>
                                            <th className="py-2.5 px-4">Attention Score</th>
                                            <th className="py-2.5 px-4">Warnings</th>
                                            <th className="py-2.5 px-4">Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zoomBorder text-xs">
                                        {logs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-6 text-center text-zoomTextSec text-[11px]">No focus alert events logged.</td>
                                            </tr>
                                        ) : (
                                            logs.map((log, idx) => {
                                                let badgeColor = 'bg-stateRed/10 text-stateRed border-stateRed/20';
                                                if (log.state === 'Distracted') badgeColor = 'bg-stateYellow/10 text-stateYellow border-stateYellow/20';

                                                return (
                                                    <tr key={idx} className="hover:bg-zoomControlBar/40 transition-all">
                                                        <td className="py-2.5 px-4 font-bold text-zoomText">{log.username}</td>
                                                        <td className="py-2.5 px-4">
                                                            <span className={`border px-2 py-0.5 rounded text-[10px] font-semibold ${badgeColor}`}>{log.state}</span>
                                                        </td>
                                                        <td className="py-2.5 px-4 font-bold text-zoomText">{log.score}%</td>
                                                        <td className="py-2.5 px-4 text-zoomTextSec">{log.warnings}/3</td>
                                                        <td className="py-2.5 px-4 text-zoomTextSec font-mono text-[10px]">{log.timestamp}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>

            </div>

            {/* Critical Alarm Modal Popup Overlay */}
            {criticalAlertStudent && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="glass-panel p-8 rounded-2xl border border-stateRed shadow-2xl shadow-stateRed/25 max-w-sm w-full text-center mx-4">
                        <div className="w-14 h-14 rounded-full bg-stateRed/15 text-stateRed flex items-center justify-center text-2xl mx-auto mb-4 animate-ping">
                            <AlertOctagon />
                        </div>
                        <h3 className="text-stateRed font-extrabold text-xl tracking-wide mb-3">CRITICAL ALERT</h3>
                        <p className="text-zoomText leading-relaxed text-xs mb-6">
                            Participant <strong>{criticalAlertStudent}</strong>'s attention score has dropped below <strong>30%</strong> for more than <strong>3 minutes</strong>!
                        </p>
                        <button 
                            onClick={() => setCriticalAlertStudent(null)}
                            className="w-full py-2.5 rounded-lg bg-stateRed hover:bg-red-600 text-white font-bold transition-all text-sm"
                        >
                            Acknowledge Alert
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UsageReport;
