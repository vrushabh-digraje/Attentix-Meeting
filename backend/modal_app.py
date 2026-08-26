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
    max_containers=1
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
