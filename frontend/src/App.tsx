import React, { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Meeting from './components/Meeting';
import UsageReport from './components/UsageReport';

export interface UserSession {
    id: number;
    username: string;
    email: string;
}

export interface MeetingSession {
    roomCode: string;
    meetingId: number;
    role: 'host' | 'participant';
}

const App: React.FC = () => {
    const apiBase = (import.meta as any).env.VITE_API_URL || 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://127.0.0.1:5000' 
            : 'https://attentix-meeting.onrender.com');
    
    // Core States
    const [view, setView] = useState<'auth' | 'lobby' | 'meeting' | 'dashboard'>('auth');
    const [user, setUser] = useState<UserSession | null>(null);
    const [meeting, setMeeting] = useState<MeetingSession | null>(null);
    
    // Auth Form States
    const [isRegister, setIsRegister] = useState<boolean>(false);
    const [username, setUsername] = useState<string>('');
    const [email, setEmail] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [successMsg, setSuccessMsg] = useState<string>('');

    // Google Mock states
    const [showGoogleModal, setShowGoogleModal] = useState<boolean>(false);
    const [googleEmail, setGoogleEmail] = useState<string>('');
    const [googleName, setGoogleName] = useState<string>('');
    const [useCustomGoogle, setUseCustomGoogle] = useState<boolean>(false);
    const [googleClientId, setGoogleClientId] = useState<string>(localStorage.getItem('attentix_google_client_id') || '');
    const [tempClientId, setTempClientId] = useState<string>('');

    // Check query params and session storage on mount
    useEffect(() => {
        const storedUser = sessionStorage.getItem('attentix_user');
        
        const fetchGoogleConfig = async () => {
            try {
                const res = await fetch(`${apiBase}/api/auth/google/config`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.client_id) {
                        setGoogleClientId(data.client_id);
                    }
                }
            } catch (err) {
                console.error("Failed to load Google OAuth config from backend:", err);
            }
        };
        fetchGoogleConfig();

        // Check for direct invite links: ?room=xxxxxxxxx
        const urlParams = new URLSearchParams(window.location.search);
        const inviteRoom = urlParams.get('room');
        if (inviteRoom) {
            sessionStorage.setItem('attentix_pending_room', inviteRoom);
        }

        if (storedUser) {
            const parsedUser = JSON.parse(storedUser) as UserSession;
            setUser(parsedUser);
            showLobby(parsedUser);
        }
    }, []);

    const showLobby = async (userSession: UserSession) => {
        setUser(userSession);
        setView('lobby');
        
        // Handle pending invite redirects
        const pendingRoom = sessionStorage.getItem('attentix_pending_room');
        if (pendingRoom) {
            sessionStorage.removeItem('attentix_pending_room');
            try {
                const res = await fetch(`${apiBase}/api/meetings/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meeting_number: pendingRoom, user_id: userSession.id })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Failed to auto-join room');

                setMeeting({
                    roomCode: data.meeting_number,
                    meetingId: data.meeting_id,
                    role: 'participant'
                });
                setView('meeting');
            } catch (err: any) {
                alert('Pending Invite Join Failed: ' + err.message);
            }
        }
    };

    // Bind real Google credential callback to window context for GSI SDK and listen for popup messages
    useEffect(() => {
        (window as any).handleCredentialResponse = async (response: any) => {
            try {
                const idToken = response.credential;
                const payloadBase64 = idToken.split('.')[1];
                const payloadJson = JSON.parse(atob(payloadBase64));
                
                const name = payloadJson.name || payloadJson.given_name || "Google User";
                const email = payloadJson.email;
                
                const res = await fetch(`${apiBase}/api/auth/google-login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, username: name, credential: idToken })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Google sign-in failed');

                setShowGoogleModal(false);
                sessionStorage.setItem('attentix_user', JSON.stringify(data.user));
                showLobby(data.user);
            } catch (err: any) {
                setErrorMsg(err.message);
                setShowGoogleModal(false);
            }
        };

        const handleAuthSuccess = async (name: string, email: string, credential?: string) => {
            try {
                const res = await fetch(`${apiBase}/api/auth/google-login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, username: name, credential })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Google authentication failed');

                sessionStorage.setItem('attentix_user', JSON.stringify(data.user));
                showLobby(data.user);
            } catch (err: any) {
                setErrorMsg(err.message);
            }
        };

        // 1. BroadcastChannel same-origin messaging (preferred)
        const bc = new BroadcastChannel('attentix_auth_channel');
        bc.onmessage = (event) => {
            if (event.data && event.data.type === 'GOOGLE_LOGIN_SUCCESS') {
                handleAuthSuccess(event.data.name, event.data.email, event.data.credential);
            }
        };

        // 2. postMessage window.opener messaging
        const handleGoogleMessage = async (event: MessageEvent) => {
            if (event.data && event.data.type === 'GOOGLE_LOGIN_SUCCESS') {
                const { name, email, credential } = event.data;
                handleAuthSuccess(name, email, credential);
            }
        };
        window.addEventListener('message', handleGoogleMessage);

        // 3. LocalStorage storage events cross-window messaging
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'attentix_google_login_event' && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    handleAuthSuccess(data.name, data.email, data.credential);
                    localStorage.removeItem('attentix_google_login_event');
                } catch (err) {
                    console.error("Failed to parse storage login event:", err);
                }
            }
        };
        window.addEventListener('storage', handleStorageChange);

        return () => {
            bc.close();
            window.removeEventListener('message', handleGoogleMessage);
            window.removeEventListener('storage', handleStorageChange);
        };
    }, []);

    // Initialize and render GSI button dynamically when client ID is loaded
    useEffect(() => {
        if (showGoogleModal && googleClientId && (window as any).google && (window as any).google.accounts) {
            (window as any).google.accounts.id.initialize({
                client_id: googleClientId,
                callback: (window as any).handleCredentialResponse
            });
            setTimeout(() => {
                const btn = document.querySelector(".g_id_signin");
                if (btn) {
                    (window as any).google.accounts.id.renderButton(btn, { theme: "outline", size: "medium" });
                }
            }, 300);
        }
    }, [showGoogleModal, googleClientId]);

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');
        try {
            const res = await fetch(`${apiBase}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Invalid username or password');

            sessionStorage.setItem('attentix_user', JSON.stringify(data.user));
            showLobby(data.user);
        } catch (err: any) {
            setErrorMsg(err.message);
        }
    };

    const handleRegisterSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');
        try {
            const res = await fetch(`${apiBase}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to register');

            setIsRegister(false);
            setUsername('');
            setPassword('');
            setSuccessMsg('Registration successful! Please sign in.');
        } catch (err: any) {
            setErrorMsg(err.message);
        }
    };

    const handleGoogleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');
        try {
            const res = await fetch(`${apiBase}/api/auth/google-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: googleEmail, username: googleName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Google authentication failed');

            setShowGoogleModal(false);
            sessionStorage.setItem('attentix_user', JSON.stringify(data.user));
            showLobby(data.user);
        } catch (err: any) {
            setErrorMsg(err.message);
            setShowGoogleModal(false);
        }
    };

    const openGoogleSignInWindow = () => {
        const width = 450;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const activeClientId = googleClientId || localStorage.getItem('attentix_google_client_id') || '';
        const popupUrl = window.location.origin + "/google-login-page" + 
            (activeClientId ? `?client_id=${encodeURIComponent(activeClientId)}` : '');
            
        window.open(popupUrl, "Google Sign In", `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`);
    };

    const handleSelectGoogleAccount = async (name: string, email: string) => {
        setErrorMsg('');
        setSuccessMsg('');
        try {
            const res = await fetch(`${apiBase}/api/auth/google-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, username: name })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Google authentication failed');

            setShowGoogleModal(false);
            sessionStorage.setItem('attentix_user', JSON.stringify(data.user));
            showLobby(data.user);
        } catch (err: any) {
            setErrorMsg(err.message);
            setShowGoogleModal(false);
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem('attentix_user');
        setUser(null);
        setMeeting(null);
        setView('auth');
        setUsername('');
        setPassword('');
        setErrorMsg('');
        setSuccessMsg('');
    };

    // Render Views
    if (view === 'auth') {
        return (
            <div className="flex-grow flex items-center justify-center p-6 min-h-screen premium-bg">
                <div className="glass-panel w-full max-w-sm p-8 rounded-2xl shadow-2xl relative text-center overflow-hidden">
                    {/* Gradient accent background glows */}
                    <div className="absolute -top-16 -right-16 w-32 h-32 bg-zoomBlue/15 rounded-full blur-3xl"></div>
                    <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-zoomOrange/10 rounded-full blur-3xl"></div>
                    
                    <div className="mb-6 z-10 relative">
                        <h1 className="text-3xl font-black gradient-text-blue tracking-tight">
                            Attentix
                        </h1>
                        <p className="text-zoomTextSec text-[11px] mt-1.5 font-medium">Sign in to start or join meetings</p>
                    </div>

                    {successMsg && <div className="bg-stateGreen/10 border border-stateGreen/20 text-stateGreen p-2.5 rounded-lg text-xs font-semibold mb-4 z-10 relative">{successMsg}</div>}
                    {errorMsg && <div className="bg-stateRed/10 border border-stateRed/20 text-stateRed p-2.5 rounded-lg text-xs font-semibold mb-4 z-10 relative">{errorMsg}</div>}

                    {!isRegister ? (
                        <form onSubmit={handleLoginSubmit} className="space-y-4 text-left z-10 relative">
                            <div>
                                <label className="block text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider mb-1.5">Username</label>
                                <input type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue transition-all text-xs" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider mb-1.5">Password</label>
                                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue transition-all text-xs" />
                            </div>
                            <button type="submit" className="w-full py-2.5 mt-2 rounded-lg btn-premium-blue text-white font-bold text-xs transition-all shadow-lg">Sign In</button>
                            
                            <div className="relative my-4 flex items-center justify-center">
                                <div className="border-t border-white/10 w-full"></div>
                                <span className="absolute bg-[#1e1e21] px-2 text-[9px] text-zoomTextSec uppercase tracking-widest">or</span>
                            </div>

                            <button 
                                type="button" 
                                onClick={openGoogleSignInWindow} 
                                className="w-full py-2.5 rounded-lg bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-md hover:scale-[1.01]"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                                </svg>
                                Sign in with Google
                            </button>

                            <div className="text-[11px] text-zoomTextSec text-center mt-4">
                                Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(true); setErrorMsg(''); setSuccessMsg(''); }} className="text-zoomBlue hover:underline font-semibold">Register here</a>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleRegisterSubmit} className="space-y-4 text-left z-10 relative">
                            <div>
                                <label className="block text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider mb-1.5">Username</label>
                                <input type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose username" className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue transition-all text-xs" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider mb-1.5">Email Address</label>
                                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter email" className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue transition-all text-xs" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold text-zoomTextSec uppercase tracking-wider mb-1.5">Password</label>
                                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Choose password" className="w-full px-3 py-2.5 rounded-lg bg-zoomCard border border-white/10 text-white outline-none focus:border-zoomBlue transition-all text-xs" />
                            </div>
                            <button type="submit" className="w-full py-2.5 mt-2 rounded-lg btn-premium-blue text-white font-bold text-xs transition-all shadow-lg">Create Account</button>
                            
                            <div className="relative my-4 flex items-center justify-center">
                                <div className="border-t border-white/10 w-full"></div>
                                <span className="absolute bg-[#1e1e21] px-2 text-[9px] text-zoomTextSec uppercase tracking-widest">or</span>
                            </div>

                            <button 
                                type="button" 
                                onClick={openGoogleSignInWindow} 
                                className="w-full py-2.5 rounded-lg bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-md hover:scale-[1.01]"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                                </svg>
                                Sign in with Google
                            </button>

                            <div className="text-[11px] text-zoomTextSec text-center mt-4">
                                Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(false); setErrorMsg(''); setSuccessMsg(''); }} className="text-zoomBlue hover:underline font-semibold">Sign In here</a>
                            </div>
                        </form>
                    )}
                </div>


            </div>
        );
    }

    if (view === 'lobby' && user) {
        return (
            <Lobby 
                user={user} 
                onLogout={handleLogout} 
                onEnterMeeting={(sess: MeetingSession) => {
                    setMeeting(sess);
                    setView('meeting');
                }} 
            />
        );
    }

    if (view === 'meeting' && user && meeting) {
        return (
            <Meeting 
                user={user} 
                meeting={meeting} 
                onLeave={() => {
                    setView('lobby');
                    setMeeting(null);
                }} 
                onOpenDashboard={() => setView('dashboard')}
            />
        );
    }

    if (view === 'dashboard' && user && meeting) {
        return (
            <UsageReport 
                user={user} 
                meeting={meeting} 
                onReturnToMeeting={() => setView('meeting')}
            />
        );
    }

    return null;
};

export default App;
