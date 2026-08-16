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

const ParticipantVideo: React.FC<ParticipantVideoProps> = ({ stream, className, muted }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        videoEl.srcObject = stream;
        videoEl.play().catch(e => console.log("Play failed on bind", e));

        const handleTrackEvent = () => {
            console.log("Track change (mute/unmute/add/remove) detected on stream, refreshing srcObject");
            if (videoEl) {
                videoEl.srcObject = null;
                videoEl.srcObject = stream;
                videoEl.play().catch(e => console.log("Play failed on track change", e));
            }
        };

        stream.addEventListener('addtrack', handleTrackEvent);
        stream.addEventListener('removetrack', handleTrackEvent);
        stream.getTracks().forEach(track => {
            track.addEventListener('mute', handleTrackEvent);
            track.addEventListener('unmute', handleTrackEvent);
        });

        return () => {
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
    const rawApiBase = (import.meta as any).env.VITE_API_URL || 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://127.0.0.1:5000' 
            : 'https://attentix-meeting.onrender.com');
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

    // Refs to avoid state updates lagging inside callbacks
    const consecutiveDistractions = useRef<number>(0);
    const warningCountRef = useRef<number>(0);
    const lastLogTime = useRef<number>(0);
    const lastSocketEmitTime = useRef<number>(0);
    const logsBufferRef = useRef<any[]>([]);

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
                    });

                    handler.socket.on('warning-limit-reached', (data: any) => {
                        setStudentWarningsAlert(data);
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
        if (localVideoRef.current && localStream) {
            console.log("Binding localStream to localVideoRef explicitly");
            localVideoRef.current.srcObject = localStream;
            localVideoRef.current.play().catch(e => console.warn("Failed to play local video", e));
        }
    }, [localStream, pinnedPeerId, videoEnabled]);

    // 2. Start local Attention Tracking asynchronously in background (Only for participants!)
    useEffect(() => {
        if (!localStream || meeting.role === 'host' || waitingRoomState !== 'approved') return;

        const engine = new AttentionEngine();
        attentionEngineRef.current = engine;

        if (localVideoRef.current && canvasRef.current) {
            engine.initialize(localVideoRef.current, canvasRef.current, (results) => {
                handleAttentionResults(results);
            }).then(() => {
                console.log("Local MediaPipe attention calculations running silently in background.");
            }).catch(err => {
                console.error("MediaPipe failed to load in background: ", err);
            });
        }

        return () => {
            if (attentionEngineRef.current) {
                attentionEngineRef.current.stop();
            }
        };
    }, [localStream, waitingRoomState]);

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

        // Local Warning Alert Counter logic (Throttled: 6 frames ≈ 2 seconds at 3 FPS)
        if (state !== 'Attentive' && results.detected) {
            consecutiveDistractions.current++;
            if (consecutiveDistractions.current === 6) {
                triggerInattentionWarning(state);
            }
        } else {
            consecutiveDistractions.current = 0;
            setShowWarning(false);
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
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = stream.getVideoTracks()[0];
                
                if (webrtcHandlerRef.current) {
                    webrtcHandlerRef.current.replaceVideoTrack(screenTrack);
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
        <div className="bg-zoomDarkBg text-slate-100 min-h-screen flex flex-col font-sans overflow-hidden select-none relative">
            
            {/* Host Alert: Participant Inattention Toast (Renders top center) */}
            {meeting.role === 'host' && studentWarningsAlert && (
                <div className="fixed top-6 left-1/2 transform -translate-x-1/2 w-[400px] max-w-[90vw] bg-[#2d1b1e] border-2 border-zoomRed p-4 rounded-xl shadow-2xl z-[100] flex flex-col gap-2 animate-bounce">
                    <div className="flex items-center gap-2 text-zoomRed font-extrabold text-xs uppercase tracking-widest">
                        <AlertTriangle size={16} /> Attention Alert Notification
                    </div>
                    <p className="text-slate-200 text-[11.5px] leading-relaxed">
                        Student <span className="font-bold text-white underline">{studentWarningsAlert.username}</span> has received <span className="text-zoomRed font-black">3 inattention warnings</span> during this meeting!
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
                            className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded text-[10px] font-bold transition-all"
                        >
                            Dismiss Alert
                        </button>
                    </div>
                </div>
            )}

            {/* Center-Top Meeting ID Header */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40 flex items-center gap-2.5 bg-[#0C0D15]/85 px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-sm border border-zoomBorder shadow-xl">
                <span className="w-2 h-2 rounded-full bg-stateGreen animate-pulse"></span>
                <span className="text-slate-300">Room:</span>
                <span className="text-white font-mono tracking-wider font-extrabold text-[13px]">
                    {meeting.roomCode.slice(0,3)}-{meeting.roomCode.slice(3,6)}-{meeting.roomCode.slice(6,9)}
                </span>
            </div>

            {/* Video Workspace (Speaker View layout: Horizontal thumbnails + Pinned Big Video) */}
            <div className="relative flex-grow flex h-[calc(100vh-70px)] overflow-hidden bg-zoomDarkBg">
                
                {/* Left Side: Host-Only Attention Scoreboard */}
                {meeting.role === 'host' && showScoreboard && (
                    <div className="fixed inset-y-0 left-0 w-64 border-r border-zoomBorder bg-zoomPanel/95 backdrop-blur-md flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 md:z-20 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder bg-zoomControlBar/90 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-xs text-zoomOrange uppercase tracking-widest flex items-center gap-1.5">
                                    📊 Attention Scoreboard
                                </h3>
                                <p className="text-[9px] text-zoomTextSec mt-1 leading-snug">Real-time engagement scores of all participants</p>
                            </div>
                            <button onClick={() => setShowScoreboard(false)} className="md:hidden text-zoomTextSec hover:text-white text-xs font-semibold px-2">✕</button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto p-4 space-y-2">
                            {Object.entries(participantScores).filter(([pId]) => Number(pId) !== user.id).length === 0 ? (
                                <div className="text-center py-8 text-zoomTextSec text-[10px]">
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
                                            <div key={pId} className="bg-zoomCard/60 border border-white/5 p-3 rounded-lg flex flex-col gap-1.5 shadow-sm">
                                                <div className="flex justify-between items-center text-[11px] font-bold text-white">
                                                    <span className="truncate max-w-[145px]">{scoreData.username}</span>
                                                    <span className={`${textColor} font-mono`}>{scorePct}%</span>
                                                </div>
                                                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
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
                                        className={`w-full h-full object-cover transform scale-x-[-1] ${videoEnabled ? 'block' : 'opacity-0 absolute pointer-events-none w-1 h-1'}`} 
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
                                                className="w-full h-full object-cover" 
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
                    <div className="flex-grow flex items-center justify-center p-2 sm:p-4 relative bg-[#090A0F]">
                        {activePin === 'local' ? (
                            <div className="relative w-full max-w-4xl aspect-video bg-zoomCard border border-zoomBorder rounded-xl overflow-hidden shadow-2xl">
                                <video 
                                    ref={localVideoRef} 
                                    className={`w-full h-full object-cover transform scale-x-[-1] ${videoEnabled ? 'block' : 'opacity-0 absolute pointer-events-none w-1 h-1'}`} 
                                    autoPlay 
                                    playsInline 
                                    muted 
                                    />
                                {!videoEnabled && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zoomPanel">
                                        <div className="w-20 h-20 rounded-full bg-zoomBlue text-white font-black flex items-center justify-center text-3xl border border-white/10 shadow-lg animate-pulse">
                                            {user.username.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-xs text-slate-400 font-semibold tracking-wide">Camera Off</span>
                                    </div>
                                )}
                                <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-sm text-xs font-semibold z-10">
                                    You (Pinned)
                                </div>
                                <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"></canvas>
                            </div>
                        ) : (
                            remotePeers[activePin as number] && (
                                <div className="relative w-full max-w-4xl aspect-video bg-zoomCard border border-zoomBorder rounded-xl overflow-hidden shadow-2xl">
                                    {remoteCameras[activePin as number] !== false ? (
                                        <ParticipantVideo 
                                            stream={remotePeers[activePin as number].stream} 
                                            className="w-full h-full object-cover" 
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zoomPanel">
                                            <div className="w-20 h-20 rounded-full bg-zoomCard border border-zoomBorder text-white font-black flex items-center justify-center text-3xl shadow-lg">
                                                {remotePeers[activePin as number].peerName.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-xs text-slate-500 font-semibold tracking-wide">Camera Off</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-sm text-xs font-semibold">
                                        {remotePeers[activePin as number].peerName}
                                    </div>
                                </div>
                            )
                        )}

                        {/* Warning Alert Popup (Zoom notification toast at bottom-left) */}
                        {showWarning && (
                            <div className="absolute bottom-6 left-6 w-[320px] p-5 rounded-xl border border-zoomBorder bg-[#242428]/95 shadow-2xl z-50 flex flex-col items-center text-center">
                                <div className="text-zoomRed text-xl mb-1"><AlertTriangle /></div>
                                <h3 className="text-zoomRed font-extrabold text-sm mb-1 uppercase tracking-wider">Attention Warning</h3>
                                <p className="text-slate-300 text-xs leading-relaxed mb-4">{warningMsg}</p>
                                <button 
                                    onClick={handleDismissWarning}
                                    className="w-full py-2 bg-zoomDarkBg hover:bg-zoomCard border border-white/10 text-slate-300 hover:text-white rounded-lg font-bold text-[11px] transition-all"
                                >
                                    Dismiss Warning
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Area: Participants list panel */}
                {showParticipantsSidebar && (
                    <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] md:relative md:w-80 border-l border-zoomBorder bg-zoomPanel flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder flex justify-between items-center bg-[#18181a]">
                            <h3 className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                                <Users size={14} className="text-zoomBlue" /> Participants ({peerIds.length + 1})
                            </h3>
                            <button onClick={() => setShowParticipantsSidebar(false)} className="text-zoomTextSec hover:text-white text-xs font-semibold">✕</button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto p-4 space-y-3">
                            {/* Invite Option for Participants/Host */}
                            <button 
                                onClick={handleCopyInviteLink}
                                className="w-full py-2.5 mb-4 bg-zoomBlue/15 hover:bg-zoomBlue/25 border border-zoomBlue/30 text-zoomBlue hover:text-white rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                                <Share2 size={13} /> Copy Invite Link
                            </button>

                            {/* Local User Box */}
                            <div className="flex justify-between items-center p-3 rounded-lg bg-zoomCard border border-white/5 shadow-md">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-zoomBlue text-white font-bold flex items-center justify-center text-xs border border-white/10">
                                        {user.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-white leading-none">{user.username}</span>
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
                                    <div key={peerId} className="flex justify-between items-center p-3 rounded-lg bg-zoomCard border border-white/5 shadow-md">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-full bg-[#2a2a2e] text-white font-bold flex items-center justify-center text-xs border border-white/10">
                                                {peerObj.peerName.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-white leading-none">{peerObj.peerName}</span>
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
                                                    className="text-[9px] text-zoomRed hover:underline font-bold px-1.5 py-0.5 rounded bg-stateRed/5 hover:bg-stateRed/15 border border-stateRed/20 transition-all ml-1"
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
                    <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] md:relative md:w-80 border-l border-zoomBorder bg-zoomPanel flex flex-col shrink-0 h-[calc(100vh-75px)] md:h-full z-40 shadow-2xl md:shadow-none">
                        <div className="p-4 border-b border-zoomBorder flex justify-between items-center bg-[#18181a]">
                            <h3 className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                                💬 Meeting Chat
                            </h3>
                            <button onClick={() => setShowChatSidebar(false)} className="text-zoomTextSec hover:text-white text-xs font-semibold">✕</button>
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
                                            <div className={`p-2.5 rounded-lg text-xs leading-normal ${isSelf ? 'bg-zoomBlue text-white rounded-tr-none' : 'bg-zoomCard border border-white/5 text-slate-100 rounded-tl-none'}`}>
                                                {msg.message}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <form onSubmit={handleSendChatMessage} className="p-4 border-t border-zoomBorder bg-[#18181a] flex gap-2">
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                placeholder="Type message..."
                                className="flex-grow px-3 py-2 rounded-lg bg-zoomCard border border-zoomBorder text-xs text-white outline-none focus:border-zoomBlue"
                            />
                            <button type="submit" className="px-3 py-2 bg-zoomBlue hover:bg-zoomBlueHover text-white rounded-lg text-xs font-bold transition-all">
                                        Send
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* Bottom Controls bar */}
            <div className="h-[75px] bg-[#18181a] border-t border-zoomBorder flex justify-between items-center px-4 md:px-8 z-50">
                
                {/* Audio/Video */}
                <div className="flex items-center gap-1.5 md:gap-3">
                    <button 
                        onClick={handleToggleAudio}
                        className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${audioEnabled ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-red-500/20 border border-red-500/30 text-red-500'}`}
                        title={audioEnabled ? "Mute Microphone" : "Unmute Microphone"}
                    >
                        {audioEnabled ? <Mic size={16} className="md:size-[18px]" /> : <MicOff size={16} className="md:size-[18px]" />}
                    </button>
                    <button 
                        onClick={handleToggleVideo}
                        className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${videoEnabled ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-red-500/20 border border-red-500/30 text-red-500'}`}
                        title={videoEnabled ? "Stop Camera" : "Start Camera"}
                    >
                        {videoEnabled ? <VideoIcon size={16} className="md:size-[18px]" /> : <VideoOff size={16} className="md:size-[18px]" />}
                    </button>
                </div>

                {/* Center tools */}
                <div className="flex items-center gap-1.5 md:gap-3">
                    <button 
                        onClick={handleCopyInviteLink}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white transition-all"
                        title="Copy Invite Link"
                    >
                        <Share2 size={16} className="md:size-[18px]" />
                    </button>
                    <button 
                        onClick={handleToggleScreenShare}
                        className={`w-9 h-9 md:w-11 md:h-11 rounded-full items-center justify-center transition-all hidden md:flex ${isScreenSharing ? 'bg-stateGreen/20 border border-stateGreen/30 text-stateGreen animate-pulse' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                        title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                    >
                        <span className="text-sm md:text-base">🖥️</span>
                    </button>
                    <button 
                        onClick={() => {
                            setShowChatSidebar(!showChatSidebar);
                            setShowParticipantsSidebar(false);
                        }}
                        className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all relative ${showChatSidebar ? 'bg-zoomBlue text-white' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                        title="Open Chat"
                    >
                        <span className="text-sm md:text-base">💬</span>
                    </button>
                    <button 
                        onClick={() => {
                            setShowParticipantsSidebar(!showParticipantsSidebar);
                            setShowChatSidebar(false);
                        }}
                        className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all relative ${showParticipantsSidebar ? 'bg-zoomBlue text-white' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                        title="Show Participants"
                    >
                        <Users size={16} className="md:size-[18px]" />
                        <span className="absolute -top-1 -right-1 bg-zoomBlue text-white text-[8px] px-1.5 rounded-full font-bold shadow-md">
                            {peerIds.length + 1}
                        </span>
                    </button>
                    
                    {meeting.role === 'host' && (
                        <button 
                            onClick={() => setShowScoreboard(!showScoreboard)}
                            className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${showScoreboard ? 'bg-zoomOrange text-white' : 'bg-white/5 hover:bg-white/10 text-white'}`}
                            title="Toggle Scoreboard"
                        >
                            <span className="text-sm md:text-base">📊</span>
                        </button>
                    )}
                    
                    {meeting.role === 'host' && (
                        <button 
                            onClick={onOpenDashboard}
                            className="ml-2 px-3 py-1.5 md:px-5 md:py-2.5 rounded-full bg-zoomBlue hover:bg-zoomBlueHover text-white text-[10px] md:text-xs font-bold transition-all shadow-lg hover:scale-[1.02]"
                        >
                            📊 Usage Reports
                        </button>
                    )}
                </div>

                {/* End / Leave button */}
                <div>
                    <button 
                        onClick={() => {
                            if (confirm("Leave this meeting session?")) {
                                onLeave();
                            }
                        }}
                        className="px-4 py-2 md:px-6 md:py-2 rounded-full bg-zoomRed hover:bg-red-600 text-white text-[10px] md:text-xs font-extrabold transition-all shadow-lg hover:scale-[1.02]"
                    >
                        Leave
                    </button>
                </div>

            </div>

            {/* Host Admittance Request Popup Overlay */}
            {meeting.role === 'host' && joinRequest && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-[#151622] border-2 border-zoomBlue p-6 rounded-2xl max-w-sm w-full shadow-2xl text-center mx-4">
                        <div className="w-12 h-12 rounded-full bg-zoomBlue/15 text-zoomBlue flex items-center justify-center text-xl mx-auto mb-3">
                            👤
                        </div>
                        <h3 className="text-white font-extrabold text-base tracking-wide mb-1">Admittance Request</h3>
                        <p className="text-slate-400 text-xs mb-6">
                            Student <strong className="text-white">{joinRequest.username}</strong> is asking to join this meeting.
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
                                className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-bold transition-all border border-white/10"
                            >
                                Decline
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Participant Waiting Room Overlay */}
            {waitingRoomState === 'waiting' && (
                <div className="fixed inset-0 bg-[#090A0F] z-50 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-16 h-16 rounded-full border-4 border-zoomBlue border-t-transparent animate-spin mb-6"></div>
                    <h2 className="text-xl font-extrabold text-white mb-2">Waiting for Host...</h2>
                    <p className="text-slate-400 text-xs max-w-sm">
                        You have requested to join this meeting. Please wait for the host to admit you to the session.
                    </p>
                    <button 
                        onClick={onLeave}
                        className="mt-8 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-full text-xs font-bold transition-all border border-white/5"
                    >
                        Cancel Request
                    </button>
                </div>
            )}

            {/* Participant Request Declined Overlay */}
            {waitingRoomState === 'declined' && (
                <div className="fixed inset-0 bg-[#090A0F] z-50 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-14 h-14 rounded-full bg-stateRed/15 text-stateRed flex items-center justify-center text-2xl mb-4">
                        ❌
                    </div>
                    <h2 className="text-xl font-extrabold text-stateRed mb-2">Request Declined</h2>
                    <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
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
        </div>
    );
};

export default Meeting;
