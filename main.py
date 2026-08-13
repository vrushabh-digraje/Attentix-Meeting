import sys
import os
import threading
import uvicorn
import webview
import socket
import time

# Append the backend directory path to Python sys.path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend')
sys.path.insert(0, backend_dir)

def start_fastapi_server():
    # Run uvicorn to serve the Socket.IO-wrapped FastAPI application (socket_app)
    # Serves locally on port 5000
    uvicorn.run("backend.app:socket_app", host='127.0.0.1', port=5000, log_level="warning")

def wait_for_server(port=5000, timeout=10.0):
    start = time.time()
    while time.time() - start < timeout:
        try:
            # Try to establish connection to localhost:5000
            s = socket.create_connection(('127.0.0.1', port), timeout=1.0)
            s.close()
            return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.2)
    return False

if __name__ == '__main__':
    print("Launching Attentix FastAPI ASGI server...")
    
    # Run FastAPI in a daemon background thread
    server_thread = threading.Thread(target=start_fastapi_server)
    server_thread.daemon = True
    server_thread.start()
    
    print("Waiting for local server port 5000 to become active...")
    if wait_for_server():
        print("FastAPI server active! Launching Desktop UI Shell (webview)...")
    else:
        print("Warning: Port 5000 startup timeout. Proceeding to launch window...")
    
    # Start native desktop window wrapper pointing to local server
    webview.create_window(
        title='Attentix - Zoom Meeting',
        url='http://127.0.0.1:5000',
        width=1280,
        height=800,
        min_size=(1024, 768)
    )
    webview.start()
