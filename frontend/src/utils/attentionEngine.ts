/**
 * FocusGuard Attention Monitoring Engine (TypeScript)
 * Runs client-side MediaPipe Face Mesh in-browser (WebGL accelerated)
 */

declare var FaceMesh: any;
declare var Camera: any;

export interface AttentionResults {
    detected: boolean;
    attentionScore: number;
    state: 'Attentive' | 'Distracted' | 'Inactive';
    ear: number;
    gaze: { offsetX: number; offsetY: number };
    headPose: { yaw: number; pitch: number; roll: number };
}

export class AttentionEngine {
    private faceMesh: any = null;
    private camera: any = null;
    private onResultsCallback: ((results: AttentionResults) => void) | null = null;
    public video: HTMLVideoElement | null = null;
    public canvas: HTMLCanvasElement | null = null;
    public ctx: CanvasRenderingContext2D | null = null;

    // Threshold configs
    private readonly EAR_THRESHOLD = 0.20;
    private readonly GAZE_TOLERANCE_X = 0.18;
    private readonly GAZE_TOLERANCE_Y = 0.15;
    private readonly HEAD_YAW_THRESHOLD = 25.0;
    private readonly HEAD_PITCH_THRESHOLD = 20.0;

    private scoreHistory: number[] = [];
    private readonly historySize = 15;

    async initialize(
        videoElement: HTMLVideoElement,
        canvasElement: HTMLCanvasElement,
        onResultsCallback: (results: AttentionResults) => void
    ): Promise<void> {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.onResultsCallback = onResultsCallback;

        // Wait for MediaPipe libraries to load asynchronously from CDN in background
        let attempts = 0;
        while (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
            attempts++;
            if (attempts > 40) { // 20s timeout
                throw new Error("MediaPipe libraries failed to download.");
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        this.faceMesh = new FaceMesh({
            locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // high precision iris
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results: any) => this.processResults(results));

        this.camera = new Camera(this.video, {
            onFrame: async () => {
                if (this.faceMesh && this.video) {
                    await this.faceMesh.send({ image: this.video });
                }
            },
            width: 640,
            height: 480
        });

        return this.camera.start();
    }

    private getDistance(p1: any, p2: any): number {
        return Math.sqrt(
            Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2)
        );
    }

    private calculateEAR(eye: any[]): number {
        const d_v1 = this.getDistance(eye[1], eye[5]);
        const d_v2 = this.getDistance(eye[2], eye[4]);
        const d_h = this.getDistance(eye[0], eye[3]);
        return (d_v1 + d_v2) / (2.0 * d_h);
    }

    private estimateGaze(irisCenter: any, innerCorner: any, outerCorner: any) {
        const eyeWidth = this.getDistance(innerCorner, outerCorner);
        const midPointX = (innerCorner.x + outerCorner.x) / 2.0;
        const midPointY = (innerCorner.y + outerCorner.y) / 2.0;

        const offsetX = (irisCenter.x - midPointX) / eyeWidth;
        const offsetY = (irisCenter.y - midPointY) / eyeWidth;

        return { offsetX, offsetY };
    }

    private estimateHeadPose(landmarks: any[]) {
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];
        const leftEyeCorner = landmarks[263];
        const rightEyeCorner = landmarks[33];

        // Yaw (Left/Right turn)
        const distLeft = this.getDistance(noseTip, leftEyeCorner);
        const distRight = this.getDistance(noseTip, rightEyeCorner);
        const yaw = ((distLeft / (distRight + 1e-6)) - 1.0) * 100.0;

        // Pitch (Up/Down tilt)
        const distForehead = this.getDistance(noseTip, forehead);
        const distChin = this.getDistance(noseTip, chin);
        const pitch = ((distForehead / (distChin + 1e-6)) - 1.2) * 50.0;

        // Roll (Head Tilt)
        const dy = leftEyeCorner.y - rightEyeCorner.y;
        const dx = leftEyeCorner.x - rightEyeCorner.x;
        const roll = Math.atan2(dy, dx) * (180.0 / Math.PI);

        return { yaw, pitch, roll };
    }

    private processResults(results: any): void {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
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

        // Eye Aspect Ratio (EAR) Landmarks
        const leftEye = [
            landmarks[362], landmarks[385], landmarks[387],
            landmarks[263], landmarks[373], landmarks[380]
        ];
        const rightEye = [
            landmarks[33], landmarks[160], landmarks[158],
            landmarks[133], landmarks[153], landmarks[144]
        ];

        const earLeft = this.calculateEAR(leftEye);
        const earRight = this.calculateEAR(rightEye);
        const avgEAR = (earLeft + earRight) / 2.0;

        // Gaze Estimation
        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        const gazeLeft = this.estimateGaze(leftIris, landmarks[263], landmarks[362]);
        const gazeRight = this.estimateGaze(rightIris, landmarks[133], landmarks[33]);
        const avgGazeX = (gazeLeft.offsetX + gazeRight.offsetX) / 2.0;
        const avgGazeY = (gazeLeft.offsetY + gazeRight.offsetY) / 2.0;

        // Head Pose
        const headPose = this.estimateHeadPose(landmarks);

        // Deduct Penalties
        let attention = 100.0;
        if (avgEAR < this.EAR_THRESHOLD) attention -= 50.0;
        if (Math.abs(avgGazeX) > this.GAZE_TOLERANCE_X || Math.abs(avgGazeY) > this.GAZE_TOLERANCE_Y) attention -= 35.0;
        if (Math.abs(headPose.yaw) > this.HEAD_YAW_THRESHOLD || Math.abs(headPose.pitch) > this.HEAD_PITCH_THRESHOLD) attention -= 40.0;

        attention = Math.max(0, Math.min(100, attention));
        const smoothedScore = this.updateScore(attention);

        let state: 'Attentive' | 'Distracted' | 'Inactive' = 'Attentive';
        if (smoothedScore < 45.0) state = 'Inactive';
        else if (smoothedScore < 75.0) state = 'Distracted';

        if (this.onResultsCallback) {
            this.onResultsCallback({
                detected: true,
                attentionScore: Math.round(smoothedScore),
                state,
                ear: parseFloat(avgEAR.toFixed(2)),
                gaze: { offsetX: avgGazeX, offsetY: avgGazeY },
                headPose
            });
        }

        this.drawOverlays();
    }

    private updateScore(newScore: number): number {
        this.scoreHistory.push(newScore);
        if (this.scoreHistory.length > this.historySize) {
            this.scoreHistory.shift();
        }
        const sum = this.scoreHistory.reduce((a, b) => a + b, 0);
        return sum / this.scoreHistory.length;
    }

    private drawOverlays(): void {
        if (!this.canvas || !this.video || !this.ctx) return;
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Face outline rendering is disabled for high performance
    }

    stop(): void {
        if (this.camera) {
            this.camera.stop();
        }
        this.faceMesh = null;
    }
}
