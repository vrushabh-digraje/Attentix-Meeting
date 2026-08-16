import os
import random
import string
import sys
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
import socketio
import hashlib
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import threading
import time

# Ensure backend folder is in path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import DatabaseManager, User, Meeting, Participant, AttentionLog, ScheduledMeeting

# Secure Password Hashing helpers using native hashlib (PBKDF2 SHA256)
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return f"{salt}${key.hex()}"

def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt, key_hex = hashed_password.split('$')
        new_key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return secrets.compare_digest(new_key.hex(), key_hex)
    except Exception:
        return False

# Initialize FastAPI
app = FastAPI(title="Attentix API")

# Add CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Socket.IO AsyncServer
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, app)

# Database Manager
DATABASE_URL = os.environ.get('DATABASE_URL')
db_manager = DatabaseManager(DATABASE_URL)

# Pydantic Schemas
class RegisterSchema(BaseModel):
    username: str
    email: str
    password: str

class LoginSchema(BaseModel):
    username: str
    password: str

class CreateMeetingSchema(BaseModel):
    host_id: int

class JoinMeetingSchema(BaseModel):
    meeting_number: str
    user_id: int

class LogAttentionSchema(BaseModel):
    meeting_id: int
    user_id: int
    attention_score: float
    state: str
    warnings_count: int

class BatchLogAttentionSchema(BaseModel):
    logs: List[LogAttentionSchema]

class GoogleLoginSchema(BaseModel):
    credential: Optional[str] = None
    email: Optional[str] = None
    username: Optional[str] = None

class ScheduleMeetingSchema(BaseModel):
    host_id: int
    topic: str
    scheduled_time: str
    duration: int

# Helpers
def generate_meeting_number():
    return ''.join(random.choices(string.digits, k=9))

# Authentication Routes
@app.post("/api/auth/register")
async def register(data: RegisterSchema):
    session = db_manager.get_session()
    try:
        existing_user = session.query(User).filter((User.username == data.username) | (User.email == data.email)).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username or email already registered")
        
        hashed_password = hash_password(data.password)
        new_user = User(
            username=data.username,
            email=data.email,
            password_hash=hashed_password
        )
        session.add(new_user)
        session.commit()
        return {"message": "User registered successfully", "user": {"id": new_user.id, "username": new_user.username}}
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.post("/api/auth/login")
async def login(data: LoginSchema):
    session = db_manager.get_session()
    try:
        user = session.query(User).filter(User.username == data.username).first()
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        
        return {
            "message": "Login successful",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

def verify_google_token(id_token: str, client_id: Optional[str] = None) -> dict:
    url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            if "error_description" in data:
                raise Exception(data["error_description"])
                
            iss = data.get("iss")
            if iss not in ["accounts.google.com", "https://accounts.google.com"]:
                raise Exception("Invalid token issuer")
                
            if client_id:
                aud = data.get("aud")
                if aud != client_id:
                    raise Exception("Audience mismatch")
                    
            exp = int(data.get("exp", 0))
            if time.time() > exp:
                raise Exception("Token has expired")
                
            return data
    except Exception as e:
        raise Exception(f"Google token verification failed: {str(e)}")

@app.get("/api/auth/google/config")
async def get_google_config():
    return {
        "client_id": os.environ.get('GOOGLE_CLIENT_ID', '')
    }

@app.post("/api/auth/google-login")
async def google_login(data: GoogleLoginSchema):
    session = db_manager.get_session()
    try:
        email = data.email
        username = data.username
        
        # Verify Google credential token if provided
        if data.credential:
            google_client_id = os.environ.get('GOOGLE_CLIENT_ID')
            try:
                payload = verify_google_token(data.credential, google_client_id)
                email = payload.get('email')
                username = payload.get('name') or payload.get('email', '').split('@')[0]
                if not email:
                    raise HTTPException(status_code=400, detail="Invalid Google token: email not found")
            except Exception as token_err:
                raise HTTPException(status_code=400, detail=str(token_err))
        else:
            # Fallback to simulation if email and username are passed (for local offline testing)
            if not email or not username:
                raise HTTPException(status_code=400, detail="Google authentication requires valid credential or profile")
            print("WARNING: Simulated login without Google OAuth token verification.")
            
        user = session.query(User).filter(User.email == email).first()
        if not user:
            random_pw = secrets.token_hex(16)
            hashed_password = hash_password(random_pw)
            base_username = username.replace(" ", "").lower()
            u_name = base_username
            counter = 1
            while session.query(User).filter(User.username == u_name).first():
                u_name = f"{base_username}{counter}"
                counter += 1

            user = User(
                username=u_name,
                email=email,
                password_hash=hashed_password
            )
            session.add(user)
            session.commit()

        return {
            "message": "Google Login successful",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.get("/google-login-page", response_class=HTMLResponse)
async def google_login_page():
    import getpass
    
    # Get active local PC user credentials dynamically
    try:
        pc_user = getpass.getuser()
    except Exception:
        pc_user = "Babar"
        
    pc_display_name = pc_user.title()
    clean_pc_user = pc_user.lower().replace(" ", "")
    pc_email = f"{clean_pc_user}@gmail.com"
    
    # Standardize common defaults to professional values
    if pc_display_name.lower() in ["asus", "admin", "administrator", "user", "owner"]:
        pc_display_name = "Babar Ali"
        pc_email = "babar.ali@gmail.com"

    alternative_accounts = [
        {"name": "Babar Ali", "email": "babar.ali@gmail.com", "avatar": "B", "class": "b"},
        {"name": "Jane Doe", "email": "jane.doe@gmail.com", "avatar": "J", "class": "j"},
        {"name": "John Smith", "email": "john.smith@gmail.com", "avatar": "S", "class": "s"}
    ]
    
    # Filter out duplicate matching the PC display name
    alternative_accounts = [acc for acc in alternative_accounts if acc["name"].lower() != pc_display_name.lower()]
    
    accounts_html = ""
    for acc in alternative_accounts:
        accounts_html += f"""
            <div class="account-item" onclick="selectAccount('{acc['name']}', '{acc['email']}')">
                <div class="avatar {acc['class']}">{acc['avatar']}</div>
                <div class="account-details">
                    <span class="account-name">{acc['name']}</span>
                    <span class="account-email">{acc['email']}</span>
                </div>
            </div>
        """

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Sign in - Google Accounts</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <style>
        body {{
            font-family: 'Roboto', sans-serif;
            background-color: #ffffff;
            color: #202124;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }}
        .card {{
            width: 100%;
            max-width: 450px;
            min-height: 500px;
            padding: 40px;
            box-sizing: border-box;
            border: 1px solid #dadce0;
            border-radius: 8px;
            text-align: center;
            background: #ffffff;
        }}
        .logo {{
            font-size: 24px;
            font-weight: 500;
            letter-spacing: -0.5px;
            margin-bottom: 16px;
        }}
        .logo span:nth-child(1) {{ color: #4285F4; }}
        .logo span:nth-child(2) {{ color: #EA4335; }}
        .logo span:nth-child(3) {{ color: #FBBC05; }}
        .logo span:nth-child(4) {{ color: #4285F4; }}
        .logo span:nth-child(5) {{ color: #34A853; }}
        .logo span:nth-child(6) {{ color: #EA4335; }}
        
        h1 {{
            font-size: 24px;
            font-weight: 400;
            line-height: 32px;
            margin: 0 0 8px 0;
        }}
        .subtitle {{
            font-size: 16px;
            color: #5f6368;
            margin: 0 0 28px 0;
        }}
        .accounts-list {{
            border: 1px solid #dadce0;
            border-radius: 8px;
            text-align: left;
            margin-bottom: 24px;
            overflow: hidden;
        }}
        .account-item {{
            display: flex;
            align-items: center;
            padding: 16px;
            border-bottom: 1px solid #dadce0;
            cursor: pointer;
            transition: background-color 0.15s;
            position: relative;
        }}
        .account-item:last-child {{
            border-bottom: none;
        }}
        .account-item:hover {{
            background-color: #f8f9fa;
        }}
        .avatar {{
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 500;
            font-size: 14px;
            margin-right: 12px;
        }}
        .avatar.pc {{ background-color: #1a73e8; }}
        .avatar.b {{ background-color: #c53929; }}
        .avatar.j {{ background-color: #ab47bc; }}
        .avatar.s {{ background-color: #0f9d58; }}
        .account-details {{
            display: flex;
            flex-direction: column;
        }}
        .account-name {{
            font-size: 14px;
            font-weight: 500;
            color: #3c4043;
        }}
        .account-email {{
            font-size: 12px;
            color: #5f6368;
        }}
        .device-badge {{
            position: absolute;
            right: 16px;
            font-size: 10px;
            color: #34a853;
            background-color: #e6f4ea;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 500;
        }}
        .use-another {{
            color: #1a73e8;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
            margin-top: 16px;
            cursor: pointer;
            text-align: left;
        }}
        .use-another:hover {{
            text-decoration: underline;
        }}
        .footer {{
            font-size: 11px;
            color: #5f6368;
            margin-top: 40px;
            line-height: 1.5;
            text-align: left;
        }}
        .footer a {{
            color: #1a73e8;
            text-decoration: none;
        }}
        .footer a:hover {{
            text-decoration: underline;
        }}
        /* Custom Account Form */
        .custom-form {{
            display: none;
            text-align: left;
        }}
        .input-group {{
            margin-bottom: 16px;
        }}
        label {{
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 6px;
            color: #5f6368;
        }}
        input {{
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #dadce0;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
        }}
        input:focus {{
            border-color: #1a73e8;
            outline: none;
        }}
        .btn-group {{
            display: flex;
            gap: 12px;
            margin-top: 24px;
            justify-content: flex-end;
        }}
        .btn {{
            padding: 8px 24px;
            font-size: 14px;
            font-weight: 500;
            border-radius: 4px;
            border: none;
            cursor: pointer;
        }}
        .btn-primary {{
            background-color: #1a73e8;
            color: white;
        }}
        .btn-primary:hover {{
            background-color: #1557b0;
        }}
        .btn-secondary {{
            background-color: transparent;
            color: #1a73e8;
        }}
        .btn-secondary:hover {{
            background-color: #f8f9fa;
        }}
        /* Loader styles */
        .loader-overlay {{
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: white;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10;
        }}
        .spinner {{
            width: 32px;
            height: 32px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #1a73e8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 16px;
        }}
        @keyframes spin {{
            0% {{ transform: rotate(0deg); }}
            100% {{ transform: rotate(360deg); }}
        }}
    </style>
</head>
<body>
    <div class="card" id="selection-view">
        <div class="logo">
            <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
        </div>
        <h1>Choose an account</h1>
        <p class="subtitle">to continue to Attentix</p>

        <!-- Official Google Sign-In Button Container -->
        <div id="gsi-button-container" style="display: none; margin-bottom: 24px; justify-content: center;">
            <div id="gsi-button"></div>
        </div>
        
        <div id="divider-text" style="display: none; position: relative; margin: 24px 0; align-items: center; justify-content: center;">
            <div style="border-top: 1px solid #dadce0; width: 100%;"></div>
            <span style="position: absolute; background: white; padding: 0 12px; font-size: 10px; text-transform: uppercase; color: #5f6368; font-weight: 700; letter-spacing: 1.2px;">or choose account</span>
        </div>
        
        <div class="accounts-list">
            <!-- Dynamically discovered system active account -->
            <div class="account-item" onclick="selectAccount('{pc_display_name}', '{pc_email}')">
                <div class="avatar pc">{pc_display_name[0].upper()}</div>
                <div class="account-details">
                    <span class="account-name">{pc_display_name}</span>
                    <span class="account-email">{pc_email}</span>
                </div>
                <span class="device-badge">Signed In</span>
            </div>

            {accounts_html}
        </div>
        
        <div style="text-align: left; margin-bottom: 16px;">
            <div class="use-another" onclick="showCustomForm()">👤 Use another account</div>
        </div>
        
        <div class="footer">
            To continue, Google will share your name, email address, and profile picture with Attentix. 
            Before using this app, you can review Attentix's <a href="#">privacy policy</a> and <a href="#">terms of service</a>.
        </div>
    </div>

    <!-- Custom Profile Form -->
    <div class="card custom-form" id="form-view">
        <div class="logo">
            <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
        </div>
        <h1>Sign in with Google</h1>
        <p class="subtitle">to continue to Attentix</p>
        
        <form onsubmit="submitForm(event)">
            <div class="input-group">
                <label>Full Name</label>
                <input type="text" id="custom-name" required placeholder="Enter full name">
            </div>
            <div class="input-group">
                <label>Email Address</label>
                <input type="email" id="custom-email" required placeholder="Enter email address">
            </div>
            
            <div class="btn-group">
                <button type="button" class="btn btn-secondary" onclick="showSelectionView()">Back</button>
                <button type="submit" class="btn btn-primary">Next</button>
            </div>
        </form>
    </div>

    <!-- Loader Overlay -->
    <div class="loader-overlay" id="loader">
        <div class="spinner"></div>
        <div style="font-size: 13px; color: #5f6368; font-weight: 500;">Signing in with Google...</div>
    </div>

    <script>
        window.onload = function() {{
            const urlParams = new URLSearchParams(window.location.search);
            let clientId = urlParams.get('client_id');
            if (!clientId) {{
                clientId = localStorage.getItem('attentix_google_client_id');
            }}
            if (clientId) {{
                initializeRealGoogle(clientId);
            }}
        }};

        function initializeRealGoogle(clientId) {{
            document.getElementById('gsi-button-container').style.display = 'flex';
            document.getElementById('divider-text').style.display = 'flex';
            
            if (typeof google !== 'undefined' && google.accounts) {{
                google.accounts.id.initialize({{
                    client_id: clientId,
                    callback: handleCredentialResponse
                }});
                google.accounts.id.renderButton(
                    document.getElementById("gsi-button"),
                    {{ theme: "outline", size: "large", width: 370 }}
                );
            }} else {{
                setTimeout(() => initializeRealGoogle(clientId), 200);
            }}
        }}

        function handleCredentialResponse(response) {{
            try {{
                const jwt = response.credential;
                const payload = JSON.parse(atob(jwt.split('.')[1]));
                const name = payload.name;
                const email = payload.email;
                selectAccount(name, email, jwt);
            }} catch (err) {{
                console.error("Failed to parse Google JWT credential:", err);
            }}
        }}

        function selectAccount(name, email, credential = null) {{
            document.getElementById('loader').style.display = 'flex';
            setTimeout(() => {{
                // 1. Dispatch over BroadcastChannel
                try {{
                    const bc = new BroadcastChannel('attentix_auth_channel');
                    bc.postMessage({{
                        type: 'GOOGLE_LOGIN_SUCCESS',
                        name: name,
                        email: email,
                        credential: credential
                    }});
                    bc.close();
                }} catch (bcErr) {{
                    console.error("BroadcastChannel message failed:", bcErr);
                }}

                // 2. Dispatch over postMessage (window.opener)
                try {{
                    if (window.opener) {{
                        window.opener.postMessage({{
                            type: 'GOOGLE_LOGIN_SUCCESS',
                            name: name,
                            email: email,
                            credential: credential
                        }}, '*');
                    }}
                }} catch (pmErr) {{
                    console.error("postMessage window.opener failed:", pmErr);
                }}

                // 3. Dispatch over LocalStorage events
                try {{
                    localStorage.setItem('attentix_google_login_event', JSON.stringify({{
                        name: name,
                        email: email,
                        credential: credential,
                        timestamp: Date.now()
                    }}));
                }} catch (lsErr) {{
                    console.error("LocalStorage event failed:", lsErr);
                }}

                window.close();
            }}, 800);
        }}

        function showCustomForm() {{
            document.getElementById('selection-view').style.display = 'none';
            document.getElementById('form-view').style.display = 'block';
        }}

        function showSelectionView() {{
            document.getElementById('selection-view').style.display = 'block';
            document.getElementById('form-view').style.display = 'none';
        }}

        function submitForm(e) {{
            e.preventDefault();
            const name = document.getElementById('custom-name').value;
            const email = document.getElementById('custom-email').value;
            selectAccount(name, email);
        }}
    </script>
</body>
</html>
"""
    return HTMLResponse(content=html_content)

# Meeting Routes
@app.post("/api/meetings/create")
async def create_meeting(data: CreateMeetingSchema):
    session = db_manager.get_session()
    try:
        meeting_number = generate_meeting_number()
        new_meeting = Meeting(
            meeting_number=meeting_number,
            host_id=data.host_id,
            start_time=datetime.utcnow(),
            is_active=True
        )
        session.add(new_meeting)
        session.commit()
        return {
            "meeting_number": meeting_number,
            "meeting_id": new_meeting.id
        }
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.post("/api/meetings/join")
async def join_meeting_api(data: JoinMeetingSchema):
    session = db_manager.get_session()
    try:
        meeting = session.query(Meeting).filter(Meeting.meeting_number == data.meeting_number, Meeting.is_active == True).first()
        if not meeting:
            scheduled = session.query(ScheduledMeeting).filter(ScheduledMeeting.meeting_number == data.meeting_number).first()
            if scheduled and scheduled.host_id == data.user_id:
                meeting = Meeting(
                    meeting_number=data.meeting_number,
                    host_id=data.user_id,
                    start_time=datetime.utcnow(),
                    is_active=True
                )
                session.add(meeting)
                session.delete(scheduled) # Remove from scheduled list since it is now active
                session.commit()
            else:
                raise HTTPException(status_code=404, detail="Active meeting not found")
        
        participant = session.query(Participant).filter(Participant.meeting_id == meeting.id, Participant.user_id == data.user_id, Participant.left_at == None).first()
        if not participant:
            participant = Participant(
                meeting_id=meeting.id,
                user_id=data.user_id,
                joined_at=datetime.utcnow()
            )
            session.add(participant)
            session.commit()
            
        return {
            "message": "Joined meeting registry",
            "meeting_id": meeting.id,
            "meeting_number": meeting.meeting_number,
            "host_id": meeting.host_id
        }
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.post("/api/meetings/schedule")
async def schedule_meeting(data: ScheduleMeetingSchema):
    session = db_manager.get_session()
    try:
        meeting_number = generate_meeting_number()
        try:
            scheduled_dt = datetime.fromisoformat(data.scheduled_time.replace("Z", ""))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date-time format. Use ISO format.")
            
        new_scheduled = ScheduledMeeting(
            meeting_number=meeting_number,
            host_id=data.host_id,
            topic=data.topic,
            scheduled_time=scheduled_dt,
            duration=data.duration
        )
        session.add(new_scheduled)
        session.commit()

        # Send confirmation email to host
        host = session.query(User).filter(User.id == data.host_id).first()
        if host and host.email:
            subject = f"Attentix Confirmation: Meeting '{data.topic}' Scheduled Successfully"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; background-color: #0b0b0c; color: #ffffff; padding: 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background-color: #161618; border: 1px solid #2f2f33; padding: 30px; border-radius: 12px;">
                        <h2 style="color: #2D8CFF; margin-bottom: 20px; font-weight: 900;">Attentix Meeting Scheduled</h2>
                        <p style="font-size: 14px; color: #d0d0d8;">Hello <strong>{host.username}</strong>,</p>
                        <p style="font-size: 14px; color: #d0d0d8;">Your upcoming meeting has been scheduled successfully!</p>
                        <div style="background-color: #242428; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2D8CFF;">
                            <p style="margin: 0; font-size: 13px; color: #ffffff;"><strong>Topic:</strong> {data.topic}</p>
                            <p style="margin: 6px 0 0 0; font-size: 13px; color: #ffffff;"><strong>Meeting ID:</strong> {meeting_number}</p>
                            <p style="margin: 6px 0 0 0; font-size: 13px; color: #ffffff;"><strong>Scheduled Time:</strong> {scheduled_dt.strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
                            <p style="margin: 6px 0 0 0; font-size: 13px; color: #ffffff;"><strong>Duration:</strong> {data.duration} minutes</p>
                        </div>
                        <p style="font-size: 14px; color: #d0d0d8;">We will email you a reminder notification when the meeting start time arrives.</p>
                        <hr style="border: 0; border-top: 1px solid #2f2f33; margin: 30px 0;" />
                        <p style="font-size: 10px; color: #82828c;">This is an automated notification from Attentix. You received this email because you scheduled a meeting session.</p>
                    </div>
                </body>
            </html>
            """
            send_email_notification(host.email, subject, html_body)

        return {
            "message": "Meeting scheduled successfully",
            "meeting_number": meeting_number
        }
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.get("/api/meetings/scheduled/{user_id}")
async def get_scheduled_meetings(user_id: int):
    session = db_manager.get_session()
    try:
        now = datetime.utcnow()
        expired_threshold = now - timedelta(minutes=15)
        
        # Clean up any scheduled meetings that expired (started >15 minutes ago but never started)
        expired_meetings = session.query(ScheduledMeeting).filter(
            ScheduledMeeting.scheduled_time < expired_threshold
        ).all()
        for m in expired_meetings:
            session.delete(m)
        if expired_meetings:
            session.commit()

        # Fetch scheduled meetings that are upcoming OR started within the last 15 minutes
        meetings = session.query(ScheduledMeeting).filter(
            ScheduledMeeting.scheduled_time >= expired_threshold
        ).order_by(ScheduledMeeting.scheduled_time.asc()).all()
        
        results = []
        for m in meetings:
            results.append({
                "id": m.id,
                "meeting_number": m.meeting_number,
                "topic": m.topic,
                "scheduled_time": m.scheduled_time.isoformat(),
                "duration": m.duration
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

# Attention Score Logging API
@app.post("/api/attention/log")
async def log_attention(data: LogAttentionSchema):
    session = db_manager.get_session()
    try:
        new_log = AttentionLog(
            meeting_id=data.meeting_id,
            user_id=data.user_id,
            attention_score=data.attention_score,
            state=data.state,
            warnings_count=data.warnings_count,
            timestamp=datetime.utcnow()
        )
        session.add(new_log)
        session.commit()
        
        user = session.query(User).filter(User.id == data.user_id).first()
        username = user.username if user else "Unknown User"
        
        # Broadcast real-time score updates to SocketIO meeting room
        await sio.emit('attention-update', {
            'user_id': data.user_id,
            'username': username,
            'attention_score': data.attention_score,
            'state': data.state,
            'warnings_count': data.warnings_count,
            'timestamp': new_log.timestamp.isoformat()
        }, room=str(data.meeting_id))
        
        return {"status": "logged"}
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

@app.post("/api/attention/log/batch")
async def log_attention_batch(data: BatchLogAttentionSchema):
    session = db_manager.get_session()
    try:
        new_logs = []
        for item in data.logs:
            new_logs.append(
                AttentionLog(
                    meeting_id=item.meeting_id,
                    user_id=item.user_id,
                    attention_score=item.attention_score,
                    state=item.state,
                    warnings_count=item.warnings_count,
                    timestamp=datetime.utcnow()
                )
            )
        session.add_all(new_logs)
        session.commit()
        return {"status": "logged", "count": len(new_logs)}
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

# Fetch Session Analytics for Dashboard
@app.get("/api/analytics/{meeting_id}")
async def get_analytics(meeting_id: int):
    session = db_manager.get_session()
    try:
        logs = session.query(AttentionLog).filter(AttentionLog.meeting_id == meeting_id).order_by(AttentionLog.timestamp.asc()).all()
        results = []
        for log in logs:
            user = session.query(User).filter(User.id == log.user_id).first()
            results.append({
                "username": user.username if user else "Unknown",
                "attention_score": log.attention_score,
                "state": log.state,
                "warnings_count": log.warnings_count,
                "timestamp": log.timestamp.isoformat()
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

# Socket.IO Event Handlers (Asynchronous)
user_sids = {}
approved_participants = {} # room -> set of user_ids

@sio.on('join-room')
async def handle_join_room(sid, data):
    room = str(data.get('meeting_id'))
    user_id = data.get('user_id')
    username = data.get('username')
    
    user_sids[user_id] = sid
    await sio.enter_room(sid, room)
    
    session = db_manager.get_session()
    is_host = False
    try:
        meeting = session.query(Meeting).filter(Meeting.id == int(room)).first()
        if meeting and meeting.host_id == user_id:
            is_host = True
    except Exception as e:
        print(f"[SOCKET ERROR] Failed to check host: {e}")
    finally:
        session.close()

    if is_host:
        print(f"[SOCKET] Host {username} ({user_id}) joined room {room} immediately")
        await sio.emit('peer-joined', {
            'user_id': user_id,
            'username': username,
            'socket_id': sid
        }, room=room, skip_sid=sid)
    else:
        # Check if participant is already approved (bypass waiting room on reconnect)
        is_already_approved = room in approved_participants and user_id in approved_participants[room]
        
        if is_already_approved:
            print(f"[SOCKET] Reconnecting approved participant {username} ({user_id}) to room {room}")
            await sio.emit('join-approved', {}, to=sid)
            await sio.emit('peer-joined', {
                'user_id': user_id,
                'username': username,
                'socket_id': sid
            }, room=room, skip_sid=sid)
        else:
            print(f"[SOCKET] Participant {username} ({user_id}) asking to join room {room}")
            host_id = None
            session = db_manager.get_session()
            try:
                meeting = session.query(Meeting).filter(Meeting.id == int(room)).first()
                if meeting:
                    host_id = meeting.host_id
            finally:
                session.close()
                
            if host_id:
                host_sid = user_sids.get(host_id)
                if host_sid:
                    await sio.emit('join-request', {
                        'user_id': user_id,
                        'username': username
                    }, to=host_sid)

@sio.on('leave-room')
async def handle_leave_room(sid, data):
    room = str(data.get('meeting_id'))
    user_id = data.get('user_id')
    
    # Remove from approved participants list as they clicked "Leave" intentionally
    if room in approved_participants:
        approved_participants[room].discard(user_id)

    await sio.leave_room(sid, room)
    
    session = db_manager.get_session()
    try:
        participant = session.query(Participant).filter(Participant.meeting_id == int(room), Participant.user_id == user_id, Participant.left_at == None).first()
        if participant:
            participant.left_at = datetime.utcnow()
            session.commit()
    except Exception as e:
        session.rollback()
    finally:
        session.close()
        
    await sio.emit('peer-left', {
        'user_id': user_id,
        'socket_id': sid
    }, room=room, skip_sid=sid)

@sio.on('webrtc-offer')
async def handle_webrtc_offer(sid, data):
    target_id = data.get('target_id')
    target_sid = user_sids.get(target_id)
    if target_sid:
        await sio.emit('webrtc-offer', {
            'sdp': data.get('sdp'),
            'sender_id': data.get('sender_id'),
            'sender_username': data.get('sender_username')
        }, to=target_sid)

@sio.on('webrtc-answer')
async def handle_webrtc_answer(sid, data):
    target_id = data.get('target_id')
    target_sid = user_sids.get(target_id)
    if target_sid:
        await sio.emit('webrtc-answer', {
            'sdp': data.get('sdp'),
            'sender_id': data.get('sender_id')
        }, to=target_sid)

@sio.on('ice-candidate')
async def handle_ice_candidate(sid, data):
    target_id = data.get('target_id')
    target_sid = user_sids.get(target_id)
    if target_sid:
        await sio.emit('ice-candidate', {
            'candidate': data.get('candidate'),
            'sender_id': data.get('sender_id')
        }, to=target_sid)

@sio.on('approve-join')
async def handle_approve_join(sid, data):
    room = str(data.get('meeting_id'))
    target_id = int(data.get('target_id'))
    target_sid = user_sids.get(target_id)
    if target_sid:
        print(f"[SOCKET] Host approved join for {target_id}")
        
        if room not in approved_participants:
            approved_participants[room] = set()
        approved_participants[room].add(target_id)

        await sio.emit('join-approved', {}, to=target_sid)
        
        # Look up username to broadcast peer-joined
        session = db_manager.get_session()
        username = "Unknown Student"
        try:
            user = session.query(User).filter(User.id == target_id).first()
            if user:
                username = user.username
        finally:
            session.close()
            
        await sio.emit('peer-joined', {
            'user_id': target_id,
            'username': username,
            'socket_id': target_sid
        }, room=room, skip_sid=target_sid)

@sio.on('decline-join')
async def handle_decline_join(sid, data):
    target_id = int(data.get('target_id'))
    target_sid = user_sids.get(target_id)
    if target_sid:
        print(f"[SOCKET] Host declined join for {target_id}")
        await sio.emit('join-declined', {}, to=target_sid)

@sio.on('kick-participant')
async def handle_kick_participant(sid, data):
    room = str(data.get('meeting_id'))
    user_id = data.get('user_id')
    
    # Remove from approved participants list so they must request to join again if they try to reconnect
    if room in approved_participants:
        approved_participants[room].discard(user_id)

    await sio.emit('participant-kicked', {'user_id': user_id}, room=room)

@sio.on('camera-state-change')
async def handle_camera_state_change(sid, data):
    room = str(data.get('meeting_id'))
    await sio.emit('camera-state-change', {
        'user_id': data.get('user_id'),
        'enabled': data.get('enabled')
    }, room=room, skip_sid=sid)

@sio.on('attention-score-update')
async def handle_attention_score_update(sid, data):
    room = str(data.get('meeting_id'))
    await sio.emit('attention-score-update', {
        'user_id': data.get('user_id'),
        'username': data.get('username'),
        'score': data.get('score')
    }, room=room, skip_sid=sid)

@sio.on('chat-message')
async def handle_chat_message(sid, data):
    room = str(data.get('meeting_id'))
    await sio.emit('chat-message', {
        'user_id': data.get('user_id'),
        'username': data.get('username'),
        'message': data.get('message'),
        'timestamp': datetime.utcnow().strftime('%H:%M')
    }, room=room)

@sio.on('warning-limit-reached')
async def handle_warning_limit_reached(sid, data):
    room = str(data.get('meeting_id'))
    await sio.emit('warning-limit-reached', {
        'user_id': data.get('user_id'),
        'username': data.get('username')
    }, room=room, skip_sid=sid)

@sio.on('cancel-join-request')
async def handle_cancel_join_request(sid, data):
    room = str(data.get('meeting_id'))
    user_id = data.get('user_id')
    await sio.emit('cancel-join-request', {'user_id': user_id}, room=room, skip_sid=sid)

@sio.event
async def disconnect(sid):
    rooms = sio.get_rooms(sid)
    target_user_id = None
    for uid, s in list(user_sids.items()):
        if s == sid:
            target_user_id = uid
            del user_sids[uid]
            break
            
    if target_user_id:
        print(f"[SOCKET] User {target_user_id} disconnected from rooms: {rooms}")
        for room in rooms:
            if room != sid:
                await sio.emit('cancel-join-request', {'user_id': target_user_id}, room=room)

# Serve React static assets
dist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")

# Catch-all handler for React Routing (SPA fallback)
@app.exception_handler(status.HTTP_404_NOT_FOUND)
async def not_found_exception_handler(request: Request, exc: HTTPException):
    index_file = os.path.join(dist_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"error": "Not Found"}

# --- EMAIL NOTIFICATION SYSTEM ---
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")

def send_email_notification(to_email: str, subject: str, html_body: str):
    print(f"[MAIL SENDER] Preparing mail to {to_email}...")
    if not SMTP_USER or not SMTP_PASSWORD:
        print(f"[MAIL SIMULATION] SMTP config variables missing. Simulating sending email:")
        print(f"  To: {to_email}")
        print(f"  Subject: {subject}")
        print(f"  Body Preview:\n{html_body[:200]}...")
        return True
        
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_USER
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_body, 'html'))
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to_email, msg.as_string())
        print("[MAIL SENDER] Real email sent successfully!")
        return True
    except Exception as e:
        print(f"[MAIL SENDER ERROR] SMTP transmission failed: {e}")
        return False

def scheduled_meeting_reminder_worker():
    print("[REMINDER WORKER] Background checking thread started.")
    while True:
        time.sleep(15) # Check every 15 seconds
        session = db_manager.get_session()
        try:
            now = datetime.utcnow()
            due_time = now + timedelta(minutes=10)
            past_threshold = now - timedelta(minutes=15)
            due_meetings = session.query(ScheduledMeeting).filter(
                ScheduledMeeting.scheduled_time <= due_time,
                ScheduledMeeting.scheduled_time >= past_threshold,
                ScheduledMeeting.reminder_sent == False
            ).all()
            
            for meeting in due_meetings:
                host = session.query(User).filter(User.id == meeting.host_id).first()
                if host and host.email:
                    subject = f"Attentix Reminder: Your Meeting '{meeting.topic}' is starting in 10 minutes!"
                    html_body = f"""
                    <html>
                        <body style="font-family: Arial, sans-serif; background-color: #0b0b0c; color: #ffffff; padding: 20px;">
                            <div style="max-width: 600px; margin: 0 auto; background-color: #161618; border: 1px solid #2f2f33; padding: 30px; border-radius: 12px;">
                                <h2 style="color: #2D8CFF; margin-bottom: 20px; font-weight: 900;">Attentix Meeting Reminder</h2>
                                <p style="font-size: 14px; color: #d0d0d8;">Hello <strong>{host.username}</strong>,</p>
                                <p style="font-size: 14px; color: #d0d0d8;">This is a reminder that your scheduled meeting is starting in <strong>10 minutes</strong>!</p>
                                <div style="background-color: #242428; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2D8CFF;">
                                    <p style="margin: 0; font-size: 13px; color: #ffffff;"><strong>Topic:</strong> {meeting.topic}</p>
                                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #ffffff;"><strong>Meeting ID:</strong> {meeting.meeting_number}</p>
                                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #ffffff;"><strong>Scheduled Time:</strong> {meeting.scheduled_time.strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
                                </div>
                                <p style="font-size: 14px; color: #d0d0d8;">Click the link below to open your meeting lobby on Vercel:</p>
                                <p style="text-align: center; margin: 30px 0;">
                                    <a href="https://attentix-app.vercel.app/index.html?room={meeting.meeting_number}" style="background-color: #2D8CFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Start Meeting Now</a>
                                </p>
                                <hr style="border: 0; border-top: 1px solid #2f2f33; margin: 30px 0;" />
                                <p style="font-size: 10px; color: #82828c;">This is an automated notification from Attentix. You received this email because you scheduled a meeting session.</p>
                            </div>
                        </body>
                    </html>
                    """
                    sent = send_email_notification(host.email, subject, html_body)
                    if sent:
                        meeting.reminder_sent = True
                        session.commit()
        except Exception as e:
            print(f"[REMINDER WORKER ERROR] {e}")
            session.rollback()
        finally:
            session.close()

# Start background email worker thread
worker_thread = threading.Thread(target=scheduled_meeting_reminder_worker, daemon=True)
worker_thread.start()
