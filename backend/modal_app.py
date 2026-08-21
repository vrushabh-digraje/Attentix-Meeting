import os
import modal

# 1. Define the container image with all python packages installed
# It reads the requirements.txt from your local backend directory
image = (
    modal.Image.debian_slim()
    .pip_install_from_requirements(
        os.path.join(os.path.dirname(__file__), "requirements.txt")
    )
)

# 2. Create the Modal App
app = modal.App("attentix-backend")

# 3. Expose the FastAPI + Socket.IO ASGI app from app.py
@app.function(
    image=image,
    mounts=[
        # Mount your backend code into the Modal container
        modal.Mount.from_local_dir(
            os.path.dirname(__file__), 
            remote_path="/root/backend",
            condition=lambda p: not any(x in p for x in ["__pycache__", "db", "dist"])
        )
    ],
    # Add environment variables (like database credentials)
    secrets=[
        modal.Secret.from_dict({
            "DATABASE_URL": os.environ.get("DATABASE_URL", ""),
            "SMTP_USER": os.environ.get("SMTP_USER", ""),
            "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD", "")
        })
    ]
)
@modal.asgi_app()
def attentix_app():
    import sys
    sys.path.append("/root/backend")
    
    # Import your socket_app from app.py
    from app import socket_app
    return socket_app
