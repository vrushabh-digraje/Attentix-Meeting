"""
Attentix Diagnostic & Verification Tool:
Tests Production Google OAuth and SMTP Email Alert configurations.
"""
import os
import sys
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Load .env
env_file = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_file):
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and v:
                    os.environ[k] = v

def test_google_oauth():
    print("=" * 60)
    print("1. GOOGLE OAUTH CONFIGURATION CHECK")
    print("=" * 60)
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id or client_id.startswith("your-"):
        print("❌ Status: Google Client ID is NOT configured.")
        print("   Current Mode: Mock / Simulation Accounts Active")
        print("   To enable Real Google Sign-In:")
        print("   1. Open Google Cloud Console: https://console.cloud.google.com/apis/credentials")
        print("   2. Create OAuth 2.0 Web Client ID")
        print("   3. Add Authorized Javascript Origins:")
        print("      - https://attentix-app.vercel.app")
        print("      - https://vrushabh-digraje--attentix-backend-attentix-app.modal.run")
        print("   4. Set GOOGLE_CLIENT_ID in backend/.env")
    else:
        print(f"✅ Status: Google Client ID configured!")
        print(f"   Client ID: {client_id[:16]}...{client_id[-18:]}")
        if ".apps.googleusercontent.com" in client_id:
            print("   Format Check: VALID Google OAuth Client ID format.")
        else:
            print("   ⚠️ Warning: Does not end with .apps.googleusercontent.com")

def test_smtp(recipient: str = None):
    print("\n" + "=" * 60)
    print("2. SMTP EMAIL NOTIFICATION SERVICE CHECK")
    print("=" * 60)
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    
    if not user or not password or user.startswith("your_"):
        print("❌ Status: SMTP credentials are NOT configured.")
        print("   Current Mode: Simulation Mode (Email logged in console)")
        print("   To enable Real Automated Email Invitations & 10-min Reminders:")
        print("   1. Enable 2-Step Verification on your Gmail account")
        print("   2. Generate a 16-character App Password at: https://myaccount.google.com/apppasswords")
        print("   3. Set SMTP_USER and SMTP_PASSWORD in backend/.env")
        return
        
    print(f"Connecting to SMTP Server: {host}:{port}...")
    print(f"Authenticating as: {user}...")
    try:
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls()
            server.login(user, password)
            print("✅ Authentication SUCCESS: Connected to Gmail SMTP successfully!")
            
            target = recipient or user
            print(f"Sending test email notification to {target}...")
            msg = MIMEMultipart()
            msg['From'] = user
            msg['To'] = target
            msg['Subject'] = "Attentix Verification: Automated SMTP Alerts Operational"
            msg.attach(MIMEText("""
            <html>
                <body style="font-family: Arial, sans-serif; background-color: #0b0b0c; color: #ffffff; padding: 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background-color: #161618; border: 1px solid #2f2f33; padding: 30px; border-radius: 12px;">
                        <h2 style="color: #2D8CFF; font-weight: 900;">Attentix Notification System</h2>
                        <p style="color: #d0d0d8;">Hello!</p>
                        <p style="color: #d0d0d8;">Your automated meeting reminder and invitation alerts are working properly.</p>
                        <div style="background-color: #242428; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #34A853;">
                            <p style="margin: 0; color: #34A853; font-weight: bold;">Status: Operational</p>
                        </div>
                    </div>
                </body>
            </html>
            """, 'html'))
            server.sendmail(user, target, msg.as_string())
            print(f"🎉 Email successfully delivered to {target}!")
    except Exception as e:
        print(f"❌ SMTP Connection Error: {e}")

if __name__ == "__main__":
    test_google_oauth()
    recip = sys.argv[1] if len(sys.argv) > 1 else None
    test_smtp(recip)
