import os
import shutil
import modal

# 1. Define the container image with all python packages installed
# It reads the requirements.txt and copies the backend files to /root/backend
image = (
    modal.Image.debian_slim()
    .pip_install_from_requirements(
        os.path.join(os.path.dirname(__file__), "requirements.txt")
    )
    .add_local_dir(
        os.path.dirname(__file__), 
        remote_path="/root/backend"
    )
)

# Load local .env configuration into environment if present
env_file_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_file_path):
    with open(env_file_path, "r", encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                _k = _k.strip()
                _v = _v.strip().strip("'\"")
                if _k and _v:
                    os.environ[_k] = _v

# 2. Create the Modal App and persistent database Volume
app = modal.App("attentix-backend")
db_volume = modal.Volume.from_name("attentix-db-volume", create_if_missing=True)

# Helper function to initialize persistent SQLite database on the volume
def initialize_persistent_db():
    os.makedirs("/data", exist_ok=True)
    persistent_db = "/data/attentix.db"
    
    # If the database file is not yet created on the Volume, copy our local build DB
    if not os.path.exists(persistent_db):
        initial_db = "/root/backend/db/attentix.db"
        if os.path.exists(initial_db):
            shutil.copy(initial_db, persistent_db)
            print("[PERSISTENT DB] Initial database successfully copied to volume.")
            # Force commit changes to the Modal Volume
            db_volume.commit()
            
    # Set the DATABASE_URL environment variable to load our persistent SQLite DB
    os.environ["DATABASE_URL"] = f"sqlite:///{persistent_db}"

# 3. Expose the FastAPI + Socket.IO ASGI app from app.py
@app.function(
    image=image,
    volumes={"/data": db_volume},
    max_containers=1,
    scaledown_window=300,
    secrets=[
        modal.Secret.from_dict({
            "GOOGLE_CLIENT_ID": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "SMTP_HOST": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "SMTP_PORT": os.environ.get("SMTP_PORT", "587"),
            "SMTP_USER": os.environ.get("SMTP_USER", ""),
            "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD", "")
        })
    ]
)
@modal.asgi_app()
def attentix_app():
    import sys
    sys.path.append("/root/backend")
    
    # Configure and point database connection to the persistent volume
    initialize_persistent_db()
    
    # Import your socket_app from app.py
    from app import socket_app
    return socket_app

@app.function(
    image=image,
    volumes={"/data": db_volume}
)
def list_users():
    import sys
    sys.path.append("/root/backend")
    
    # Configure and point database connection to the persistent volume
    initialize_persistent_db()
    
    from database import DatabaseManager, User
    db = DatabaseManager(os.environ.get("DATABASE_URL"))
    session = db.get_session()
    users = session.query(User).all()
    print("USERS IN DATABASE:")
    for u in users:
        print(f"- {u.username} ({u.email}): {u.password_hash}")

@app.function(
    image=image,
    volumes={"/data": db_volume}
)
def reset_passwords():
    import sys
    sys.path.append("/root/backend")
    from database import DatabaseManager, User
    from app import hash_password
    
    # Configure and point database connection to the persistent volume
    initialize_persistent_db()
    
    db = DatabaseManager(os.environ.get("DATABASE_URL"))
    session = db.get_session()
    
    users_to_reset = ["Xyz", "vrushabhdigraje"]
    new_password = "password123"
    
    print("RESETTING PASSWORDS...")
    for username in users_to_reset:
        user = session.query(User).filter(User.username == username).first()
        if user:
            user.password_hash = hash_password(new_password)
            print(f"Reset password for {username} to '{new_password}'")
        else:
            print(f"User {username} not found")
            
    session.commit()
    # Force commit changes to the Modal Volume
    db_volume.commit()
    print("PASSWORDS COMMITTED!")

@app.function(
    image=image,
    volumes={"/data": db_volume},
    secrets=[
        modal.Secret.from_dict({
            "SMTP_HOST": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
            "SMTP_PORT": os.environ.get("SMTP_PORT", "587"),
            "SMTP_USER": os.environ.get("SMTP_USER", ""),
            "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD", "")
        })
    ]
)
def test_email(to_email: str = ""):
    import sys
    sys.path.append("/root/backend")
    from app import send_email_notification, SMTP_USER
    
    target = to_email or SMTP_USER
    if not target:
        print("[ERROR] No recipient email specified and SMTP_USER is empty.")
        return
        
    print(f"Testing SMTP delivery from {SMTP_USER or '(Not set)'} to {target}...")
    subject = "Attentix Test: Modal Cloud SMTP Alert System"
    body = "<h2>Attentix Cloud Notification Test</h2><p>Your SMTP Email Alert System is functioning successfully from Modal serverless cloud!</p>"
    result = send_email_notification(target, subject, body)
    print("Result:", "SUCCESS" if result else "FAILED")
