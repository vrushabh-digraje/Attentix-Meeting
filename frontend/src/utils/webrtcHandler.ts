import { io, Socket } from 'socket.io-client';

export class WebRTCHandler {
    private meetingId: string;
    private userId: number;
    private username: string;
    private localStream: MediaStream | null;
    private onRemoteStreamAdded: (peerId: number, peerName: string, stream: MediaStream) => void;
    private onRemoteStreamRemoved: (peerId: number) => void;

    public socket: Socket | null = null;
    private peers: { [key: number]: RTCPeerConnection } = {};
    private iceQueue: { [key: number]: any[] } = {};
    private readonly rtcConfig: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:openrelay.metered.ca:80' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelay',
                credential: 'openrelay'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelay',
                credential: 'openrelay'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelay',
                credential: 'openrelay'
            }
        ]
    };

    constructor(
        meetingId: string,
        userId: number,
        username: string,
        localStream: MediaStream | null,
        onRemoteStreamAdded: (peerId: number, peerName: string, stream: MediaStream) => void,
        onRemoteStreamRemoved: (peerId: number) => void
    ) {
        this.meetingId = meetingId;
        this.userId = userId;
        this.username = username;
        this.localStream = localStream;
        this.onRemoteStreamAdded = onRemoteStreamAdded;
        this.onRemoteStreamRemoved = onRemoteStreamRemoved;
    }

    initialize(): void {
        const rawSocketUrl = (import.meta as any).env.VITE_API_URL || 'https://attentix-backend.onrender.com';
        const socketUrl = rawSocketUrl.endsWith('/') ? rawSocketUrl.slice(0, -1) : rawSocketUrl;
        // Connect to Socket.IO signaling server
        this.socket = io(socketUrl);

        this.socket.on('connect', () => {
            console.log('Signaling server connected. Joining room:', this.meetingId);
            if (this.socket) {
                this.socket.emit('join-room', {
                    meeting_id: this.meetingId,
                    user_id: this.userId,
                    username: this.username
                });
            }
        });

        // Initiator handshake triggers when a new peer joins
        this.socket.on('peer-joined', async (data: any) => {
            const peerId = data.user_id;
            const peerName = data.username;
            console.log('Peer joined room:', peerName, peerId);
            
            const peerConnection = this.createPeerConnection(peerId, peerName);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            if (this.socket) {
                this.socket.emit('webrtc-offer', {
                    meeting_id: this.meetingId,
                    sender_id: this.userId,
                    sender_username: this.username,
                    target_id: peerId,
                    sdp: offer
                });
            }
        });

        // Set remote sdp offer and reply back with sdp answer
        this.socket.on('webrtc-offer', async (data: any) => {
            const peerId = data.sender_id;
            const peerName = data.sender_username;
            console.log('Received WebRTC offer from:', peerName);

            const peerConnection = this.createPeerConnection(peerId, peerName);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            if (this.socket) {
                this.socket.emit('webrtc-answer', {
                    meeting_id: this.meetingId,
                    sender_id: this.userId,
                    target_id: peerId,
                    sdp: answer
                });
            }

            // Process any ICE candidates that were queued while setRemoteDescription was processing
            await this.processIceQueue(peerId);
        });

        this.socket.on('webrtc-answer', async (data: any) => {
            const peerId = data.sender_id;
            console.log('Received WebRTC answer from peer:', peerId);
            const peerConnection = this.peers[peerId];
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                // Process any ICE candidates that were queued while setRemoteDescription was processing
                await this.processIceQueue(peerId);
            }
        });

        this.socket.on('ice-candidate', async (data: any) => {
            const peerId = data.sender_id;
            const peerConnection = this.peers[peerId];
            if (peerConnection && peerConnection.remoteDescription) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.error('Error adding received ice candidate:', e);
                }
            } else {
                // Queue the candidate until remote description is set
                if (!this.iceQueue[peerId]) {
                    this.iceQueue[peerId] = [];
                }
                this.iceQueue[peerId].push(data.candidate);
                console.log('Queued ICE candidate for peer:', peerId);
            }
        });

        this.socket.on('peer-left', (data: any) => {
            const peerId = data.user_id;
            console.log('Peer left meeting room:', peerId);
            this.closePeerConnection(peerId);
        });
    }

    private createPeerConnection(peerId: number, peerName: string): RTCPeerConnection {
        if (this.peers[peerId]) {
            this.closePeerConnection(peerId);
        }

        const pc = new RTCPeerConnection(this.rtcConfig);

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream!);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('ice-candidate', {
                    meeting_id: this.meetingId,
                    sender_id: this.userId,
                    target_id: peerId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log('Received remote track from peer:', peerName);
            if (this.onRemoteStreamAdded && event.streams[0]) {
                this.onRemoteStreamAdded(peerId, peerName, event.streams[0]);
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection state change with ${peerName}: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                this.closePeerConnection(peerId);
            }
        };

        this.peers[peerId] = pc;
        return pc;
    }

    private closePeerConnection(peerId: number): void {
        const pc = this.peers[peerId];
        if (pc) {
            pc.close();
            delete this.peers[peerId];
        }
        delete this.iceQueue[peerId];
        if (this.onRemoteStreamRemoved) {
            this.onRemoteStreamRemoved(peerId);
        }
    }

    private async processIceQueue(peerId: number): Promise<void> {
        const pc = this.peers[peerId];
        const queue = this.iceQueue[peerId];
        if (pc && queue && pc.remoteDescription) {
            console.log(`Processing ${queue.length} queued ICE candidates for peer: ${peerId}`);
            while (queue.length > 0) {
                const candidate = queue.shift();
                if (candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (e) {
                        console.error('Error adding processed queued ice candidate:', e);
                    }
                }
            }
        }
    }

    leave(): void {
        if (this.socket) {
            this.socket.emit('leave-room', {
                meeting_id: this.meetingId,
                user_id: this.userId
            });
            this.socket.disconnect();
        }

        Object.keys(this.peers).forEach(peerId => {
            this.closePeerConnection(parseInt(peerId));
        });
    }

    public replaceVideoTrack(newTrack: MediaStreamTrack): void {
        Object.values(this.peers).forEach(pc => {
            const senders = pc.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(newTrack);
            }
        });
    }
}
