/**
 * FocusGuard Meeting Room Orchestrator
 * Integrates WebRTC P2P mesh video sharing with local MediaPipe attention monitoring
 */

document.addEventListener('DOMContentLoaded', async () => {
    const apiBase = window.location.origin;

    // Parse Room Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    const role = urlParams.get('role') || 'participant';
    const meetingId = urlParams.get('id');

    // Retrieve user credentials
    const user = JSON.parse(sessionStorage.getItem('fg_user'));
    if (!user || !roomCode || !meetingId) {
        alert("Session parameters missing. Redirecting to lobby.");
        window.location.href = 'index.html';
        return;
    }

    // DOM Elements
    document.getElementById('room-code-tag').textContent = `Room: ${roomCode.slice(0,3)}-${roomCode.slice(3,6)}-${roomCode.slice(6,9)}`;
    document.getElementById('user-display').textContent = `${user.username} (${role.toUpperCase()})`;
    
    const localVideo = document.getElementById('local-video');
    const landmarkCanvas = document.getElementById('landmark-canvas');
    const videoGrid = document.getElementById('video-grid');
    const warningPopup = document.getElementById('warning-popup');
    
    // Sidebar Indicators
    const gaugeFillArc = document.getElementById('gauge-fill-arc');
    const gaugeScoreValue = document.getElementById('gauge-score-value');
    const gaugeStatusLabel = document.getElementById('gauge-status-label');
    const earValue = document.getElementById('ear-value');
    const gazeValue = document.getElementById('gaze-value');
    const headPoseValue = document.getElementById('head-pose-value');
    const warningsCountValue = document.getElementById('warnings-count-value');
    const warningLogList = document.getElementById('warning-log-list');

    // Control Buttons
    const btnToggleAudio = document.getElementById('btn-toggle-audio');
    const btnToggleVideo = document.getElementById('btn-toggle-video');
    const btnLeaveMeeting = document.getElementById('btn-leave-meeting');
    const hostControls = document.getElementById('host-controls');
    const btnOpenDashboard = document.getElementById('btn-open-dashboard');
    const btnInvite = document.getElementById('btn-invite');

    if (role === 'host') {
        hostControls.style.display = 'block';
        btnOpenDashboard.addEventListener('click', () => {
            window.location.href = `dashboard.html?room=${roomCode}&id=${meetingId}`;
        });
    }

    if (btnInvite) {
        btnInvite.addEventListener('click', () => {
            const inviteLink = `${window.location.origin}/index.html?room=${roomCode}`;
            navigator.clipboard.writeText(inviteLink).then(() => {
                alert(`Invite Link copied to clipboard! Send this link to participants to let them join directly:\n${inviteLink}`);
            }).catch(err => {
                alert(`Invite Link: ${inviteLink}`);
            });
        });
    }

    const btnCloseWarning = document.getElementById('btn-close-warning');
    if (btnCloseWarning) {
        btnCloseWarning.addEventListener('click', () => {
            consecutiveDistractions = 0;
            warningPopup.style.display = 'none';
        });
    }

    // Alarm Sound (Generated synthetically using Web Audio API for free)
    let audioCtx = null;
    function playWarningBeep() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.frequency.setValueAtTime(600, audioCtx.currentTime); // 600Hz tone
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);    // volume
            
            osc.start();
            osc.stop(audioCtx.currentTime + 0.15); // beep duration 0.15s
        } catch (e) {
            console.warn('Audio feedback blocked by browser settings');
        }
    }

    // Local states
    let localStream = null;
    let webrtcHandler = null;
    let attentionEngine = null;
    let consecutiveDistractions = 0;
    let warningCount = 0;
    let lastLogTime = 0;
    // Start local webcam capture immediately
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: true
        });
        localVideo.srcObject = localStream;
        
        // Start WebRTC connection handshakes immediately so the meeting starts instantly!
        initializeWebRTC();
    } catch (err) {
        alert("Webcam and microphone access are required for this app: " + err.message);
        window.location.href = 'index.html';
        return;
    }

    // Toggle Audio
    btnToggleAudio.addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            btnToggleAudio.innerHTML = audioTrack.enabled 
                ? `<span class="text-lg">🎙️</span><span class="text-[9px] font-semibold tracking-wide mt-0.5">Mute</span>`
                : `<span class="text-lg text-red-500">🎙️🚫</span><span class="text-[9px] font-semibold tracking-wide mt-0.5 text-red-500">Unmute</span>`;
        }
    });

    // Toggle Video
    btnToggleVideo.addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            btnToggleVideo.innerHTML = videoTrack.enabled 
                ? `<span class="text-lg">📹</span><span class="text-[9px] font-semibold tracking-wide mt-0.5">Stop Video</span>`
                : `<span class="text-lg text-red-500">📹🚫</span><span class="text-[9px] font-semibold tracking-wide mt-0.5 text-red-500">Start Video</span>`;
        }
    });

    // Leave Session
    btnLeaveMeeting.addEventListener('click', () => {
        if (confirm("Are you sure you want to leave the meeting?")) {
            cleanup();
            window.location.href = 'index.html';
        }
    });

    // Initialize Local Attention Engine (MediaPipe Face Mesh JS) in the background asynchronously
    attentionEngine = new AttentionEngine();
    attentionEngine.initialize(localVideo, landmarkCanvas, (results) => {
        handleAttentionResults(results);
    }).then(() => {
        console.log("Local MediaPipe attention engine loaded and started in background.");
    }).catch(err => {
        console.error("Failed to load local MediaPipe. Attention tracking disabled.", err);
    });

    // Process Attention Engine Results
    function handleAttentionResults(results) {
        // 1. Update Gauge & UI Text
        const score = results.attentionScore;
        const state = results.state;

        gaugeScoreValue.textContent = `${score}%`;
        gaugeStatusLabel.textContent = state;

        // Animate circular gauge fill: stroke-dashoffset = 377 - (377 * score / 100)
        const offset = 377 - (377 * score / 100);
        gaugeFillArc.style.strokeDashoffset = offset;

        // Change Gauge Color based on State
        if (state === 'Attentive') {
            gaugeFillArc.style.stroke = 'var(--color-attentive)';
            gaugeStatusLabel.style.color = 'var(--color-attentive)';
        } else if (state === 'Distracted') {
            gaugeFillArc.style.stroke = 'var(--color-distracted)';
            gaugeStatusLabel.style.color = 'var(--color-distracted)';
        } else {
            gaugeFillArc.style.stroke = 'var(--color-inactive)';
            gaugeStatusLabel.style.color = 'var(--color-inactive)';
        }

        // Update detailed logs
        earValue.textContent = results.ear;
        earValue.className = `metric-val ${results.ear >= 0.20 ? 'green' : 'red'}`;

        const gazeOffset = Math.abs(results.gaze.offsetX) > 0.18 || Math.abs(results.gaze.offsetY) > 0.15;
        gazeValue.textContent = gazeOffset ? 'Looking Away' : 'Attentive';
        gazeValue.className = `metric-val ${gazeOffset ? 'orange' : 'green'}`;

        const headOffset = Math.abs(results.headPose.yaw) > 25.0 || Math.abs(results.headPose.pitch) > 20.0;
        headPoseValue.textContent = headOffset ? 'Turned' : 'Attentive';
        headPoseValue.className = `metric-val ${headOffset ? 'orange' : 'green'}`;

        // Local video wrapper outline toggle
        const localBox = document.getElementById('local-video-box');
        localBox.classList.remove('border-stateGreen', 'border-stateYellow', 'border-stateRed', 'border-white/10');
        if (state === 'Attentive') localBox.classList.add('border-stateGreen');
        else if (state === 'Distracted') localBox.classList.add('border-stateYellow');
        else localBox.classList.add('border-stateRed');

        // 2. Local Warning Alert logic
        if (state !== 'Attentive' && results.detected) {
            consecutiveDistractions++;
            // 20 consecutive frames (~2 seconds at 10fps) of distraction triggers warning popup
            if (consecutiveDistractions === 20) {
                triggerInattentionWarning(state);
            }
        } else {
            consecutiveDistractions = 0;
            warningPopup.style.display = 'none';
        }

        // 3. API Logging (Debounced: log maximum once every 3 seconds to save bandwidth)
        const now = Date.now();
        if (now - lastLogTime > 3000) {
            lastLogTime = now;
            sendLogToBackend(score, state);
        }
    }

    function triggerInattentionWarning(state) {
        if (warningCount >= 3) {
            return; // Lock at max 3 warnings
        }
        warningCount++;
        warningsCountValue.textContent = `${warningCount} / 3`;
        
        const popupMsg = warningCount === 3 
            ? "<h3>FINAL WARNING</h3><p>You have reached 3 warnings. The Host has been notified.</p>"
            : `<h3>ATTENTION ALERT</h3><p>Please look back at the camera to restore focus. (Warning ${warningCount} of 3)</p>`;
        
        warningPopup.innerHTML = popupMsg;
        warningPopup.style.display = 'block';
        playWarningBeep();

        // Add to sidebar alert list
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const warningItem = document.createElement('div');
        warningItem.className = 'warning-alert-item';
        warningItem.innerHTML = `
            <span>⚠️ Warning ${warningCount}/3 (${state})</span>
            <span class="warning-time">${timeStr}</span>
        `;
        warningLogList.prepend(warningItem);
    }

    async function sendLogToBackend(score, state) {
        try {
            await fetch(`${apiBase}/api/attention/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meeting_id: meetingId,
                    user_id: user.id,
                    attention_score: score,
                    state: state,
                    warnings_count: warningCount
                })
            });
        } catch (e) {
            console.error('Failed to log attention data to server:', e);
        }
    }

    // Initialize WebRTC handshakes
    function initializeWebRTC() {
        webrtcHandler = new WebRTCHandler(
            meetingId,
            user.id,
            user.username,
            localStream,
            (peerId, peerName, stream) => addRemoteParticipantVideo(peerId, peerName, stream),
            (peerId) => removeRemoteParticipantVideo(peerId)
        );
        webrtcHandler.initialize();
    }

    // Add visual block for remote participant feed
    function addRemoteParticipantVideo(peerId, peerName, stream) {
        let wrapper = document.getElementById(`peer-${peerId}`);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'relative aspect-video bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-lg shadow-black/40 transition-all duration-300 border-2 border-slate-700';
            wrapper.id = `peer-${peerId}`;

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsinline = true;
            video.srcObject = stream;
            video.className = 'w-full h-full object-cover';

            const label = document.createElement('div');
            label.className = 'absolute bottom-3 left-3 bg-black/60 px-3 py-1.5 rounded-lg text-xs font-semibold';
            label.innerHTML = `<span id="name-${peerId}">${peerName}</span>`;

            wrapper.appendChild(video);
            wrapper.appendChild(label);
            videoGrid.appendChild(wrapper);
        }
    }

    // Remove visual block for remote participant feed
    function removeRemoteParticipantVideo(peerId) {
        const wrapper = document.getElementById(`peer-${peerId}`);
        if (wrapper) {
            wrapper.remove();
        }
    }

    // Listen for WebSocket updates (clean meeting room view)
    function initializeSocketListeners() {
        if (webrtcHandler && webrtcHandler.socket) {
            // Listen for host kick signals
            webrtcHandler.socket.on('participant-kicked', (data) => {
                if (data.user_id === user.id) {
                    alert("You have been removed from the meeting by the host.");
                    cleanup();
                    window.location.href = 'index.html';
                }
            });
        }
    }

    // Small delay to make sure socket is fully bound
    setTimeout(initializeSocketListeners, 2000);

    function cleanup() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        if (webrtcHandler) {
            webrtcHandler.leave();
        }
    }

    window.addEventListener('beforeunload', cleanup);
});
