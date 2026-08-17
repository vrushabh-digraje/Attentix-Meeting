import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Share2, Users, AlertTriangle, LogOut } from 'lucide-react';
import { UserSession, MeetingSession } from '../App';
import { AttentionEngine } from '../utils/attentionEngine';
import { WebRTCHandler } from '../utils/webrtcHandler';

interface MeetingProps {
    user: UserSession;
    meeting: MeetingSession;
    onLeave: () => void;
    onOpenDashboard: () => void;
}

interface RemotePeer {
    peerName: string;
    stream: MediaStream;
}

interface ParticipantVideoProps {
    stream: MediaStream;
    className?: string;
    muted?: boolean;
}

const failedPlaybacks = new Set<HTMLVideoElement>();

const ParticipantVideo: React.FC<ParticipantVideoProps> = ({ stream, className, muted }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        videoEl.srcObject = stream;
        videoEl.play()
            .then(() => {
                failedPlaybacks.delete(videoEl);
            })
            .catch(e => {
                console.warn("Play failed on bind due to autoplay restrictions, adding to retry queue", e);
                failedPlaybacks.add(videoEl);
            });

        const handleTrackEvent = () => {
            if (videoEl) {
                videoEl.srcObject = null;
                videoEl.srcObject = stream;
                videoEl.play()
                    .then(() => {
                        failedPlaybacks.delete(videoEl);
                    })
                    .catch(e => {
                        console.warn("Play failed on track change, adding to retry queue", e);
                        failedPlaybacks.add(videoEl);
                    });
            }
        };

        stream.addEventListener('addtrack', handleTrackEvent);
        stream.addEventListener('removetrack', handleTrackEvent);
        stream.getTracks().forEach(track => {
            track.addEventListener('mute', handleTrackEvent);
            track.addEventListener('unmute', handleTrackEvent);
        });

        return () => {
            failedPlaybacks.delete(videoEl);
            stream.removeEventListener('addtrack', handleTrackEvent);
            stream.removeEventListener('removetrack', handleTrackEvent);
            stream.getTracks().forEach(track => {
                track.removeEventListener('mute', handleTrackEvent);
                track.removeEventListener('unmute', handleTrackEvent);
            });
        };
    }, [stream]);

    return (
        <video 
            ref={videoRef} 
            className={className} 
            autoPlay 
            playsInline 
            muted={muted} 
        />
    );
};

const Meeting: React.FC<MeetingProps> = ({ user, meeting, onLeave, onOpenDashboard }) => {
    const rawApiBase = (import.meta as any).env.VITE_API_URL || 'https://attentix-meeting.onrender.com';
    const apiBase = rawApiBase.endsWith('/') ? rawApiBase.slice(0, -1) : rawApiBase;

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Media states
    const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
    const [videoEnabled, setVideoEnabled] = useState<boolean>(true);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remotePeers, setRemotePeers] = useState<{ [key: number]: RemotePeer }>({});
    const [waitingRoomState, setWaitingRoomState] = useState<'waiting' | 'approved' | 'declined'>(
        meeting.role === 'host' ? 'approved' : 'waiting'
    );
    const [joinRequest, setJoinRequest] = useState<{ user_id: number, username: string } | null>(null);
    const [pinnedPeerId, setPinnedPeerId] = useState<string | number>('local');
    const [remoteCameras, setRemoteCameras] = useState<{ [key: number]: boolean }>({});
    const [remoteScreenShares, setRemoteScreenShares] = useState<{ [key: number]: boolean }>({});
    const [electronScreenSources, setElectronScreenSources] = useState<any[] | null>(null);

    // Warning states
    const [showWarning, setShowWarning] = useState<boolean>(false);
    const [warningCount, setWarningCount] = useState<number>(0);
    const [warningMsg, setWarningMsg] = useState<string>('');
    const [showParticipantsSidebar, setShowParticipantsSidebar] = useState<boolean>(false);
    const [showScoreboard, setShowScoreboard] = useState<boolean>(true);
    const [participantScores, setParticipantScores] = useState<{ [key: number]: { username: string, score: number } }>({});
    
    // Screen sharing & Chat states
    const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [chatInput, setChatInput] = useState<string>('');
    const [showChatSidebar, setShowChatSidebar] = useState<boolean>(false);
    const [studentWarningsAlert, setStudentWarningsAlert] = useState<{ username: string, user_id: number } | null>(null);
    const [chatNotification, setChatNotification] = useState<{ username: string, message: string } | null>(null);

    // Refs to avoid state updates lagging inside callbacks
    const consecutiveDistractions = useRef<number>(0);
    const belowThresholdStartTimeRef = useRef<number | null>(null);
    const warningCountRef = useRef<number>(0);
    const lastLogTime = useRef<number>(0);
    const lastSocketEmitTime = useRef<number>(0);
    const logsBufferRef = useRef<any[]>([]);
    const lastActivityTime = useRef<number>(Date.now());

    const webrtcHandlerRef = useRef<WebRTCHandler | null>(null);
    const attentionEngineRef = useRef<AttentionEngine | null>(null);

    // Synthesize warning alert sound
    const playWarningBeep = () => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) return;
            const audioCtx = new AudioContextClass();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
            console.warn('Audio warning blocked by browser context');
        }
    };

    // 1. Mount Camera Stream & start P2P WebRTC connection instantly
    useEffect(() => {
        let activeStream: MediaStream | null = null;

        const startMeetingMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                activeStream = stream;
                setLocalStream(stream);

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                // Initialize WebRTC signaling handshakes
                const handler = new WebRTCHandler(
                    String(meeting.meetingId),
                    user.id,
                    user.username,
                    stream,
                    (peerId, peerName, remoteStream) => {
                        setRemotePeers(prev => ({
                            ...prev,
                            [peerId]: { peerName, stream: remoteStream }
                        }));
                        // Add participant to scoreboard immediately with a default of 100%
                        setParticipantScores(prev => {
                            if (prev[peerId]) return prev;
                            return {
                                ...prev,
                                [peerId]: { username: peerName, score: 100 }
                            };
                        });
                    },
                    (peerId) => {
                        setRemotePeers(prev => {
                            const copy = { ...prev };
                            delete copy[peerId];
                            return copy;
                        });
                        // Remove participant from scoreboard when they leave
                        setParticipantScores(prev => {
                            const copy = { ...prev };
                            delete copy[peerId];
                            return copy;
                        });
                    }
                );

                handler.initialize();
                webrtcHandlerRef.current = handler;

                // Listen for host kick events
                if (handler.socket) {
                    handler.socket.on('join-request', (data: any) => {
                        console.log('Received join request from:', data.username);
                        setJoinRequest(data);
                        playWarningBeep();
                    });

                    handler.socket.on('join-approved', () => {
                        console.log('Join approved by host');
                        setWaitingRoomState('approved');
                    });

                    handler.socket.on('join-declined', () => {
                        console.log('Join declined by host');
                        setWaitingRoomState('declined');
                    });

                    handler.socket.on('participant-kicked', (data: any) => {
                        if (data.user_id === user.id) {
                            alert("You have been removed from the meeting by the host.");
                            onLeave();
                        }
                    });

                    handler.socket.on('camera-state-change', (data: any) => {
                        setRemoteCameras(prev => ({
                            ...prev,
                            [data.user_id]: data.enabled
                        }));
                    });

                    handler.socket.on('screen-share-change', (data: any) => {
                        setRemoteScreenShares(prev => ({
                            ...prev,
                            [data.user_id]: data.enabled
                        }));
                    });

                    handler.socket.on('attention-score-update', (data: any) => {
                        setParticipantScores(prev => ({
                            ...prev,
                            [data.user_id]: {
                                username: data.username,
                                score: data.score
                            }
                        }));
                    });

                    handler.socket.on('chat-message', (data: any) => {
                        setChatMessages(prev => [...prev, data]);
                        if (data.user_id !== user.id) {
                            setChatNotification({ username: data.username, message: data.message });
                        }
                    });

                    handler.socket.on('warning-limit-reached', (data: any) => {
                        setStudentWarningsAlert(data);
                    });

                    handler.socket.on('cancel-join-request', (data: any) => {
                        setJoinRequest(prev => {
                            if (prev && prev.user_id === data.user_id) {
                                return null;
                            }
                            return prev;
                        });
                    });
                }

            } catch (err: any) {
                alert("Camera and microphone access are required: " + err.message);
                onLeave();
            }
        };

        startMeetingMedia();

        return () => {
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
            }
            if (webrtcHandlerRef.current) {
                webrtcHandlerRef.current.leave();
            }
        };
    }, [meeting.meetingId]);
 
    // Robustly bind the localStream to localVideoRef whenever it mounts or updates (Fixes random self video black screen)
    useEffect(() => {
        if (localVideoRef.current && localStream && !isScreenSharing) {
            console.log("Binding localStream to localVideoRef explicitly");
            localVideoRef.current.srcObject = localStream;
            const videoEl = localVideoRef.current;
            videoEl.play()
                .then(() => {
                    failedPlaybacks.delete(videoEl);
                })
                .catch(e => {
                    console.warn("Failed to play local video due to autoplay rules, adding to retry queue", e);
                    failedPlaybacks.add(videoEl);
                });
        }
    }, [localStream, pinnedPeerId, videoEnabled, isScreenSharing]);

    // Global autoplay retry registration on user interaction
    useEffect(() => {
        const retryAutoplay = () => {
            failedPlaybacks.forEach(video => {
                if (video) {
                    video.play()
                        .then(() => failedPlaybacks.delete(video))
                        .catch(err => console.log("Retried autoplay but blocked: ", err));
                }
            });
        };

        window.addEventListener('click', retryAutoplay);
        window.addEventListener('touchstart', retryAutoplay);
        return () => {
            window.removeEventListener('click', retryAutoplay);
            window.removeEventListener('touchstart', retryAutoplay);
        };
    }, []);

    // 2. Start local Attention Tracking asynchronously in background (Only for participants!)
    // A 1.5-second timeout delay is used to ensure the waiting room overlay has fully unmounted
    // and both video/canvas DOM element refs are fully painted and available in React's lifecycle.
    useEffect(() => {
        if (!localStream || meeting.role === 'host' || waitingRoomState !== 'approved' || !videoEnabled || isScreenSharing) return;

        let activeEngine: AttentionEngine | null = null;
        let isCancelled = false;

        const initTimer = setTimeout(() => {
            if (isCancelled) return;

            if (!localVideoRef.current || !canvasRef.current) {
                console.warn("React elements not fully painted yet, skipping MediaPipe init.");
                return;
            }

            const engine = new AttentionEngine();
            attentionEngineRef.current = engine;
            activeEngine = engine;

            engine.initialize(localVideoRef.current, canvasRef.current, (results) => {
                handleAttentionResults(results);
            }).then(() => {
                console.log("Local MediaPipe attention calculations running silently in background.");
            }).catch(err => {
                console.error("MediaPipe failed to load in background: ", err);
            });
        }, 1500);

        return () => {
            isCancelled = true;
            clearTimeout(initTimer);
            if (activeEngine) {
                activeEngine.stop();
            }
        };
    }, [localStream, waitingRoomState, videoEnabled, isScreenSharing]);

    // Fallback Attention Loop when camera is OFF (Score immediately falls to 0%)
    useEffect(() => {
        if (meeting.role === 'host' || waitingRoomState !== 'approved' || videoEnabled) return;

        console.log("Camera is off. Forcing attention score to 0%.");

        const fallbackScoringLoop = () => {
            const activityScore = 0;
            const state = 'Inactive';

            // Emit 0% attention score to host scoreboard via socket
            if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                webrtcHandlerRef.current.socket.emit('attention-score-update', {
                    meeting_id: meeting.meetingId,
                    user_id: user.id,
                    username: user.username,
                    score: activityScore
                });
            }

            // Write 0% log to database queue
            logsBufferRef.current.push({
                meeting_id: meeting.meetingId,
                user_id: user.id,
                attention_score: activityScore,
                state: state,
                warnings_count: warningCountRef.current
            });

            // Local warnings trigger (Warnings for camera off - 2 mins threshold)
            if (belowThresholdStartTimeRef.current === null) {
                belowThresholdStartTimeRef.current = Date.now();
            } else if (Date.now() - belowThresholdStartTimeRef.current >= 120000) { // 2 minutes (120,000 ms)
                triggerInattentionWarning(state);
                belowThresholdStartTimeRef.current = null;
            }
        };

        // Execute immediately when camera is turned off to update host scoreboard instantly
        fallbackScoringLoop();

        const interval = setInterval(fallbackScoringLoop, 2000);
        return () => {
            clearInterval(interval);
        };
    }, [videoEnabled, waitingRoomState, meeting.role]);

    // Fallback Attention Loop when Screen Sharing is active (Forced 100% score)
    useEffect(() => {
        if (meeting.role === 'host' || waitingRoomState !== 'approved' || !isScreenSharing) return;

        console.log("Screen sharing active. Forcing attention score to 100%.");

        const emitScreenShareScore = () => {
            if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                webrtcHandlerRef.current.socket.emit('attention-score-update', {
                    meeting_id: meeting.meetingId,
                    user_id: user.id,
                    username: user.username,
                    score: 100
                });
            }
        };

        // Emit immediately
        emitScreenShareScore();

        // Emit every 3 seconds to keep database logs and scoreboard updated
        const interval = setInterval(() => {
            emitScreenShareScore();

            // Also buffer logs in memory
            logsBufferRef.current.push({
                meeting_id: meeting.meetingId,
                user_id: user.id,
                attention_score: 100,
                state: 'Attentive',
                warnings_count: warningCountRef.current
            });
        }, 3000);

        return () => {
            clearInterval(interval);
        };
    }, [isScreenSharing, waitingRoomState, meeting.role]);

    // Auto-dismiss chat notification toast after 2 seconds
    useEffect(() => {
        if (chatNotification) {
            const timer = setTimeout(() => {
                setChatNotification(null);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [chatNotification]);

    // Periodically flush buffered attention logs to database (Every 15 seconds)
    useEffect(() => {
        const flushLogs = async () => {
            if (logsBufferRef.current.length === 0) return;
            const payload = [...logsBufferRef.current];
            logsBufferRef.current = []; // Clear buffer first to prevent double-sends
            try {
                const res = await fetch(`${apiBase}/api/attention/log/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ logs: payload })
                });
                if (res.ok) {
                    console.log(`Successfully flushed ${payload.length} attention logs to database.`);
                } else {
                    throw new Error("Failed to batch-log attention data");
                }
            } catch (e) {
                console.error('Failed to batch-log attention data:', e);
                // Restore logs back to the front of buffer if it failed
                logsBufferRef.current = [...payload, ...logsBufferRef.current];
            }
        };

        const interval = setInterval(flushLogs, 15000);
        
        // Also flush on unmount (leaving the meeting)
        return () => {
            clearInterval(interval);
            flushLogs();
        };
    }, []);

    // Bind local stream to video ref whenever localStream, pinnedPeerId, or screen share status changes
    useEffect(() => {
        if (localVideoRef.current) {
            if (isScreenSharing && screenStream) {
                localVideoRef.current.srcObject = screenStream;
            } else if (localStream) {
                localVideoRef.current.srcObject = localStream;
            }
        }
        if (attentionEngineRef.current && localVideoRef.current && canvasRef.current) {
            // Update media elements reference if video tag mounts to new place
            attentionEngineRef.current.video = localVideoRef.current;
            attentionEngineRef.current.canvas = canvasRef.current;
            attentionEngineRef.current.ctx = canvasRef.current.getContext('2d');
        }
    }, [localStream, pinnedPeerId, isScreenSharing, screenStream]);

    // Handle incoming attention scores
    const handleAttentionResults = (results: any) => {
        if (isScreenSharing) {
            consecutiveDistractions.current = 0;
            setShowWarning(false);
            return;
        }

        const score = results.attentionScore;
        const state = results.state;

        if (meeting.role === 'host') {
            setParticipantScores(prev => ({
                ...prev,
                [user.id]: {
                    username: "You (Host)",
                    score: Math.round(score)
                }
            }));
        }

        // Local Warning Alert logic (Score < 20% continuously for 2 minutes)
        if (score < 20 && results.detected) {
            if (belowThresholdStartTimeRef.current === null) {
                belowThresholdStartTimeRef.current = Date.now();
            } else if (Date.now() - belowThresholdStartTimeRef.current >= 120000) { // 2 minutes (120,000 ms)
                triggerInattentionWarning(state);
                belowThresholdStartTimeRef.current = null; // reset countdown
            }
        } else {
            belowThresholdStartTimeRef.current = null;
        }

        // Buffer logs in memory (Every 3 seconds)
        const now = Date.now();
        if (now - lastLogTime.current > 3000) {
            lastLogTime.current = now;
            logsBufferRef.current.push({
                meeting_id: meeting.meetingId,
                user_id: user.id,
                attention_score: score,
                state: state,
                warnings_count: warningCountRef.current
            });
        }

        // Emit real-time attention score to socket (Debounced to once every 800ms for continuous updates)
        if (now - lastSocketEmitTime.current > 800) {
            lastSocketEmitTime.current = now;
            if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                webrtcHandlerRef.current.socket.emit('attention-score-update', {
                    meeting_id: meeting.meetingId,
                    user_id: user.id,
                    username: user.username,
                    score: Math.round(score)
                });
            }
        }
    };

    const triggerInattentionWarning = (state: string) => {
        if (warningCountRef.current >= 3) return; // Locked at max 3 warnings
        
        warningCountRef.current++;
        setWarningCount(warningCountRef.current);
        playWarningBeep();

        if (warningCountRef.current === 3) {
            setWarningMsg("FINAL WARNING: You have reached 3 warnings. The Host has been notified.");
            if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                webrtcHandlerRef.current.socket.emit('warning-limit-reached', {
                    meeting_id: meeting.meetingId,
                    user_id: user.id,
                    username: user.username
                });
            }
        } else {
            setWarningMsg(`Please look back at the camera to restore focus. (Warning ${warningCountRef.current} of 3)`);
        }
        setShowWarning(true);
    };

    const handleApproveJoin = (targetId: number) => {
        if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
            webrtcHandlerRef.current.socket.emit('approve-join', {
                meeting_id: meeting.meetingId,
                target_id: targetId
            });
        }
        setJoinRequest(null);
    };

    const handleDeclineJoin = (targetId: number) => {
        if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
            webrtcHandlerRef.current.socket.emit('decline-join', {
                meeting_id: meeting.meetingId,
                target_id: targetId
            });
        }
        setJoinRequest(null);
    };

    // Toggle Audio
    const handleToggleAudio = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setAudioEnabled(audioTrack.enabled);
            }
        }
    };

    // Toggle Video
    const handleToggleVideo = () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setVideoEnabled(videoTrack.enabled);
                
                // Broadcast state to other participants
                if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                    webrtcHandlerRef.current.socket.emit('camera-state-change', {
                        meeting_id: meeting.meetingId,
                        user_id: user.id,
                        enabled: videoTrack.enabled
                    });
                }
            }
        }
    };

    // Copy Invite Link
    const handleCopyInviteLink = () => {
        const inviteLink = `${window.location.origin}/index.html?room=${meeting.roomCode}`;
        navigator.clipboard.writeText(inviteLink).then(() => {
            alert(`Invite Link copied to clipboard! Send this link to participants to let them join directly:\n${inviteLink}`);
        }).catch(() => {
            alert(`Invite Code: ${meeting.roomCode}`);
        });
    };

    // Toggle Screen Share
    const handleToggleScreenShare = async () => {
        if (!isScreenSharing) {
            // Check if running inside Electron desktop container
            if ((window as any).electronAPI) {
                try {
                    const sources = await (window as any).electronAPI.getScreenSources();
                    setElectronScreenSources(sources);
                } catch (err) {
                    console.error("Failed to get Electron screen sources:", err);
                }
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = stream.getVideoTracks()[0];
                
                if (webrtcHandlerRef.current) {
                    webrtcHandlerRef.current.replaceVideoTrack(screenTrack);
                    if (webrtcHandlerRef.current.socket) {
                        webrtcHandlerRef.current.socket.emit('screen-share-change', {
                            meeting_id: meeting.meetingId,
                            user_id: user.id,
                            enabled: true
                        });
                    }
                }
                
                setScreenStream(stream);
                setIsScreenSharing(true);
                
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
                
                screenTrack.onended = () => {
                    stopScreenShare(stream);
                };
            } catch (err) {
                console.error("Failed to share screen:", err);
            }
        } else {
            if (screenStream) {
                stopScreenShare(screenStream);
            }
        }
    };

    const startElectronScreenShare = async (sourceId: string) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                } as any
            });
            const screenTrack = stream.getVideoTracks()[0];
            
            if (webrtcHandlerRef.current) {
                webrtcHandlerRef.current.replaceVideoTrack(screenTrack);
                if (webrtcHandlerRef.current.socket) {
                    webrtcHandlerRef.current.socket.emit('screen-share-change', {
                        meeting_id: meeting.meetingId,
                        user_id: user.id,
                        enabled: true
                    });
                }
            }
            
            setScreenStream(stream);
            setIsScreenSharing(true);
            
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            
            screenTrack.onended = () => {
                stopScreenShare(stream);
            };
        } catch (err) {
            console.error("Failed to start Electron screen sharing stream:", err);
        }
    };

    const stopScreenShare = (stream: MediaStream) => {
        stream.getTracks().forEach(track => track.stop());
        
        if (localStream) {
            const originalTrack = localStream.getVideoTracks()[0];
            if (webrtcHandlerRef.current && originalTrack) {
                webrtcHandlerRef.current.replaceVideoTrack(originalTrack);
            }
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = localStream;
            }
        }
        if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
            webrtcHandlerRef.current.socket.emit('screen-share-change', {
                meeting_id: meeting.meetingId,
                user_id: user.id,
                enabled: false
            });
        }
        setScreenStream(null);
        setIsScreenSharing(false);
    };

    // Chat Message Submit
    const handleSendChatMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim()) return;
        
        if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
            webrtcHandlerRef.current.socket.emit('chat-message', {
                meeting_id: meeting.meetingId,
                user_id: user.id,
                username: user.username,
                message: chatInput.trim()
            });
            setChatInput('');
        }
    };

    // Dismiss Warning
    const handleDismissWarning = () => {
        consecutiveDistractions.current = 0;
        setShowWarning(false);
    };

    // Cancel Join Request
    const handleCancelRequest = () => {
        if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
            webrtcHandlerRef.current.socket.emit('cancel-join-request', {
                meeting_id: meeting.meetingId,
                user_id: user.id
            });
        }
        onLeave();
    };

    // Kick Participant
    const handleKickParticipant = (peerId: number) => {
        if (confirm("Are you sure you want to kick this participant?")) {
            if (webrtcHandlerRef.current && webrtcHandlerRef.current.socket) {
                webrtcHandlerRef.current.socket.emit('kick-participant', {
                    meeting_id: meeting.meetingId,
                    user_id: peerId
                });
            }
        }
    };

    const peerIds = Object.keys(remotePeers).map(Number);
    const hasRemote = peerIds.length > 0;
    
    // Determine active pin
    let activePin: string | number = 'local';
    if (pinnedPeerId !== 'local' && remotePeers[pinnedPeerId as number]) {
        activePin = pinnedPeerId;
    } else if (hasRemote && pinnedPeerId === 'local') {
        // Default to first remote peer if there are any
        activePin = peerIds[0];
    }

    return (
        <div className="bg-zoomDarkBg text-zoomText min-h-screen flex flex-col font-sans overflow-hidden select-none relative">
            
            {/* Host Alert: Participant Inattention Toast (Renders top center) */}
            {meeting.role === 'host' && studentWarningsAlert && (
                <div className="fixed top-6 left-1/2 transform -translate-x-1/2 w-[400px] max-w-[90vw] bg-zoomPanel border-2 border-stateRed p-4 rounded-xl shadow-2xl z-[100] flex flex-col gap-2 animate-bounce">
                    <div className="flex items-center gap-2 text-stateRed font-extrabold text-xs uppercase tracking-widest">
                        <AlertTriangle size={16} /> Attention Alert Notification
                    </div>
                    <p className="text-zoomText text-[11.5px] leading-relaxed">
                        Student <span className="font-bold text-zoomText underline">{studentWarningsAlert.username}</span> has received <span className="text-stateRed font-black">3 inattention warnings</span> during this meeting!
                    </p>
                    <div className="flex justify-end gap-2 mt-1">
                        <button 
                            onClick={() => {
                                handleKickParticipant(studentWarningsAlert.user_id);
                                setStudentWarningsAlert(null);
                            }}
                            className="px-3 py-1 bg-zoomRed hover:bg-red-600 text-white rounded text-[10px] font-bold transition-all"
                        >
                            Kick Student
                        </button>
                        <button 
                            onClick={() => setStudentWarningsAlert(null)}
                            className="px-3 py-1 bg-zoomBorder hover:bg-slate-200 text-zoomText rounded text-[10px] font-bold transition-all"
                        >
                            Dismiss Alert
                        </button>
                    </div>
                </div>
            )}

            {/* Center-Top Meeting ID Header */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40 flex items-center gap-2.5 bg-zoomPanel/90 px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-sm border border-zoomBorder shadow-xl text-zoomText">
                <span className="w-2 h-2 rounded-full bg-stateGreen animate-pulse"></span>
                <span className="text-zoomTextSec">Room:</span>
                <span className="text-zoomText font-mono tracking-wider font-extrabold text-[13px]">
                    {meeting.roomCode.slice(0,3)}-{meeting.roomCode.slice(3,6)}-{meeting.roomCode.slice(6,9)}
                </span>
            </div>

            {/* Video Workspace (Speaker View layout: Horizontal thumbnails + Pinned Big Video) */}
            <div className="relative flex-grow flex h-[calc(100vh-70px)] overflow-hidden bg-zoomDarkBg">
                
                {/* Left Side: Host-Only Attention Scoreboard */}
                {meeting.role === 'host' && showScoreboard && (
                    <div className="fixed inset-y-0 left-0 w-56 border-r border-zoomBorder bg-zoomPanel/95 backdrop-blur-md flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 md:z-20 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder bg-zoomControlBar/90 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-xs text-zoomOrange uppercase tracking-widest flex items-center gap-1.5">
                                    📊 Attention Scoreboard
                                </h3>
                                <p className="text-[9px] text-slate-400 mt-1 leading-snug">Real-time engagement scores of all participants</p>
                            </div>
                            <button onClick={() => setShowScoreboard(false)} className="md:hidden text-slate-400 hover:text-white text-xs font-semibold px-2">✕</button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto p-4 space-y-2">
                            {Object.entries(participantScores).filter(([pId]) => Number(pId) !== user.id).length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-[10px]">
                                    Waiting for attention score updates...
                                </div>
                            ) : (
                                Object.entries(participantScores)
                                    .filter(([pId]) => Number(pId) !== user.id)
                                    .map(([pId, scoreData]) => {
                                        const scorePct = scoreData.score;
                                        let progressColor = 'bg-stateGreen';
                                        let textColor = 'text-stateGreen';
                                        if (scorePct < 40) {
                                            progressColor = 'bg-stateRed';
                                            textColor = 'text-stateRed';
                                        } else if (scorePct < 70) {
                                            progressColor = 'bg-stateYellow';
                                            textColor = 'text-stateYellow';
                                        }
                                        
                                        return (
                                            <div key={pId} className="bg-zoomCard border border-zoomBorder p-3 rounded-lg flex flex-col gap-1.5 shadow-sm">
                                                <div className="flex justify-between items-center text-[11px] font-bold text-zoomText">
                                                    <span className="truncate max-w-[145px]">{scoreData.username}</span>
                                                    <span className={`${textColor} font-mono`}>{scorePct}%</span>
                                                </div>
                                                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                    <div className={`h-full ${progressColor} transition-all duration-500`} style={{ width: `${scorePct}%` }}></div>
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                    </div>
                )}

                {/* Left Area: Video feeds */}
                <div className="flex-grow flex flex-col md:flex-row-reverse overflow-hidden h-full">
                    {/* Thumbnails Row (Top horizontal scrolling list on mobile, right column on desktop) */}
                    {hasRemote && (
                        <div className="w-full h-24 md:w-60 md:h-full bg-zoomControlBar/50 border-b md:border-b-0 md:border-l border-zoomBorder flex flex-row md:flex-col items-center gap-2 px-3 md:py-4 overflow-x-auto md:overflow-y-auto select-none py-1.5 sm:py-2 shrink-0 scrollbar-thin">
                            
                            {/* Render Local video as thumbnail if not pinned */}
                            {activePin !== 'local' && (
                                <div 
                                    onClick={() => setPinnedPeerId('local')}
                                    className="relative aspect-video w-36 md:w-full bg-zoomCard border border-zoomBorder rounded-lg overflow-hidden flex-shrink-0 cursor-pointer hover:border-zoomBlue transition-all max-sm:fixed max-sm:bottom-24 max-sm:right-4 max-sm:w-28 max-sm:aspect-video max-sm:z-30 max-sm:border-2 max-sm:border-zoomBlue max-sm:shadow-2xl"
                                >
                                    <video 
                                        ref={localVideoRef} 
                                        className={`w-full h-full ${isScreenSharing ? 'object-contain' : 'object-cover'} transform ${isScreenSharing ? 'scale-x-[1]' : 'scale-x-[-1]'} ${videoEnabled ? 'block' : 'opacity-0 absolute pointer-events-none w-1 h-1'}`} 
                                        autoPlay 
                                        playsInline 
                                        muted 
                                    />
                                    {!videoEnabled && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-zoomPanel">
                                            <div className="w-10 h-10 rounded-full bg-zoomBlue text-white font-bold flex items-center justify-center text-sm border border-white/10 animate-pulse">
                                                {user.username.charAt(0).toUpperCase()}
                                            </div>
                                        </div>
                                    )}
                                    <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[9px] font-medium z-10">
                                        You
                                    </div>
                                    <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"></canvas>
                                </div>
                            )}

                            {/* Render Remote videos as thumbnails */}
                            {peerIds.map(peerId => {
                                if (peerId === activePin) return null; // don't show active pin in thumbnails
                                const peerObj = remotePeers[peerId];
                                const isCamOn = remoteCameras[peerId] !== false;
                                return (
                                    <div 
                                        key={peerId}
                                        onClick={() => setPinnedPeerId(peerId)}
                                        className="relative aspect-video w-24 md:w-full bg-zoomCard border border-zoomBorder rounded-lg overflow-hidden flex-shrink-0 cursor-pointer hover:border-zoomBlue transition-all"
                                    >
                                        {isCamOn ? (
                                            <ParticipantVideo 
                                                stream={peerObj.stream} 
                                                className={`w-full h-full ${remoteScreenShares[peerId] ? 'object-contain' : 'object-cover'}`} 
                                            />
                                        ) : (
                                            <div className="absolute inset-0 flex items-center justify-center bg-zoomPanel">
                                                <div className="w-10 h-10 rounded-full bg-zoomCard border border-zoomBorder text-white font-bold flex items-center justify-center text-sm">
                                                    {peerObj.peerName.charAt(0).toUpperCase()}
                                                </div>
                                            </div>
                                        )}
                                        <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[9px] font-medium">
                                            {peerObj.peerName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Big Viewport (Active Pinned Video) */}
                    <div className="flex-grow flex items-center justify-center p-2 sm:p-4 relative bg-zoomDarkBg">
                        {activePin === 'local' ? (
                            <div className="relative w-full max-w-lg aspect-[3/4] md:max-w-4xl md:aspect-video bg-zoomCard border border-zoomBorder rounded-xl overflow-hidden shadow-2xl">
                                <video 
                                    ref={localVideoRef} 
                                    className={`w-full h-full ${isScreenSharing ? 'object-contain' : 'object-cover'} transform ${isScreenSharing ? 'scale-x-[1]' : 'scale-x-[-1]'} ${videoEnabled ? 'block' : 'opacity-0 absolute pointer-events-none w-1 h-1'}`} 
                                    autoPlay 
                                    playsInline 
                                    muted 
                                    />
                                {!videoEnabled && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zoomPanel">
                                        <div className="w-20 h-20 rounded-full bg-zoomBlue text-white font-black flex items-center justify-center text-3xl border border-zoomBorder shadow-lg animate-pulse">
                                            {user.username.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-xs text-zoomTextSec font-semibold tracking-wide">Camera Off</span>
                                    </div>
                                )}
                                <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-sm text-xs font-semibold z-10 text-white">
                                    You (Pinned)
                                </div>
                                <canvas ref={canvasRef} className={`absolute top-0 left-0 w-full h-full pointer-events-none z-10 ${isScreenSharing ? 'hidden' : 'block'}`}></canvas>
                            </div>
                        ) : (
                            remotePeers[activePin as number] && (
                                <div className="relative w-full max-w-lg aspect-[3/4] md:max-w-4xl md:aspect-video bg-zoomCard border border-zoomBorder rounded-xl overflow-hidden shadow-2xl">
                                    {remoteCameras[activePin as number] !== false ? (
                                        <ParticipantVideo 
                                            stream={remotePeers[activePin as number].stream} 
                                            className={`w-full h-full ${remoteScreenShares[activePin as number] ? 'object-contain' : 'object-cover'}`} 
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zoomPanel">
                                            <div className="w-20 h-20 rounded-full bg-zoomCard border border-zoomBorder text-zoomText font-black flex items-center justify-center text-3xl shadow-lg">
                                                {remotePeers[activePin as number].peerName.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-xs text-zoomTextSec font-semibold tracking-wide">Camera Off</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-sm text-xs font-semibold text-white">
                                        {remotePeers[activePin as number].peerName}
                                    </div>
                                </div>
                            )
                        )}

                        {/* Warning Alert Popup (Zoom notification toast at bottom-left) */}
                        {showWarning && (
                            <div className="absolute bottom-6 left-6 w-[320px] p-5 rounded-xl border border-zoomBorder bg-zoomPanel shadow-2xl z-50 flex flex-col items-center text-center">
                                <div className="text-stateRed text-xl mb-1"><AlertTriangle /></div>
                                <h3 className="text-stateRed font-extrabold text-sm mb-1 uppercase tracking-wider">Attention Warning</h3>
                                <p className="text-zoomText text-xs leading-relaxed mb-4">{warningMsg}</p>
                                <button 
                                    onClick={handleDismissWarning}
                                    className="w-full py-2 bg-zoomControlBar hover:bg-slate-200 border border-zoomBorder text-zoomText rounded-lg font-bold text-[11px] transition-all"
                                >
                                    Dismiss Warning
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Area: Participants list panel */}
                {showParticipantsSidebar && (
                    <div className="fixed inset-y-0 right-0 w-64 max-w-[85vw] md:relative md:w-64 border-l border-zoomBorder bg-zoomPanel flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder flex justify-between items-center bg-zoomControlBar">
                            <h3 className="font-bold text-xs text-zoomText uppercase tracking-wider flex items-center gap-1.5">
                                <Users size={14} className="text-zoomBlue" /> Participants ({peerIds.length + 1})
                            </h3>
                            <button onClick={() => setShowParticipantsSidebar(false)} className="text-zoomTextSec hover:text-zoomText text-xs font-semibold">✕</button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto p-4 space-y-3">
                            {/* Invite Option for Participants/Host */}
                            <button 
                                onClick={handleCopyInviteLink}
                                className="w-full py-2.5 mb-4 bg-zoomBlue/15 hover:bg-zoomBlue/25 border border-zoomBlue/30 text-zoomBlue rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                                <Share2 size={13} /> Copy Invite Link
                            </button>

                            {/* Local User Box */}
                            <div className="flex justify-between items-center p-3 rounded-lg bg-zoomCard border border-zoomBorder shadow-md">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-zoomBlue text-white font-bold flex items-center justify-center text-xs border border-zoomBorder">
                                        {user.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-zoomText leading-none">{user.username}</span>
                                        <span className="text-[9px] text-zoomTextSec mt-0.5 font-medium uppercase tracking-wider">{meeting.role} (You)</span>
                                    </div>
                                </div>
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${videoEnabled ? 'bg-stateGreen/10 text-stateGreen' : 'bg-stateRed/10 text-stateRed'}`}>
                                    {videoEnabled ? 'Camera On' : 'Camera Off'}
                                </span>
                            </div>

                            {/* Remote Peers list */}
                            {peerIds.map(peerId => {
                                const peerObj = remotePeers[peerId];
                                const isCamOn = remoteCameras[peerId] !== false;
                                return (
                                    <div key={peerId} className="flex justify-between items-center p-3 rounded-lg bg-zoomCard border border-zoomBorder shadow-md">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-full bg-zoomBorder text-zoomText font-bold flex items-center justify-center text-xs border border-zoomBorder">
                                                {peerObj.peerName.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-zoomText leading-none">{peerObj.peerName}</span>
                                                <span className="text-[9px] text-zoomTextSec mt-0.5 font-medium uppercase tracking-wider">Participant</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${isCamOn ? 'bg-stateGreen/10 text-stateGreen' : 'bg-stateRed/10 text-stateRed'}`}>
                                                {isCamOn ? 'Camera On' : 'Camera Off'}
                                            </span>
                                            {meeting.role === 'host' && (
                                                <button 
                                                    onClick={() => handleKickParticipant(peerId)}
                                                    className="text-[9px] text-stateRed hover:underline font-bold px-1.5 py-0.5 rounded bg-stateRed/5 hover:bg-stateRed/15 border border-stateRed/20 transition-all ml-1"
                                                >
                                                    Kick
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Right Area: Chat Sidebar Panel */}
                {showChatSidebar && (
                    <div className="fixed inset-y-0 right-0 w-64 max-w-[85vw] md:relative md:w-64 border-l border-zoomBorder bg-zoomPanel flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder flex justify-between items-center bg-zoomControlBar">
                            <h3 className="font-bold text-xs text-zoomText uppercase tracking-wider flex items-center gap-1.5">
                                💬 Meeting Chat
                            </h3>
                            <button onClick={() => setShowChatSidebar(false)} className="text-zoomTextSec hover:text-zoomText text-xs font-semibold">✕</button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto p-4 space-y-3 flex flex-col">
                            {chatMessages.length === 0 ? (
                                <div className="text-center text-zoomTextSec text-[10px] my-auto">
                                    No messages yet. Send a message to start the chat!
                                </div>
                            ) : (
                                chatMessages.map((msg, index) => {
                                    const isSelf = msg.user_id === user.id;
                                    return (
                                        <div key={index} className={`flex flex-col max-w-[85%] ${isSelf ? 'self-end items-end' : 'self-start items-start'}`}>
                                            <span className="text-[8px] text-zoomTextSec mb-0.5 font-semibold">
                                                {isSelf ? "You" : msg.username} • {msg.timestamp}
                                            </span>
                                            <div className={`p-2.5 rounded-lg text-xs leading-normal ${isSelf ? 'bg-zoomBlue text-white rounded-tr-none' : 'bg-zoomCard border border-zoomBorder text-zoomText rounded-tl-none'}`}>
                                                {msg.message}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <form onSubmit={handleSendChatMessage} className="p-4 border-t border-zoomBorder bg-zoomControlBar flex gap-2">
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                placeholder="Type message..."
                                className="flex-grow px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-xs text-zoomText outline-none focus:border-zoomBlue"
                            />
                            <button type="submit" className="px-3 py-2 bg-zoomBlue hover:bg-zoomBlueHover text-white rounded-lg text-xs font-bold transition-all">
                                        Send
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* Bottom Controls bar */}
            <div className="h-[75px] bg-zoomControlBar border-t border-zoomBorder flex justify-between items-center px-2 sm:px-4 md:px-8 z-50 gap-1.5">
                
                {/* Audio/Video */}
                <div className="flex items-center gap-1 sm:gap-1.5 md:gap-3">
                    <button 
                        onClick={handleToggleAudio}
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${audioEnabled ? 'bg-[#090A0F] border-2 border-zoomBlue text-zoomBlue shadow-[0_0_15px_rgba(0,242,254,0.25)] hover:bg-[#131520]' : 'bg-[#090A0F] border-2 border-stateRed text-stateRed shadow-[0_0_15px_rgba(239,68,68,0.2)] hover:bg-[#131520]'}`}
                        title={audioEnabled ? "Mute Microphone" : "Unmute Microphone"}
                    >
                        {audioEnabled ? <Mic size={14} className="sm:size-[16px] md:size-[18px]" /> : <MicOff size={14} className="sm:size-[16px] md:size-[18px]" />}
                    </button>
                    <button 
                        onClick={handleToggleVideo}
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${videoEnabled ? 'bg-[#090A0F] border-2 border-zoomBlue text-zoomBlue shadow-[0_0_15px_rgba(0,242,254,0.25)] hover:bg-[#131520]' : 'bg-[#090A0F] border-2 border-stateRed text-stateRed shadow-[0_0_15px_rgba(239,68,68,0.2)] hover:bg-[#131520]'}`}
                        title={videoEnabled ? "Stop Camera" : "Start Camera"}
                    >
                        {videoEnabled ? <VideoIcon size={14} className="sm:size-[16px] md:size-[18px]" /> : <VideoOff size={14} className="sm:size-[16px] md:size-[18px]" />}
                    </button>
                </div>

                {/* Center tools */}
                <div className="flex items-center gap-1 sm:gap-1.5 md:gap-3">
                    <button 
                        onClick={handleCopyInviteLink}
                        className="w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center bg-[#090A0F] border-2 border-zoomBorder hover:border-zoomBlue hover:text-zoomBlue hover:shadow-[0_0_15px_rgba(0,242,254,0.25)] text-zoomText transition-all"
                        title="Copy Invite Link"
                    >
                        <Share2 size={14} className="sm:size-[16px] md:size-[18px]" />
                    </button>
                    <button 
                        onClick={handleToggleScreenShare}
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full items-center justify-center transition-all hidden md:flex ${isScreenSharing ? 'bg-[#090A0F] border-2 border-stateGreen text-stateGreen shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse' : 'bg-[#090A0F] border-2 border-zoomBorder hover:border-zoomBlue hover:text-zoomBlue hover:shadow-[0_0_15px_rgba(0,242,254,0.25)] text-zoomText transition-all'}`}
                        title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                    >
                        <span className="text-xs sm:text-sm md:text-base">🖥️</span>
                    </button>
                    <button 
                        onClick={() => {
                            setShowChatSidebar(!showChatSidebar);
                            setShowParticipantsSidebar(false);
                        }}
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all relative ${showChatSidebar ? 'bg-zoomBlue text-white' : 'bg-zoomCard border border-zoomBorder hover:bg-slate-200 text-zoomText'}`}
                        title="Open Chat"
                    >
                        <span className="text-xs sm:text-sm md:text-base">💬</span>
                    </button>
                    <button 
                        onClick={() => {
                            setShowParticipantsSidebar(!showParticipantsSidebar);
                            setShowChatSidebar(false);
                        }}
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all relative ${showParticipantsSidebar ? 'bg-zoomBlue text-white' : 'bg-zoomCard border border-zoomBorder hover:bg-slate-200 text-zoomText'}`}
                        title="Show Participants"
                    >
                        <Users size={14} className="sm:size-[16px] md:size-[18px]" />
                        <span className="absolute -top-0.5 -right-0.5 bg-zoomBlue text-white text-[7px] px-1 rounded-full font-bold shadow-md">
                            {peerIds.length + 1}
                        </span>
                    </button>
                    
                    {meeting.role === 'host' && (
                        <button 
                            onClick={() => setShowScoreboard(!showScoreboard)}
                            className={`w-8 h-8 sm:w-9 sm:h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${showScoreboard ? 'bg-zoomOrange text-white' : 'bg-zoomCard border border-zoomBorder hover:bg-slate-200 text-zoomText'}`}
                            title="Toggle Scoreboard"
                        >
                            <span className="text-xs sm:text-sm md:text-base">📊</span>
                        </button>
                    )}
                    
                    {meeting.role === 'host' && (
                        <button 
                            onClick={onOpenDashboard}
                            className="ml-1 sm:ml-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 md:px-5 md:py-2.5 rounded-full bg-zoomBlue hover:bg-zoomBlueHover text-white text-[10px] md:text-xs font-bold transition-all shadow-lg hover:scale-[1.02]"
                            title="Usage Reports"
                        >
                            <span className="md:hidden">📊</span>
                            <span className="hidden md:inline">📊 Usage Reports</span>
                        </button>
                    )}
                </div>

                {/* End / Leave button */}
                <div className="shrink-0">
                    <button 
                        onClick={() => {
                            if (confirm("Leave this meeting session?")) {
                                onLeave();
                            }
                        }}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 md:px-6 md:py-2 rounded-full bg-[#EF4444] hover:bg-[#DC2626] text-white text-[10px] md:text-xs font-extrabold transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02]"
                    >
                        Leave
                    </button>
                </div>

            </div>

            {/* Host Admittance Request Popup Overlay */}
            {meeting.role === 'host' && joinRequest && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-zoomPanel border-2 border-zoomBlue p-6 rounded-2xl max-w-sm w-full shadow-2xl text-center mx-4">
                        <div className="w-12 h-12 rounded-full bg-zoomBlue/15 text-zoomBlue flex items-center justify-center text-xl mx-auto mb-3">
                            👤
                        </div>
                        <h3 className="text-zoomText font-extrabold text-base tracking-wide mb-1">Admittance Request</h3>
                        <p className="text-zoomTextSec text-xs mb-6">
                            Student <strong className="text-zoomText">{joinRequest.username}</strong> is asking to join this meeting.
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => handleApproveJoin(joinRequest.user_id)}
                                className="flex-1 py-2 bg-zoomBlue hover:bg-zoomBlueHover text-white rounded-lg text-xs font-bold transition-all"
                            >
                                Admit
                            </button>
                            <button 
                                onClick={() => handleDeclineJoin(joinRequest.user_id)}
                                className="flex-1 py-2 bg-zoomControlBar hover:bg-slate-200 text-zoomText rounded-lg text-xs font-bold transition-all border border-zoomBorder"
                            >
                                Decline
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Participant Waiting Room Overlay */}
            {waitingRoomState === 'waiting' && (
                <div className="fixed inset-0 bg-zoomDarkBg z-50 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-16 h-16 rounded-full border-4 border-zoomBlue border-t-transparent animate-spin mb-6"></div>
                    <h2 className="text-xl font-extrabold text-zoomText mb-2">Waiting for Host...</h2>
                    <p className="text-zoomTextSec text-xs max-w-sm">
                        You have requested to join this meeting. Please wait for the host to admit you to the session.
                    </p>
                    <button 
                        onClick={handleCancelRequest}
                        className="mt-8 px-6 py-2.5 bg-zoomControlBar hover:bg-slate-200 text-zoomText rounded-full text-xs font-bold transition-all border border-zoomBorder"
                    >
                        Cancel Request
                    </button>
                </div>
            )}

            {/* Participant Request Declined Overlay */}
            {waitingRoomState === 'declined' && (
                <div className="fixed inset-0 bg-zoomDarkBg z-50 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-14 h-14 rounded-full bg-stateRed/15 text-stateRed flex items-center justify-center text-2xl mb-4">
                        ❌
                    </div>
                    <h2 className="text-xl font-extrabold text-stateRed mb-2">Request Declined</h2>
                    <p className="text-zoomTextSec text-xs max-w-xs leading-relaxed">
                        Your request to join this meeting was declined by the host.
                    </p>
                    <button 
                        onClick={onLeave}
                        className="mt-8 px-6 py-2.5 bg-zoomBlue hover:bg-zoomBlueHover text-white rounded-full text-xs font-bold transition-all"
                    >
                        Back to Lobby
                    </button>
                </div>
            )}

            {/* Electron Screen Sharing Source Selection Dialog */}
            {electronScreenSources && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-center justify-center p-4">
                    <div className="bg-[#090A0F] border border-zoomBorder w-full max-w-4xl max-h-[85vh] rounded-2xl flex flex-col shadow-2xl">
                        <div className="p-5 border-b border-zoomBorder flex justify-between items-center bg-zoomControlBar">
                            <div>
                                <h3 className="font-extrabold text-sm text-zoomText uppercase tracking-wider">🖥️ Select Window or Screen</h3>
                                <p className="text-[10px] text-slate-400 mt-1">Choose the screen or window you want to share with other participants</p>
                            </div>
                            <button 
                                onClick={() => setElectronScreenSources(null)} 
                                className="text-slate-400 hover:text-white text-xs font-bold px-3 py-1 rounded bg-slate-800"
                            >
                                Cancel
                            </button>
                        </div>
                        <div className="flex-grow overflow-y-auto p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                            {electronScreenSources.map(source => (
                                <div 
                                    key={source.id}
                                    onClick={() => {
                                        startElectronScreenShare(source.id);
                                        setElectronScreenSources(null);
                                    }}
                                    className="bg-zoomCard border border-zoomBorder hover:border-zoomBlue p-3 rounded-xl flex flex-col gap-2 cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg group"
                                >
                                    <div className="aspect-video w-full rounded bg-black/40 overflow-hidden relative border border-white/5">
                                        <img src={source.thumbnail} alt={source.name} className="w-full h-full object-contain" />
                                        <div className="absolute inset-0 bg-zoomBlue/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                                            <span className="bg-zoomBlue text-white text-[10px] font-black uppercase px-3 py-1 rounded shadow-lg">Share Source</span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-zoomText truncate group-hover:text-zoomBlue transition-all mt-1">{source.name || "Unnamed Source"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Chat Message Toast Popup */}
            {chatNotification && (
                <div className="fixed bottom-24 left-6 bg-zoomPanel border border-zoomBorder text-zoomText px-4 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 animate-fade-in backdrop-blur-md max-w-sm transition-all duration-300">
                    <div className="w-8 h-8 rounded-full bg-zoomBlue/15 text-zoomBlue flex items-center justify-center font-bold text-xs shrink-0 border border-zoomBlue/20">
                        💬
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-zoomBlue uppercase tracking-wider">{chatNotification.username}</span>
                        <span className="text-[11px] text-zoomTextSec truncate mt-0.5">{chatNotification.message}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Meeting;
