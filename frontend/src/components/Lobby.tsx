import React, { useState, useEffect } from 'react';
import { Video, LogOut, Clock, Calendar } from 'lucide-react';
import { UserSession, MeetingSession } from '../App';

interface LobbyProps {
    user: UserSession;
    onLogout: () => void;
    onEnterMeeting: (session: MeetingSession) => void;
}

const Lobby: React.FC<LobbyProps> = ({ user, onLogout, onEnterMeeting }) => {
    const rawApiBase = (import.meta as any).env.VITE_API_URL || 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://127.0.0.1:5000' 
            : 'https://attentix-meeting.onrender.com');
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

    // Real-Time Clock & Scheduled meetings load
    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setDate(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
        };
        updateClock();
        const interval = setInterval(updateClock, 1000);
        
        loadScheduledMeetings();
        
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
        try {
            const res = await fetch(`${apiBase}/api/meetings/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_id: user.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to create meeting');

            onEnterMeeting({
                roomCode: data.meeting_number,
                meetingId: data.meeting_id,
                role: 'host'
            });
        } catch (err: any) {
            alert('Meeting Creation Failed: ' + err.message);
        }
    };

    const handleJoinMeeting = async () => {
        const cleanedCode = roomCodeInput.trim();
        if (cleanedCode.length !== 9 || isNaN(Number(cleanedCode))) {
            alert('Please enter a valid 9-digit Room Code');
            return;
        }

        try {
            const res = await fetch(`${apiBase}/api/meetings/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meeting_number: cleanedCode, user_id: user.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to join meeting. Confirm code is active.');

            onEnterMeeting({
                roomCode: data.meeting_number,
                meetingId: data.meeting_id,
                role: 'participant'
            });
        } catch (err: any) {
            alert('Cannot Join Meeting: ' + err.message);
        }
    };

    const handleScheduleMeeting = async (e: React.FormEvent) => {
        e.preventDefault();
        const combinedDateTime = `${scheduleDate}T${scheduleTime}`;
        try {
            const res = await fetch(`${apiBase}/api/meetings/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host_id: user.id,
                    topic: scheduleTopic,
                    scheduled_time: combinedDateTime,
                    duration: Number(scheduleDuration)
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to schedule meeting');

            alert(`Meeting scheduled successfully! Meeting ID: ${data.meeting_number}`);
            setShowScheduleModal(false);
            setScheduleTopic('');
            setScheduleDate('');
            setScheduleTime('');
            loadScheduledMeetings();
        } catch (err: any) {
            alert('Cannot Schedule Meeting: ' + err.message);
        }
    };

    return (
        <div className="flex flex-col min-h-screen premium-bg text-zoomText font-sans">
            {/* Nav Header */}
            <nav className="flex justify-between items-center px-8 py-3 bg-[#18181a]/80 backdrop-blur-md border-b border-zoomBorder sticky top-0 z-50">
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
                            <h3 className="text-xs font-bold mb-6 text-zoomTextSec uppercase tracking-widest">Start or Join Meeting</h3>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={handleCreateMeeting}
                                    className="flex flex-col items-center justify-center p-6 btn-premium-orange rounded-xl transition-all shadow-lg group premium-glow-orange"
                                >
                                    <Video size={36} className="text-white mb-3 group-hover:scale-105 transition-all duration-300" />
                                    <span className="text-xs font-bold text-white">New Meeting</span>
                                </button>

                                <button 
                                    onClick={() => setShowScheduleModal(true)}
                                    className="flex flex-col items-center justify-center p-6 premium-card rounded-xl transition-all shadow-md group"
                                >
                                    <span className="text-3xl mb-3 text-zoomBlue group-hover:scale-105 transition-all duration-300">📅</span>
                                    <span className="text-xs font-bold text-white">Schedule</span>
                                </button>
                            </div>

                            <div className="mt-6 flex flex-col gap-2">
                                <input 
                                    type="text" 
                                    value={roomCodeInput}
                                    onChange={e => setRoomCodeInput(e.target.value)}
                                    placeholder="Enter 9-Digit Meeting ID" 
                                    maxLength={9} 
                                    className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-zoomBorder text-white outline-none focus:border-zoomBlue text-center text-sm font-mono tracking-widest transition-all"
                                />
                                <button 
                                    onClick={handleJoinMeeting}
                                    className="w-full py-2.5 btn-premium-blue text-white text-xs font-bold rounded-lg transition-all shadow-lg"
                                >
                                    Join Meeting
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
            </div>

            {/* Due Meeting Host Notification Toast */}
            {dueMeeting && (
                <div className="fixed top-20 right-6 w-80 bg-[#1e1e21] border-2 border-zoomBlue rounded-xl p-4 shadow-2xl z-50 animate-pulse">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold text-zoomBlue uppercase tracking-widest flex items-center gap-1">
                            🔔 Scheduled Meeting Due
                        </span>
                        <button onClick={() => setDueMeeting(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
                    </div>
                    <h4 className="text-xs font-bold text-white mb-1 truncate">{dueMeeting.topic}</h4>
                    <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                        The scheduled start time for this meeting has arrived. Click below to activate and launch the session.
                    </p>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setDueMeeting(null)}
                            className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold rounded-lg transition-all"
                        >
                            Later
                        </button>
                        <button 
                            onClick={async () => {
                                try {
                                    const res = await fetch(`${apiBase}/api/meetings/join`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ meeting_number: dueMeeting.meeting_number, user_id: user.id })
                                    });
                                    const data = await res.json();
                                    if (!res.ok) throw new Error(data.detail || 'Failed to start scheduled meeting');

                                    onEnterMeeting({
                                        roomCode: data.meeting_number,
                                        meetingId: data.meeting_id,
                                        role: 'host'
                                    });
                                    setDueMeeting(null);
                                } catch (err: any) {
                                    alert('Cannot start scheduled meeting: ' + err.message);
                                }
                            }}
                            className="flex-1 py-1.5 bg-zoomOrange hover:bg-zoomOrangeHover text-white text-[10px] font-bold rounded-lg transition-all"
                        >
                            Start Now
                        </button>
                    </div>
                </div>
            )}

            {/* Schedule Meeting Modal Dialog */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-[#1e1e21] border border-white/10 p-6 rounded-2xl max-w-sm w-full shadow-2xl relative text-left mx-4">
                        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                            <span>📅</span> Schedule New Meeting
                        </h3>
                        
                        <form onSubmit={handleScheduleMeeting} className="space-y-4">
                            <div>
                                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Meeting Topic</label>
                                <input type="text" required value={scheduleTopic} onChange={e => setScheduleTopic(e.target.value)} placeholder="Attentix Alignment" className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue text-xs" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Date</label>
                                    <input type="date" required value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue text-xs" />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Time</label>
                                    <input type="time" required value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue text-xs" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Duration</label>
                                <select value={scheduleDuration} onChange={e => setScheduleDuration(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-zoomCard border border-white/10 text-slate-300 outline-none focus:border-zoomBlue text-xs">
                                    <option value={15}>15 minutes</option>
                                    <option value={30}>30 minutes</option>
                                    <option value={40}>40 minutes</option>
                                    <option value={60}>60 minutes</option>
                                    <option value={90}>90 minutes</option>
                                </select>
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setShowScheduleModal(false)} className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition-all">Cancel</button>
                                <button type="submit" className="flex-1 py-2 rounded-lg bg-zoomBlue hover:bg-zoomBlueHover text-white text-xs font-bold transition-all">Schedule</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Lobby;
