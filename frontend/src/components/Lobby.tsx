import React, { useState, useEffect } from 'react';
import { Video, LogOut, Clock, Calendar, BarChart3, Users, ChevronRight, RotateCcw } from 'lucide-react';
import { UserSession, MeetingSession } from '../App';

interface LobbyProps {
    user: UserSession;
    onLogout: () => void;
    onEnterMeeting: (session: MeetingSession) => void;
    onViewReport: (session: MeetingSession) => void;
}

const Lobby: React.FC<LobbyProps> = ({ user, onLogout, onEnterMeeting, onViewReport }) => {
    const rawUrl = (import.meta as any).env.VITE_API_URL || '';
    const rawApiBase = (rawUrl.includes('render.com') || !rawUrl)
        ? 'https://vrushabhdigraje09--attentix-backend-attentix-app.modal.run'
        : rawUrl;
    const apiBase = rawApiBase.endsWith('/') ? rawApiBase.slice(0, -1) : rawApiBase;

    const [roomCodeInput, setRoomCodeInput] = useState<string>('');
    const [time, setTime] = useState<string>('');
    const [date, setDate] = useState<string>('');

    // Schedule meeting states
    const [scheduledMeetings, setScheduledMeetings] = useState<any[]>([]);
    const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
    const [scheduleTopic, setScheduleTopic] = useState<string>('');
    const [scheduleDate, setScheduleDate] = useState<string>('');
    const [scheduleTime, setScheduleTime] = useState<string>('');
    const [scheduleDuration, setScheduleDuration] = useState<number>(40);

    // Request progress states to prevent freezes and multi-clicks
    const [isCreatingMeeting, setIsCreatingMeeting] = useState<boolean>(false);
    const [isJoiningMeeting, setIsJoiningMeeting] = useState<boolean>(false);
    const [isSchedulingMeeting, setIsSchedulingMeeting] = useState<boolean>(false);
    const [isStartingDueMeeting, setIsStartingDueMeeting] = useState<boolean>(false);

    const [pastMeetings, setPastMeetings] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
    const [autoEnd20Min, setAutoEnd20Min] = useState<boolean>(() => localStorage.getItem('attentix_auto_end_20min') !== 'false');

    const toggleAutoEnd20Min = () => {
        const next = !autoEnd20Min;
        setAutoEnd20Min(next);
        localStorage.setItem('attentix_auto_end_20min', String(next));
    };

    const loadPastMeetings = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`${apiBase}/api/meetings/history/${user.id}`);
            if (res.ok) {
                const data = await res.json();
                setPastMeetings(data);
            }
        } catch (e) {
            console.error('Failed to load past meetings history:', e);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const loadScheduledMeetings = async () => {
        try {
            const res = await fetch(`${apiBase}/api/meetings/scheduled/${user.id}`);
            if (res.ok) {
                const data = await res.json();
                setScheduledMeetings(data);
            }
        } catch (e) {
            console.error('Failed to load scheduled meetings:', e);
        }
    };

    // Real-Time Clock, Scheduled meetings load & Past meetings history load
    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setDate(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
        };
        updateClock();
        const interval = setInterval(updateClock, 1000);
        
        loadScheduledMeetings();
        loadPastMeetings();
        
        return () => clearInterval(interval);
    }, [user.id]);

    const [dueMeeting, setDueMeeting] = useState<any | null>(null);

    // Check if scheduled meetings are due (every 10 seconds)
    useEffect(() => {
        if (scheduledMeetings.length === 0) return;

        const checkDueMeetings = () => {
            const now = new Date();
            const due = scheduledMeetings.find(m => {
                const schedTime = new Date(m.scheduled_time);
                const diffMs = now.getTime() - schedTime.getTime();
                return diffMs >= -60000 && diffMs <= 900000;
            });

            if (due) {
                if (!dueMeeting || dueMeeting.meeting_number !== due.meeting_number) {
                    setDueMeeting(due);
                }
            } else {
                setDueMeeting(null);
            }
        };

        checkDueMeetings();
        const checkInterval = setInterval(checkDueMeetings, 10000);
        return () => clearInterval(checkInterval);
    }, [scheduledMeetings, dueMeeting]);

    const handleCreateMeeting = async () => {
        if (isCreatingMeeting) return;
        setIsCreatingMeeting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
            const res = await fetch(`${apiBase}/api/meetings/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_id: user.id }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to create meeting');

            onEnterMeeting({
                roomCode: data.meeting_number,
                meetingId: data.meeting_id,
                role: 'host'
            });
        } catch (err: any) {
            if (err.name === 'AbortError') {
                alert('Meeting Creation timed out. Please verify your connection.');
            } else {
                alert('Meeting Creation Failed: ' + err.message);
            }
        } finally {
            clearTimeout(timeoutId);
            setIsCreatingMeeting(false);
        }
    };

    const handleJoinMeeting = async () => {
        if (isJoiningMeeting) return;
        const cleanedCode = roomCodeInput.replace(/\D/g, '');
        if (cleanedCode.length !== 9) {
            alert('Please enter a valid 9-digit Room Code (e.g. 123456789)');
            return;
        }

        setIsJoiningMeeting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
            const res = await fetch(`${apiBase}/api/meetings/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meeting_number: cleanedCode, user_id: user.id }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 404) {
                    throw new Error('This meeting is not active. Either the host has not started it yet or the 9-digit code is incorrect.');
                }
                throw new Error(data.detail || 'Failed to join meeting. Confirm code is active.');
            }

            onEnterMeeting({
                roomCode: data.meeting_number,
                meetingId: data.meeting_id,
                role: 'participant'
            });
        } catch (err: any) {
            if (err.name === 'AbortError') {
                alert('Join Request timed out. Please check your internet connection.');
            } else {
                alert('Cannot Join Meeting: ' + err.message);
            }
        } finally {
            clearTimeout(timeoutId);
            setIsJoiningMeeting(false);
        }
    };

    const handleScheduleMeeting = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSchedulingMeeting) return;
        const localDate = new Date(`${scheduleDate}T${scheduleTime}`);
        if (isNaN(localDate.getTime())) {
            alert('Please select a valid date and time.');
            return;
        }
        const combinedDateTime = localDate.toISOString();

        setIsSchedulingMeeting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
            const res = await fetch(`${apiBase}/api/meetings/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host_id: user.id,
                    topic: scheduleTopic,
                    scheduled_time: combinedDateTime,
                    duration: Number(scheduleDuration)
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to schedule meeting');

            alert(`Meeting scheduled successfully! Meeting ID: ${data.meeting_number}`);
            setShowScheduleModal(false);
            setScheduleTopic('');
            setScheduleDate('');
            setScheduleTime('');
            loadScheduledMeetings();
        } catch (err: any) {
            if (err.name === 'AbortError') {
                alert('Scheduling request timed out. Please check your connection.');
            } else {
                alert('Cannot Schedule Meeting: ' + err.message);
            }
        } finally {
            clearTimeout(timeoutId);
            setIsSchedulingMeeting(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen premium-bg text-zoomText font-sans">
            {/* Nav Header */}
            <nav className="flex justify-between items-center px-8 py-3 bg-zoomControlBar/80 backdrop-blur-md border-b border-zoomBorder sticky top-0 z-50">
                <div className="text-xl font-black gradient-text-blue">
                    Attentix
                </div>
                <div className="flex items-center gap-3">
                    <span className="bg-zoomCard/60 border border-zoomBorder px-3 py-1 rounded-full text-xs text-zoomTextSec font-semibold">
                        {user.username}
                    </span>
                    <button 
                        onClick={onLogout} 
                        className="flex items-center gap-1 border border-zoomBorder hover:border-red-500/30 text-zoomTextSec hover:text-stateRed px-3 py-1 rounded-md text-xs font-semibold transition-all"
                    >
                        <LogOut size={12} /> Logout
                    </button>
                </div>
            </nav>

            {/* Hub Area */}
            <div className="max-w-4xl mx-auto py-16 px-6 w-full flex-grow flex flex-col justify-center">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-8 w-full items-stretch">
                    
                    {/* Action Cards */}
                    <div className="md:col-span-3 glass-panel p-8 rounded-2xl flex flex-col justify-between shadow-2xl relative overflow-hidden">
                        {/* Gradient corner glow */}
                        <div className="absolute -top-12 -right-12 w-24 h-24 bg-zoomBlue/10 rounded-full blur-2xl"></div>
                        
                        <div className="z-10">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xs font-bold text-zoomTextSec uppercase tracking-widest">Start or Join Meeting</h3>
                                <button 
                                    onClick={toggleAutoEnd20Min}
                                    className={`text-[10px] px-2.5 py-1 rounded-full border transition-all flex items-center gap-1.5 font-bold ${
                                        autoEnd20Min
                                            ? 'bg-zoomBlue/15 text-zoomBlue border-zoomBlue/40 hover:bg-zoomBlue/25'
                                            : 'bg-zoomBorder/30 text-zoomTextSec border-zoomBorder hover:text-zoomText'
                                    }`}
                                    title={autoEnd20Min ? "20-minute auto-end with prompt is ON. Click to toggle OFF." : "20-minute auto-end is OFF. Click to toggle ON."}
                                >
                                    <Clock size={11} className={autoEnd20Min ? "text-zoomBlue" : "text-zoomTextSec"} />
                                    <span>20m Limit:</span>
                                    <span className={autoEnd20Min ? "text-stateGreen font-extrabold" : "text-stateRed font-extrabold"}>
                                        {autoEnd20Min ? "ON" : "OFF"}
                                    </span>
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={handleCreateMeeting}
                                    disabled={isCreatingMeeting}
                                    className={`flex flex-col items-center justify-center p-6 btn-premium-orange rounded-xl transition-all shadow-lg group premium-glow-orange ${isCreatingMeeting ? 'opacity-70 cursor-not-allowed' : ''}`}
                                >
                                    {isCreatingMeeting ? (
                                        <>
                                            <svg className="animate-spin h-8 w-8 text-white mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span className="text-xs font-bold text-white">Starting Room...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Video size={36} className="text-white mb-3 group-hover:scale-105 transition-all duration-300" />
                                            <span className="text-xs font-bold text-white">New Meeting</span>
                                        </>
                                    )}
                                </button>

                                <button 
                                    onClick={() => setShowScheduleModal(true)}
                                    className="flex flex-col items-center justify-center p-6 premium-card rounded-xl transition-all shadow-md group"
                                >
                                    <Calendar size={36} className="text-zoomBlue mb-3 group-hover:scale-105 transition-all duration-300" />
                                    <span className="text-xs font-bold text-zoomText">Schedule</span>
                                </button>
                            </div>

                            <div className="mt-6 flex flex-col gap-2">
                                <input 
                                    type="text" 
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={roomCodeInput}
                                    onChange={e => setRoomCodeInput(e.target.value)}
                                    placeholder="Enter 9-Digit Meeting ID" 
                                    maxLength={9} 
                                    className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-zoomBorder text-zoomText outline-none focus:border-zoomBlue text-center text-sm font-mono tracking-widest transition-all"
                                />
                                <button 
                                    onClick={handleJoinMeeting}
                                    disabled={isJoiningMeeting}
                                    className={`w-full py-2.5 btn-premium-blue text-white text-xs font-extrabold rounded-lg transition-all shadow-lg flex items-center justify-center gap-2 ${isJoiningMeeting ? 'opacity-70 cursor-not-allowed' : ''}`}
                                >
                                    {isJoiningMeeting ? (
                                        <>
                                            <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>Connecting to Room...</span>
                                        </>
                                    ) : "Join Meeting"}
                                </button>
                            </div>
                        </div>
                        
                        <div className="border-t border-zoomBorder mt-8 pt-4 text-[10px] text-zoomTextSec z-10">
                            💡 Invite links bypass typing code. Copy link from meeting to invite peers directly.
                        </div>
                    </div>

                    {/* Clock & Calendar Panel */}
                    <div className="md:col-span-2 glass-panel p-8 rounded-2xl flex flex-col justify-between items-center text-center shadow-2xl relative overflow-hidden">
                        {/* Gradient corner glow */}
                        <div className="absolute -bottom-12 -left-12 w-24 h-24 bg-zoomBlue/5 rounded-full blur-2xl"></div>
                        <div className="w-full z-10">
                            <Clock className="text-zoomBlue mx-auto mb-2 animate-pulse" size={24} />
                            <div className="text-4xl font-extrabold tracking-tight gradient-text-blue">{time}</div>
                            <div className="text-[10px] font-semibold text-zoomBlue mt-2 uppercase tracking-widest">{date}</div>
                        </div>
                        
                        <div className="w-full border-t border-zoomBorder pt-6 mt-6">
                            <div className="text-left text-xs text-zoomTextSec">
                                <span className="block font-bold text-zoomText mb-2 flex items-center gap-1">
                                    <Calendar size={12} /> Upcoming Events
                                </span>
                                
                                {scheduledMeetings.length === 0 ? (
                                    <div className="bg-zoomCard/40 border border-zoomBorder p-3 rounded-lg text-center">
                                        <p className="font-bold text-zoomText text-[10px]">No upcoming meetings scheduled</p>
                                        <p className="text-[9px] text-slate-500 mt-0.5">Host meetings and view analytics in reports.</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                                        {scheduledMeetings.map(m => {
                                            const mDate = new Date(m.scheduled_time);
                                            return (
                                                <div key={m.id} className="bg-zoomCard/80 border border-zoomBorder p-3 rounded-lg flex flex-col gap-1 hover:border-zoomBlue transition-all">
                                                    <div className="flex justify-between items-start">
                                                        <span className="font-bold text-zoomText text-[10px] truncate max-w-[120px]">{m.topic}</span>
                                                        <span className="text-[8px] bg-zoomBlue/20 text-zoomBlue px-1.5 py-0.5 rounded font-mono font-semibold">{m.meeting_number}</span>
                                                    </div>
                                                    <div className="text-[9px] text-slate-500 flex justify-between items-center mt-1">
                                                        <span>{mDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} @ {mDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span>{m.duration}m</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                </div>

                {/* Previous Meeting Reports & Session History */}
                <div className="mt-8 w-full">
                    <div className="glass-panel p-6 sm:p-8 rounded-2xl shadow-2xl relative overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-zoomBorder">
                            <div>
                                <h3 className="text-sm font-bold text-zoomText uppercase tracking-wider flex items-center gap-2">
                                    <BarChart3 size={18} className="text-zoomBlue" /> Previous Meeting Reports & Analytics
                                </h3>
                                <p className="text-[11px] text-zoomTextSec mt-0.5">
                                    Review saved attention scores, student warning counters, and engagement records from past meetings
                                </p>
                            </div>
                            <button 
                                onClick={loadPastMeetings}
                                disabled={isLoadingHistory}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zoomBorder hover:bg-white/10 text-[11px] text-zoomTextSec hover:text-white transition-all w-fit self-start sm:self-auto"
                                title="Refresh Meeting History"
                            >
                                <RotateCcw size={12} className={isLoadingHistory ? "animate-spin text-zoomBlue" : ""} />
                                <span>Refresh History</span>
                            </button>
                        </div>

                        {isLoadingHistory && pastMeetings.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center text-zoomTextSec text-xs">
                                <div className="w-8 h-8 rounded-full border-2 border-zoomBlue border-t-transparent animate-spin mb-3"></div>
                                <span>Loading previous session records...</span>
                            </div>
                        ) : pastMeetings.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center text-zoomTextSec text-xs">
                                <span className="text-3xl mb-2">📊</span>
                                <span className="font-semibold text-zoomText">No previous meeting reports found</span>
                                <span className="text-[11px] text-zoomTextSec/80 mt-1 max-w-sm">
                                    When you host or join meetings, the full session attention logs, scoreboard, and distraction reports will be stored permanently here.
                                </span>
                            </div>
                        ) : (
                            <div className="flex flex-col divide-y divide-zoomBorder/60 max-h-[380px] overflow-y-auto pr-1">
                                {pastMeetings.map((m) => {
                                    const startDate = new Date(m.start_time);
                                    const isHost = m.is_host;
                                    const avgScore = m.avg_attention_score || 0;

                                    let scoreBadgeColor = 'bg-stateGreen/15 text-stateGreen border-stateGreen/30';
                                    if (avgScore === 0) scoreBadgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
                                    else if (avgScore < 50) scoreBadgeColor = 'bg-stateRed/20 text-stateRed border-stateRed/40';
                                    else if (avgScore < 75) scoreBadgeColor = 'bg-stateYellow/20 text-stateYellow border-stateYellow/40';

                                    const formattedNumber = m.meeting_number && m.meeting_number.length === 9 
                                        ? `${m.meeting_number.slice(0,3)}-${m.meeting_number.slice(3,6)}-${m.meeting_number.slice(6,9)}`
                                        : m.meeting_number;

                                    return (
                                        <div 
                                            key={m.id}
                                            className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] rounded-xl px-2 transition-all group"
                                        >
                                            <div className="flex items-start sm:items-center gap-3.5">
                                                <div className="w-10 h-10 rounded-xl bg-zoomCard border border-zoomBorder flex items-center justify-center text-zoomBlue shrink-0 font-bold text-xs shadow-sm group-hover:border-zoomBlue/40 transition-colors">
                                                    <BarChart3 size={20} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-mono font-bold text-zoomText text-sm tracking-wider">
                                                            {formattedNumber}
                                                        </span>
                                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${isHost ? 'bg-zoomBlue/15 text-zoomBlue border-zoomBlue/30' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                                                            {isHost ? 'Host (You)' : `Host: ${m.host_username}`}
                                                        </span>
                                                        {m.is_active && (
                                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-stateGreen/20 text-stateGreen border border-stateGreen/40 flex items-center gap-1">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-stateGreen animate-pulse"></span>
                                                                Live
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 text-[11px] text-zoomTextSec mt-1 flex-wrap">
                                                        <span>📅 {startDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} @ {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span>⏱️ {m.duration_minutes} min{m.duration_minutes === 1 ? '' : 's'}</span>
                                                        <span>👥 {m.participants_count} Student{m.participants_count === 1 ? '' : 's'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 self-end sm:self-center">
                                                {avgScore > 0 && (
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[9px] uppercase tracking-wider text-zoomTextSec font-semibold">Avg Focus</span>
                                                        <span className={`text-xs font-black px-2 py-0.5 rounded border ${scoreBadgeColor}`}>
                                                            {avgScore}%
                                                        </span>
                                                    </div>
                                                )}
                                                <button 
                                                    onClick={() => onViewReport({
                                                        meetingId: m.id,
                                                        roomCode: m.meeting_number,
                                                        role: isHost ? 'host' : 'participant',
                                                        isPast: true
                                                    })}
                                                    className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-zoomBlue hover:bg-zoomBlueHover text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 active:scale-95 group-hover:shadow-zoomBlue/20"
                                                >
                                                    <span>View Attention Report</span>
                                                    <ChevronRight size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Due Meeting Host Notification Toast */}
            {dueMeeting && (
                <div className="fixed top-20 right-6 w-80 bg-zoomPanel border-2 border-zoomBlue rounded-xl p-4 shadow-2xl z-50 animate-pulse">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold text-zoomBlue uppercase tracking-widest flex items-center gap-1">
                            🔔 Scheduled Meeting Due
                        </span>
                        <button onClick={() => setDueMeeting(null)} className="text-slate-400 hover:text-zoomText text-xs">✕</button>
                    </div>
                    <h4 className="text-xs font-bold text-zoomText mb-1 truncate">{dueMeeting.topic}</h4>
                    <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                        The scheduled start time for this meeting has arrived. Click below to activate and launch the session.
                    </p>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setDueMeeting(null)}
                            className="flex-1 py-1.5 bg-zoomBorder hover:bg-slate-200 text-zoomText text-[10px] font-bold rounded-lg transition-all"
                        >
                            Later
                        </button>
                        <button 
                            disabled={isStartingDueMeeting}
                            onClick={async () => {
                                if (isStartingDueMeeting) return;
                                setIsStartingDueMeeting(true);
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 25000);
                                try {
                                    const res = await fetch(`${apiBase}/api/meetings/join`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ meeting_number: dueMeeting.meeting_number, user_id: user.id }),
                                        signal: controller.signal
                                    });
                                    clearTimeout(timeoutId);
                                    const data = await res.json();
                                    if (!res.ok) throw new Error(data.detail || 'Failed to start scheduled meeting');

                                    onEnterMeeting({
                                        roomCode: data.meeting_number,
                                        meetingId: data.meeting_id,
                                        role: 'host'
                                    });
                                    setDueMeeting(null);
                                } catch (err: any) {
                                    if (err.name === 'AbortError') {
                                        alert('Request timed out. Please check your connection.');
                                    } else {
                                        alert('Cannot start scheduled meeting: ' + err.message);
                                    }
                                } finally {
                                    clearTimeout(timeoutId);
                                    setIsStartingDueMeeting(false);
                                }
                            }}
                            className={`flex-1 py-1.5 bg-zoomOrange hover:bg-zoomOrangeHover text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${isStartingDueMeeting ? 'opacity-75 cursor-not-allowed' : ''}`}
                        >
                            {isStartingDueMeeting ? "Starting..." : "Start Now"}
                        </button>
                    </div>
                </div>
            )}

            {/* Schedule Meeting Modal Dialog */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-zoomPanel border border-zoomBorder p-6 rounded-2xl max-w-sm w-full shadow-2xl relative text-left mx-4">
                        <h3 className="text-sm font-bold text-zoomText mb-4 flex items-center gap-2">
                            <span>📅</span> Schedule New Meeting
                        </h3>
                        
                        <form onSubmit={handleScheduleMeeting} className="space-y-4">
                            <div>
                                <label className="block text-[9px] font-semibold text-zoomTextSec uppercase tracking-widest mb-1">Meeting Topic</label>
                                <input type="text" required value={scheduleTopic} onChange={e => setScheduleTopic(e.target.value)} placeholder="Attentix Alignment" className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-zoomText outline-none focus:border-zoomBlue text-xs" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[9px] font-semibold text-zoomTextSec uppercase tracking-widest mb-1">Date</label>
                                    <input type="date" required value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-zoomText outline-none focus:border-zoomBlue text-xs" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-semibold text-zoomTextSec uppercase tracking-widest mb-1">Time</label>
                                    <input type="time" required value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-zoomText outline-none focus:border-zoomBlue text-xs" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[9px] font-semibold text-zoomTextSec uppercase tracking-widest mb-1">Duration</label>
                                <select value={scheduleDuration} onChange={e => setScheduleDuration(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-zoomText outline-none focus:border-zoomBlue text-xs">
                                    <option value={15}>15 minutes</option>
                                    <option value={30}>30 minutes</option>
                                    <option value={40}>40 minutes</option>
                                    <option value={60}>60 minutes</option>
                                    <option value={90}>90 minutes</option>
                                </select>
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setShowScheduleModal(false)} className="flex-1 py-2 rounded-lg bg-zoomBorder hover:bg-slate-800 text-zoomText text-xs font-bold transition-all">Cancel</button>
                                <button 
                                    type="submit" 
                                    disabled={isSchedulingMeeting}
                                    className={`flex-1 py-2 rounded-lg bg-zoomBlue hover:bg-zoomBlueHover text-black text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${isSchedulingMeeting ? 'opacity-75 cursor-not-allowed' : ''}`}
                                >
                                    {isSchedulingMeeting ? (
                                        <>
                                            <svg className="animate-spin h-3.5 w-3.5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>Scheduling...</span>
                                        </>
                                    ) : "Schedule"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Lobby;
