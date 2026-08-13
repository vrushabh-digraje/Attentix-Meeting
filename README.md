# FocusGuard: Continuous Attention Monitoring in Video Conferencing

FocusGuard is a multi-platform (Desktop, Web, Mobile) video conferencing application (like Zoom or Google Meet) with integrated, real-time attention monitoring. It utilizes **MediaPipe Face Mesh** to perform client-side landmark analysis and eye/head-pose tracking for 100% free processing costs.

---

## 🛠️ Requirements & Setup

Make sure you have installed:
*   [Python 3.10+](https://www.python.org/downloads/)
*   [Node.js (LTS)](https://nodejs.org/)
*   [Android Studio](https://developer.android.com/studio) (for mobile `.apk` builds only)

---

## 🖥️ Platform 1: Standalone Desktop App

To run FocusGuard as a native desktop application:

1.  Navigate into the project directory:
    ```bash
    cd F:\Babar
    ```
2.  Install dependencies:
    ```bash
    pip install -r backend/requirements.txt
    ```
3.  Launch the desktop app window:
    ```bash
    python main.py
    ```

*This spins up a local Flask server on `http://127.0.0.1:5000` and wraps it in a native window.*

---

## 🌐 Platform 2: Cloud Web App (Website)

To host the web version and establish a central database connecting Web, Desktop, and Mobile users together:

### 1. Create a Free Cloud Database
1.  Go to [Neon.tech](https://neon.tech/) and sign up for a free PostgreSQL instance.
2.  Copy your connection string (e.g. `postgresql://alex:password@ep-cool-fog-1234.us-east-2.aws.neon.tech/neondb?sslmode=require`).

### 2. Host the App on Render
1.  Push the project code to your **GitHub** repository.
2.  Go to [Render.com](https://render.com/) and create a new **Web Service**.
3.  Connect your GitHub repository.
4.  Configure the service details:
    *   **Runtime:** `Python`
    *   **Build Command:** `pip install -r backend/requirements.txt`
    *   **Start Command:** `gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT backend.app:app` (or `python backend/app.py` for simpler configuration)
5.  Add the **Environment Variable** under settings:
    *   `DATABASE_URL` = (Paste your Neon.tech database URL here)
6.  Click **Deploy**. Render will provide a free HTTPS URL (e.g. `https://focusguard.onrender.com`).

---

## 📱 Platform 3: Android Mobile App (.apk)

To build the project into an installable Android App:

1.  Open your terminal inside the mobile folder:
    ```bash
    cd F:\Babar\mobile
    ```
2.  Install Capacitor dependencies:
    ```bash
    npm install @capacitor/core @capacitor/cli @capacitor/android
    ```
3.  Initialize Capacitor:
    ```bash
    npx cap init FocusGuard com.focusguard.app --web-dir=../frontend
    ```
4.  Add the Android target platform:
    ```bash
    npx cap add android
    ```
5.  Sync the web code to the Android platform project:
    ```bash
    npx cap sync
    ```
6.  Open the project in Android Studio:
    ```bash
    npx cap open android
    ```
7.  In Android Studio, click **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate the installable `.apk` file!
