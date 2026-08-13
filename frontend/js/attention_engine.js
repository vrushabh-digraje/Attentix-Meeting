/**
 * FocusGuard Attention Monitoring Engine
 * Uses MediaPipe Face Mesh for real-time local processing.
 * Runs fully in-browser (WebGL accelerated) - 100% free.
 */

class AttentionEngine {
    constructor() {
        this.faceMesh = null;
        this.camera = null;
        this.onResultsCallback = null;
        
        // Configuration Thresholds
        this.EAR_THRESHOLD = 0.20;       // Below this value, eyes are considered closed
        this.GAZE_TOLERANCE_X = 0.18;    // Max horizontal pupil offset from eye center
        this.GAZE_TOLERANCE_Y = 0.15;    // Max vertical pupil offset from eye center
        this.HEAD_YAW_THRESHOLD = 25.0;  // Deg (Left/Right)
        this.HEAD_PITCH_THRESHOLD = 20.0;// Deg (Up/Down)

        // Smoothing window
        this.scoreHistory = [];
        this.historySize = 15; // smooth over ~1.5 seconds at 10 FPS
    }

    async initialize(videoElement, canvasElement, onResultsCallback) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.onResultsCallback = onResultsCallback;

        // Wait for MediaPipe libraries to load from CDN in background
        let attempts = 0;
        while (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
            attempts++;
            if (attempts > 40) { // 20 seconds timeout
                throw new Error("MediaPipe libraries failed to download.");
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        this.faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // required for high-accuracy iris tracking
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.processResults(results));

        // Start local video camera stream hook
        this.camera = new Camera(this.video, {
            onFrame: async () => {
                await this.faceMesh.send({ image: this.video });
            },
            width: 640,
            height: 480
        });

        return this.camera.start();
    }

    // Mathematical Euclidean Distance between 2 points
    getDistance(p1, p2) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
    }

    // Eye Aspect Ratio (EAR) calculation
    calculateEAR(eyeLandmarks) {
        // Vertical distances
        const d_v1 = this.getDistance(eyeLandmarks[1], eyeLandmarks[5]);
        const d_v2 = this.getDistance(eyeLandmarks[2], eyeLandmarks[4]);
        // Horizontal distance
        const d_h = this.getDistance(eyeLandmarks[0], eyeLandmarks[3]);
        
        return (d_v1 + d_v2) / (2.0 * d_h);
    }

    // Gaze Direction estimation (iris positioning relative to eye corners)
    estimateGaze(irisCenter, innerCorner, outerCorner) {
        const eyeWidth = this.getDistance(innerCorner, outerCorner);
        // Find mid point between corners
        const midPointX = (innerCorner.x + outerCorner.x) / 2.0;
        const midPointY = (innerCorner.y + outerCorner.y) / 2.0;

        // Calculate offset normalized by eye width
        const offsetX = (irisCenter.x - midPointX) / eyeWidth;
        const offsetY = (irisCenter.y - midPointY) / eyeWidth;

        return { offsetX, offsetY };
    }

    // Head Pose Estimation (geometric approximation of Yaw, Pitch, Roll)
    estimateHeadPose(landmarks) {
        // Core face landmarks indexes
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];
        const leftEyeCorner = landmarks[263];
        const rightEyeCorner = landmarks[33];

        // 1. Yaw (Left / Right turn)
        // Ratio of distance from nose tip to left/right eye corners
        const distLeft = this.getDistance(noseTip, leftEyeCorner);
        const distRight = this.getDistance(noseTip, rightEyeCorner);
        const yawRatio = distLeft / (distRight + 1e-6);
        const yaw = (yawRatio - 1.0) * 100.0; // Positive is looking right, negative is left

        // 2. Pitch (Up / Down tilt)
        // Ratio of distance from nose tip to forehead vs chin
        const distForehead = this.getDistance(noseTip, forehead);
        const distChin = this.getDistance(noseTip, chin);
        const pitchRatio = distForehead / (distChin + 1e-6);
        const pitch = (pitchRatio - 1.2) * 50.0; // Positive is looking down, negative is up

        // 3. Roll (Head Tilt)
        // Angle of line connecting left & right eye corners
        const dy = leftEyeCorner.y - rightEyeCorner.y;
        const dx = leftEyeCorner.x - rightEyeCorner.x;
        const roll = Math.atan2(dy, dx) * (180.0 / Math.PI);

        return { yaw, pitch, roll };
    }

    processResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            // No face detected -> Inactive state
            this.updateScore(0);
            if (this.onResultsCallback) {
                this.onResultsCallback({
                    detected: false,
                    attentionScore: 0,
                    state: 'Inactive',
                    ear: 0,
                    gaze: { offsetX: 0, offsetY: 0 },
                    headPose: { yaw: 0, pitch: 0, roll: 0 }
                });
            }
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        
        // 1. EAR Landmarks extraction
        // Left eye indices: 362 (outer corner), 385, 387, 263 (inner corner), 373, 380
        const leftEye = [landmarks[362], landmarks[385], landmarks[387], landmarks[263], landmarks[373], landmarks[380]];
        // Right eye indices: 33 (outer corner), 160, 158, 133 (inner corner), 153, 144
        const rightEye = [landmarks[33], landmarks[160], landmarks[158], landmarks[133], landmarks[153], landmarks[144]];
        
        const earLeft = this.calculateEAR(leftEye);
        const earRight = this.calculateEAR(rightEye);
        const avgEAR = (earLeft + earRight) / 2.0;

        // 2. Gaze estimation
        // Iris centers: Left = 468, Right = 473
        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        const gazeLeft = this.estimateGaze(leftIris, landmarks[263], landmarks[362]);
        const gazeRight = this.estimateGaze(rightIris, landmarks[133], landmarks[33]);
        const avgGazeX = (gazeLeft.offsetX + gazeRight.offsetX) / 2.0;
        const avgGazeY = (gazeLeft.offsetY + gazeRight.offsetY) / 2.0;

        // 3. Head Pose estimation
        const headPose = this.estimateHeadPose(landmarks);

        // 4. Calculate instantaneous Attention Score & Penalties
        let attention = 100.0;
        
        // Penalty A: Eyes closed
        if (avgEAR < this.EAR_THRESHOLD) {
            attention -= 50.0;
        }

        // Penalty B: Looking away (Gaze)
        if (Math.abs(avgGazeX) > this.GAZE_TOLERANCE_X || Math.abs(avgGazeY) > this.GAZE_TOLERANCE_Y) {
            attention -= 35.0;
        }

        // Penalty C: Head turned away
        if (Math.abs(headPose.yaw) > this.HEAD_YAW_THRESHOLD || Math.abs(headPose.pitch) > this.HEAD_PITCH_THRESHOLD) {
            attention -= 40.0;
        }

        // Clip attention score to [0, 100]
        attention = Math.max(0, Math.min(100, attention));
        
        // Smooth score using sliding average
        const smoothedScore = this.updateScore(attention);

        // Classify Attention State
        let state = 'Attentive';
        if (smoothedScore < 45.0) {
            state = 'Inactive';
        } else if (smoothedScore < 75.0) {
            state = 'Distracted';
        }

        // Callback with computed stats
        if (this.onResultsCallback) {
            this.onResultsCallback({
                detected: true,
                attentionScore: Math.round(smoothedScore),
                state: state,
                ear: parseFloat(avgEAR.toFixed(2)),
                gaze: { offsetX: avgGazeX, offsetY: avgGazeY },
                headPose: headPose
            });
        }

        // Render face overlays on overlay canvas
        this.drawOverlays(landmarks, leftIris, rightIris, state);
    }

    updateScore(newScore) {
        this.scoreHistory.push(newScore);
        if (this.scoreHistory.length > this.historySize) {
            this.scoreHistory.shift();
        }
        const sum = this.scoreHistory.reduce((a, b) => a + b, 0);
        return sum / this.scoreHistory.length;
    }

    // Renders visual facial overlay markers on top of webcam feed (disabled for performance)
    drawOverlays(landmarks, leftIris, rightIris, state) {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
