/**
 * FocusGuard Main Frontend Orchestrator
 * Handles Login, Registration, and Lobby redirection
 */

document.addEventListener('DOMContentLoaded', () => {
    const apiBase = window.location.origin;

    // Parse query parameters for direct invite link joining
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');
    if (inviteRoom) {
        sessionStorage.setItem('fg_pending_room', inviteRoom);
    }

    // DOM Elements
    const authView = document.getElementById('auth-view');
    const lobbyView = document.getElementById('lobby-view');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const authError = document.getElementById('auth-error');
    
    const goToRegister = document.getElementById('go-to-register');
    const goToLogin = document.getElementById('go-to-login');
    const authSubtitle = document.getElementById('auth-subtitle');

    const userDisplay = document.getElementById('user-display');
    const lobbyGreeting = document.getElementById('lobby-greeting');
    const btnLogout = document.getElementById('btn-logout');

    const btnCreateMeeting = document.getElementById('btn-create-meeting');
    const btnJoinMeeting = document.getElementById('btn-join-meeting');
    const joinRoomNumber = document.getElementById('join-room-number');

    // UI View Toggles
    goToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        authSubtitle.textContent = 'Create your free account';
        authError.style.display = 'none';
    });

    goToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        authSubtitle.textContent = 'Continuous Attention Monitoring Meeting Client';
        authError.style.display = 'none';
    });

    // Check user login state on startup
    const currentUser = JSON.parse(sessionStorage.getItem('fg_user'));
    if (currentUser) {
        showLobby(currentUser);
    }

    // Submit Registration Form
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.style.display = 'none';

        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        try {
            const res = await fetch(`${apiBase}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to register');

            // Switch back to login
            registerForm.reset();
            goToLogin.click();
            authError.textContent = 'Registration successful! Please sign in.';
            authError.style.color = '#10b981';
            authError.style.display = 'block';
        } catch (err) {
            authError.textContent = err.message;
            authError.style.color = '#ef4444';
            authError.style.display = 'block';
        }
    });

    // Submit Login Form
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.style.display = 'none';

        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch(`${apiBase}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invalid credentials');

            sessionStorage.setItem('fg_user', JSON.stringify(data.user));
            showLobby(data.user);
        } catch (err) {
            authError.textContent = err.message;
            authError.style.color = '#ef4444';
            authError.style.display = 'block';
        }
    });

    // Logout
    btnLogout.addEventListener('click', () => {
        sessionStorage.removeItem('fg_user');
        lobbyView.style.display = 'none';
        authView.style.display = 'flex';
        loginForm.reset();
        registerForm.reset();
    });

    // Host/Create Meeting
    btnCreateMeeting.addEventListener('click', async () => {
        const user = JSON.parse(sessionStorage.getItem('fg_user'));
        if (!user) return;

        try {
            const res = await fetch(`${apiBase}/api/meetings/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_id: user.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create meeting');

            // Redirect as host
            window.location.href = `meeting.html?room=${data.meeting_number}&role=host&id=${data.meeting_id}`;
        } catch (err) {
            alert('Meeting creation failed: ' + err.message);
        }
    });

    // Join Meeting
    btnJoinMeeting.addEventListener('click', async () => {
        const user = JSON.parse(sessionStorage.getItem('fg_user'));
        if (!user) return;

        const roomNum = joinRoomNumber.value.trim();
        if (roomNum.length !== 9 || isNaN(roomNum)) {
            alert('Please enter a valid 9-digit Room Code');
            return;
        }

        try {
            const res = await fetch(`${apiBase}/api/meetings/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meeting_number: roomNum, user_id: user.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to join meeting. Confirm code is active.');

            // Redirect as participant
            window.location.href = `meeting.html?room=${data.meeting_number}&role=participant&id=${data.meeting_id}`;
        } catch (err) {
            alert('Cannot join meeting: ' + err.message);
        }
    });

    async function showLobby(user) {
        authView.style.display = 'none';
        lobbyView.style.display = 'flex';
        userDisplay.textContent = user.username;
        lobbyGreeting.textContent = `Welcome back, ${user.username}!`;

        // Check if there is a pending room from an invite link
        const pendingRoom = sessionStorage.getItem('fg_pending_room');
        if (pendingRoom) {
            sessionStorage.removeItem('fg_pending_room');
            try {
                const res = await fetch(`${apiBase}/api/meetings/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meeting_number: pendingRoom, user_id: user.id })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to auto-join room');

                window.location.href = `meeting.html?room=${data.meeting_number}&role=participant&id=${data.meeting_id}`;
            } catch (err) {
                alert('Failed to join pending invite room: ' + err.message);
            }
        }
    }
});
