/**
 * FocusGuard Host/Instructor Dashboard Orchestrator
 * Connects to signaling server to receive live socket updates of participant attention levels
 */

document.addEventListener('DOMContentLoaded', () => {
    const apiBase = window.location.origin;

    // Parse Room Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    const meetingId = urlParams.get('id');

    // Retrieve user credentials
    const user = JSON.parse(sessionStorage.getItem('fg_user'));
    if (!user || !roomCode || !meetingId) {
        alert("Session credentials missing. Redirecting to lobby.");
        window.location.href = 'index.html';
        return;
    }

    // DOM Elements
    document.getElementById('dashboard-room-title').textContent = `Meeting Room: ${roomCode.slice(0,3)}-${roomCode.slice(3,6)}-${roomCode.slice(6,9)}`;
    const btnBackToRoom = document.getElementById('btn-back-to-room');
    const classStudentsCount = document.getElementById('class-students-count');
    const classAvgScore = document.getElementById('class-avg-score');
    const matrixGrid = document.getElementById('participants-matrix-grid');
    const noParticipantsMsg = document.getElementById('no-participants-msg');
    const logsTableBody = document.getElementById('logs-table-body');
    const compactScoreboard = document.getElementById('compact-scoreboard');
    
    // Critical Alert Modal Elements
    const criticalModal = document.getElementById('critical-alert-modal');
    const criticalMsg = document.getElementById('critical-alert-msg');
    const btnCloseCriticalModal = document.getElementById('btn-close-critical-modal');

    // Initialize Charts
    const trendChart = DashboardCharts.initTrendChart('attention-trend-chart');
    const stateChart = DashboardCharts.initStateChart('attention-state-chart');

    // Local State Cache
    let participants = {}; // Map of user_id -> { user_id, username, score, state, warnings, lastActive, lowAttentionStart, alertTriggered }

    // Alarm Sound for Host (Web Audio API)
    let audioCtx = null;
    function playHostAlarm() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const now = audioCtx.currentTime;
            
            // Double beep alarm
            [now, now + 0.3].forEach((start) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.frequency.setValueAtTime(880, start); // Higher pitch alarm
                gain.gain.setValueAtTime(0.2, start);
                
                osc.start(start);
                osc.stop(start + 0.2);
            });
        } catch (e) {
            console.warn('Audio alarm blocked by browser');
        }
    }

    // Connect to Signaling Socket
    const socket = io(apiBase);

    socket.on('connect', () => {
        console.log('Host dashboard linked to signaling server.');
        socket.emit('join-room', {
            meeting_id: meetingId,
            user_id: user.id,
            username: user.username
        });
    });

    // Listen for real-time attention score logs emitted by students
    socket.on('attention-update', (data) => {
        console.log('Received attention update:', data);
        
        const previousRecord = participants[data.user_id];
        let lowAttentionStart = previousRecord ? previousRecord.lowAttentionStart : null;
        let alertTriggered = previousRecord ? previousRecord.alertTriggered : false;

        // Check if score is below 30%
        if (data.attention_score < 30) {
            if (!lowAttentionStart) {
                lowAttentionStart = Date.now(); // Start tracking low attention duration
            } else if (Date.now() - lowAttentionStart >= 180000 && !alertTriggered) { // 3 minutes
                alertTriggered = true;
                triggerHostCriticalAlert(data.username);
            }
        } else {
            lowAttentionStart = null;
            alertTriggered = false;
        }

        // Cache user stats
        participants[data.user_id] = {
            user_id: data.user_id,
            username: data.username,
            score: data.attention_score,
            state: data.state,
            warnings: data.warnings_count,
            lastActive: Date.now(),
            lowAttentionStart: lowAttentionStart,
            alertTriggered: alertTriggered
        };

        updateDashboard();
        
        // Log warnings to table
        if (data.state !== 'Attentive') {
            logIncident(data.username, data.state, data.attention_score, data.warnings_count);
        }
    });

    // Trigger alert popup when student remains distracted/inactive for 3 minutes
    function triggerHostCriticalAlert(studentName) {
        criticalMsg.innerHTML = `Participant <strong>${studentName}</strong>'s attention score has dropped below <strong>30%</strong> for more than <strong>3 minutes</strong>!`;
        criticalModal.classList.remove('hidden');
        criticalModal.classList.add('flex');
        playHostAlarm();
    }

    btnCloseCriticalModal.addEventListener('click', () => {
        criticalModal.classList.remove('flex');
        criticalModal.classList.add('hidden');
    });

    // Handle peer disconnects
    socket.on('peer-left', (data) => {
        const peerId = data.user_id;
        if (participants[peerId]) {
            delete participants[peerId];
            updateDashboard();
        }
    });

    // Remove Participant Click Handlers
    matrixGrid.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-kick')) {
            const peerId = parseInt(e.target.getAttribute('data-id'));
            const peerName = e.target.getAttribute('data-name');
            
            if (confirm(`Are you sure you want to remove ${peerName} from the meeting?`)) {
                socket.emit('kick-participant', {
                    meeting_id: meetingId,
                    user_id: peerId
                });
                // Remove locally
                delete participants[peerId];
                updateDashboard();
            }
        }
    });

    function updateDashboard() {
        const pList = Object.values(participants);
        
        if (pList.length === 0) {
            noParticipantsMsg.style.display = 'block';
            classStudentsCount.textContent = '0';
            classAvgScore.textContent = '0%';
            matrixGrid.innerHTML = '';
            matrixGrid.appendChild(noParticipantsMsg);
            compactScoreboard.innerHTML = '<span class="text-slate-500 text-xs">No active students.</span>';
            
            DashboardCharts.updateStates(stateChart, 0, 0, 0);
            return;
        }

        noParticipantsMsg.style.display = 'none';
        matrixGrid.innerHTML = '';
        compactScoreboard.innerHTML = '';

        let totalScore = 0;
        let attentiveCount = 0;
        let distractedCount = 0;
        let inactiveCount = 0;

        pList.forEach(p => {
            totalScore += p.score;
            if (p.state === 'Attentive') attentiveCount++;
            else if (p.state === 'Distracted') distractedCount++;
            else inactiveCount++;

            // 1. Rebuild Compact Scoreboard (Name and Score Only)
            const compactTag = document.createElement('div');
            compactTag.className = 'flex justify-between items-center bg-white/5 border border-white/5 px-4 py-2.5 rounded-xl text-xs font-semibold';
            
            let colorCode = 'text-stateGreen';
            let bgCode = 'bg-stateGreen/10';
            if (p.state === 'Distracted') {
                colorCode = 'text-stateYellow';
                bgCode = 'bg-stateYellow/10';
            } else if (p.state === 'Inactive') {
                colorCode = 'text-stateRed';
                bgCode = 'bg-stateRed/10';
            }

            compactTag.innerHTML = `
                <span class="text-slate-300 font-bold">${p.username}</span>
                <span class="px-2 py-0.5 rounded ${bgCode} ${colorCode}">${p.score}%</span>
            `;
            compactScoreboard.appendChild(compactTag);

            // 2. Rebuild Student Status matrix card
            const card = document.createElement('div');
            
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

            card.className = `glass-panel p-5 rounded-xl border-2 ${borderClass} relative flex flex-col items-center text-center transition-all duration-300`;
            card.innerHTML = `
                <div class="absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${dotColor}"></div>
                <div class="w-14 h-14 rounded-full bg-gradient-to-r from-cyanAccent to-purpleAccent flex items-center justify-center text-white font-extrabold text-xl mb-3 shadow-md">${p.username.charAt(0).toUpperCase()}</div>
                <h4 class="font-bold text-base text-slate-100">${p.username}</h4>
                <p class="text-xs text-slate-400 mt-0.5">State: <strong class="${scoreColor}">${p.state}</strong></p>
                <div class="text-2xl font-black ${scoreColor} mt-3">${p.score}%</div>
                <p class="text-[10px] text-slate-500 mt-1">Warnings: ${p.warnings}/3</p>
                <button class="btn-kick mt-4 w-full py-1.5 border border-stateRed/40 hover:bg-stateRed hover:text-white rounded-lg text-xs font-bold text-stateRed transition-all bg-transparent" data-id="${p.user_id}" data-name="${p.username}">Remove Participant</button>
            `;
            matrixGrid.appendChild(card);
        });

        // Update counts
        classStudentsCount.textContent = pList.length;
        const avg = Math.round(totalScore / pList.length);
        classAvgScore.textContent = `${avg}%`;
        
        classAvgScore.className = 'text-3xl font-extrabold mt-1 ' + (avg >= 75 ? 'text-stateGreen' : (avg >= 45 ? 'text-stateYellow' : 'text-stateRed'));

        // Update Doughnut Chart
        DashboardCharts.updateStates(stateChart, attentiveCount, distractedCount, inactiveCount);
    }

    // Log incidents in the historical data table
    function logIncident(username, state, score, warnings) {
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let stateBadgeColor = 'bg-stateRed/15 text-stateRed border-stateRed/30';
        if (state === 'Distracted') stateBadgeColor = 'bg-stateYellow/15 text-stateYellow border-stateYellow/30';

        const row = document.createElement('tr');
        row.className = "hover:bg-white/5 transition-all";
        row.innerHTML = `
            <td class="py-3 px-4 font-bold text-slate-200">${username}</td>
            <td class="py-3 px-4"><span class="border px-2 py-0.5 rounded text-xs font-semibold ${stateBadgeColor}">${state}</span></td>
            <td class="py-3 px-4 font-bold text-slate-200">${score}%</td>
            <td class="py-3 px-4 text-slate-400">${warnings}/3</td>
            <td class="py-3 px-4 text-slate-500 font-mono text-xs">${now}</td>
        `;
        
        logsTableBody.prepend(row);
        
        // Keep maximum 30 logs in UI
        if (logsTableBody.children.length > 30) {
            logsTableBody.lastElementChild.remove();
        }
    }

    // Periodically update the trend line chart (every 3 seconds)
    setInterval(() => {
        const pList = Object.values(participants);
        if (pList.length === 0) return;

        const totalScore = pList.reduce((acc, curr) => acc + curr.score, 0);
        const avg = Math.round(totalScore / pList.length);

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        DashboardCharts.updateTrend(trendChart, timeStr, avg);
    }, 3000);

    // Return button redirect
    btnBackToRoom.addEventListener('click', () => {
        socket.disconnect();
        window.location.href = `meeting.html?room=${roomCode}&role=host&id=${meetingId}`;
    });
});
