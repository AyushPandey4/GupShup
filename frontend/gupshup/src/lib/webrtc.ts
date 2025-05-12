import SimplePeer, { Instance, SignalData } from 'simple-peer';
import { Socket } from 'socket.io-client';

interface WebRTCHandlers {
  onStream: (stream: MediaStream) => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onConnect?: () => void;
  onRemoteStreamEnded?: () => void;
}

interface CallOptions {
  type: 'audio' | 'video';
  callId?: string;
  recipientId?: string;
  iceServers?: RTCIceServer[];
}

/**
 * WebRTC connection manager for audio/video calls
 */
export class WebRTCConnection {
  private peer: Instance | null = null;
  private socket: Socket;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private handlers: WebRTCHandlers;
  private pendingSignals: SignalData[] = [];
  private isConnected = false;
  private callOptions: CallOptions | null = null;
  private isPeerInitiator = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private readonly CONNECTION_TIMEOUT = 30000; // 30 seconds
  private callId: string | null = null;
  private recipientId: string | null = null;
  private signalRetryCount = 0;
  private userMediaRetryCount = 0;
  private readonly MAX_MEDIA_RETRY_ATTEMPTS = 2;
  private clientId: string = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  constructor(socket: Socket, handlers: WebRTCHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    
    // Setup socket listeners immediately
    this.setupSocketListeners();
    console.log('WebRTC client ID created:', this.clientId);
  }

  /**
   * Set up socket event listeners for WebRTC signaling
   */
  private setupSocketListeners(): void {
    // Remove any existing listeners to prevent duplicates
    this.socket.off('webrtc:signal');
    this.socket.off('webrtc:reconnect');
    
    // Handle incoming WebRTC signals
    this.socket.on('webrtc:signal', (data: { signal: SignalData; from: string; callId?: string }) => {
      console.log('Received WebRTC signal:', data.signal.type, 'from:', data.from, 'callId:', data.callId);
      
      // Ignore signals from self (prevents echo)
      if (data.from === this.socket.id) {
        console.log('Ignoring signal from self (socket ID match)');
        return;
      }
      
      // Additional check to prevent self-calling
      if (this.shouldIgnoreSignal(data)) {
        console.log('Ignoring signal (self-call prevention)');
        return;
      }

      // Store callId if we don't have one yet
      if (!this.callId && data.callId) {
        console.log('Setting callId from signal:', data.callId);
        this.callId = data.callId;
      }
      
      // If we don't have a peer yet, queue the signal
      if (!this.peer) {
        console.log('No peer yet, adding signal to pending queue');
        this.pendingSignals.push(data.signal);
        return;
      }
      
      // Process the signal
      try {
        console.log('Processing signal directly:', data.signal.type);
        this.peer.signal(data.signal);
      } catch (error) {
        console.error('Error processing signal:', error);
        this.handleError(new Error('Failed to process WebRTC signal'));
      }
    });

    // Handle reconnection requests
    this.socket.on('webrtc:reconnect', (data: { from: string; callId?: string }) => {
      console.log('Received reconnect request from:', data.from, 'callId:', data.callId);
      
      // Ignore reconnect from self
      if (data.from === this.socket.id) {
        console.log('Ignoring reconnect from self');
        return;
      }
      
      // Attempt reconnection
      this.attemptReconnect();
    });
  }

  /**
   * Add utility method to determine if signals should be ignored
   */
  private shouldIgnoreSignal(data: { from: string; signal?: any }): boolean {
    // Always filter own socket
    if (data.from === this.socket.id) {
      return true;
    }

    // Check if the sender's client ID matches ours (same tab/window)
    if (data.signal?.clientId === this.clientId) {
      console.log('Ignoring signal from same client ID:', this.clientId);
      return true;
    }

    // Don't check recipientId matches against socket ID as this breaks some call flows
    // We should allow signals addressed to our socket ID
    
    // Check if the sender is the same as our target recipient (for additional safety)
    // But only do this check for offer signals to avoid breaking answer signals
    const userId = this.socket.auth?.userId;
    if (data.signal?.type === 'offer' && userId && data.from === userId) {
      console.log('Ignoring offer from self (userId match)');
      return true;
    }

    return false;
  }

  /**
   * Get user media stream (audio and/or video)
   */
  private async getUserMedia(type: 'audio' | 'video'): Promise<MediaStream> {
    try {
      console.log(`Getting user media for ${type} call...`);
      
      // Configure constraints based on call type
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: type === 'video' ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } : false
      };

      // Request user media
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log(`Got ${type} stream with tracks:`, 
        stream.getTracks().map(t => `${t.kind}: ${t.label}`));
      
      // Reset retry counter on success
      this.userMediaRetryCount = 0;
      
      return stream;
    } catch (error) {
      console.error('Failed to get user media:', error);
      
      // Retry with audio only if video fails
      if (type === 'video' && this.userMediaRetryCount < this.MAX_MEDIA_RETRY_ATTEMPTS) {
        this.userMediaRetryCount++;
        console.log(`Retrying with audio only (attempt ${this.userMediaRetryCount})`);
        
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          
          console.log('Fallback to audio only successful');
          return audioOnlyStream;
        } catch (fallbackError) {
          console.error('Fallback to audio only failed:', fallbackError);
        }
      }
      
      throw new Error(`Could not access ${type} devices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize a call (outgoing or incoming)
   */
  async initializeCall(isInitiator: boolean, options: CallOptions): Promise<void> {
    try {
      console.log(`Initializing ${isInitiator ? 'outgoing' : 'incoming'} ${options.type} call`);
      
      // Store call options
      this.callOptions = options;
      this.isPeerInitiator = isInitiator;
      
      // Set callId and recipientId
      if (options.callId) {
        this.callId = options.callId;
      }
      if (options.recipientId) {
        this.recipientId = options.recipientId;
      }
      
      console.log('Call initialization with:', {
        callId: this.callId,
        recipientId: this.recipientId,
        isInitiator,
        type: options.type
      });

      // Clear any existing timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      
      // Set new connection timeout
      this.connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.handleError(new Error('Call connection timeout'));
        }
      }, this.CONNECTION_TIMEOUT);
      
      // Get user media first
      this.localStream = await this.getUserMedia(options.type);
      
      // Create the peer connection
      this.createPeerConnection(isInitiator, options);
      
      // Process any pending signals that came in before we created the peer
      if (this.pendingSignals.length > 0) {
        console.log(`Processing ${this.pendingSignals.length} pending signals`);
        // Add slight delay to ensure peer is fully ready
        setTimeout(() => this.processPendingSignals(), 500);
      }
      
      return Promise.resolve();
    } catch (error) {
      console.error('Call initialization failed:', error);
      this.cleanup();
      throw new Error(`Call initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create peer connection
   */
  private createPeerConnection(isInitiator: boolean, options: CallOptions): void {
    // Destroy existing peer if any
    if (this.peer) {
      console.log('Destroying existing peer before creating new one');
      this.peer.destroy();
    }

    // Set up ICE servers for connectivity
    const iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      {
        urls: 'turn:numb.viagenie.ca',
        username: 'webrtc@live.com',
        credential: 'muazkh'
      }
    ];

    console.log('Creating peer with config:', { 
      initiator: isInitiator, 
      stream: this.localStream ? true : false,
      iceServers: iceServers.length
    });

    // Create the SimplePeer instance
    this.peer = new SimplePeer({
      initiator: isInitiator,
      stream: this.localStream || undefined,
      trickle: true,
      config: {
        iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      }
    });

    // Set up event listeners
    this.setupPeerListeners();
  }

  /**
   * Set up event listeners for the peer connection
   */
  private setupPeerListeners(): void {
    if (!this.peer) return;

    // Handle signal generation
    this.peer.on('signal', (signal: SignalData) => {
      console.log('Generated signal:', signal.type);
      
      // Ensure we have a valid callId and recipientId
      if (!this.callId || !this.recipientId) {
        console.warn('Missing callId or recipientId for signal', {
          callId: this.callId,
          recipientId: this.recipientId
        });
        
        // For offer signals, we need both callId and recipientId
        // For other signal types, we can potentially continue
        if (signal.type === 'offer') {
          console.error('Cannot send offer without callId and recipientId');
          return;
        }
        
        // Try to recover by delaying signal sending
        if (!this.callId && !this.recipientId) {
          console.log('Delaying signal to wait for callId and recipientId');
          
          // Store signal to send later
          this.pendingSignals.push(signal);
          return;
        }
      }

      // Create signal data package with client ID to prevent self-calls
      const signalData = {
        signal,
        callId: this.callId,
        recipientId: this.recipientId,
        type: this.callOptions?.type || 'audio',
        clientId: this.clientId
      };

      console.log('Sending signal with data:', {
        type: signal.type,
        callId: this.callId,
        recipientId: this.recipientId,
        clientId: this.clientId,
        callType: this.callOptions?.type
      });

      // Send signal to the server
      this.socket.emit('webrtc:signal', signalData, (response: any) => {
        if (!response) {
          console.error('No response received from signal sending');
          return;
        }

        if (response?.status === 'error') {
          console.error('Signal sending failed:', response.error);
          
          // Retry sending signals a few times before giving up
          if (this.signalRetryCount < 3) {
            this.signalRetryCount++;
            console.log(`Retrying signal send (attempt ${this.signalRetryCount}/3)`);
            
            setTimeout(() => {
              this.socket.emit('webrtc:signal', signalData);
            }, 1000);
          } else {
            this.handleError(new Error(`Failed to send signal: ${response.error}`));
          }
        } else {
          // Reset retry count on success
          this.signalRetryCount = 0;
          console.log('Signal sent successfully:', signal.type);
        }
      });
    });

    // Handle successful connection
    this.peer.on('connect', () => {
      console.log('WebRTC peer connected successfully');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      
      // Notify handlers
      this.handlers.onConnect?.();
    });

    // Handle remote stream
    this.peer.on('stream', (stream: MediaStream) => {
      console.log('Received remote stream with tracks:', 
        stream.getTracks().map(t => `${t.kind}: ${t.label}`));
      
      this.remoteStream = stream;
      
      // Monitor remote tracks for ending
      stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log(`Remote ${track.kind} track ended`);
          
          // Check if all tracks have ended
          const allTracksEnded = stream.getTracks().every(t => t.readyState === 'ended');
          if (allTracksEnded && this.handlers.onRemoteStreamEnded) {
            console.log('All remote tracks ended');
            this.handlers.onRemoteStreamEnded();
          }
        };
      });
      
      // Notify handlers of stream
      this.handlers.onStream(stream);
    });

    // Handle connection close
    this.peer.on('close', () => {
      console.log('WebRTC peer connection closed');
      this.handleClose();
    });

    // Handle errors
    this.peer.on('error', (error: Error) => {
      console.error('WebRTC peer error:', error);
      
      // Only call error handler for non-recoverable errors
      // For connection errors, try to recover instead of immediately failing
      if (!error.message.includes('ICE') && 
          !error.message.includes('connection') &&
          !error.message.includes('network')) {
        this.handleError(error);
      } else {
        console.log('Recoverable WebRTC error, attempting to continue');
        this.attemptReconnect();
      }
    });
    
    // Monitor ICE connection state
    this.peer.on('iceStateChange', (iceState: string) => {
      console.log('ICE state changed:', iceState);
      
      // Attempt reconnect if connection fails
      if (iceState === 'disconnected' || iceState === 'failed') {
        this.attemptReconnect();
      }
    });
  }

  /**
   * Process queued signals
   */
  private processPendingSignals(): void {
    if (!this.peer || this.pendingSignals.length === 0) return;
    
    console.log(`Processing ${this.pendingSignals.length} pending signals`);
    
    // Process each signal with a small delay to ensure proper order
    const processNextSignal = (index = 0) => {
      if (index >= this.pendingSignals.length || !this.peer) return;
      
      const signal = this.pendingSignals[index];
      try {
        console.log(`Processing pending signal ${index + 1}/${this.pendingSignals.length}:`, signal.type);
        this.peer.signal(signal);
      } catch (error) {
        console.error(`Error processing pending signal ${index}:`, error);
      }
      
      // Process next signal with a small delay
      setTimeout(() => processNextSignal(index + 1), 100);
    };
    
    // Start processing signals
    processNextSignal();
    
    // Clear pending signals
    this.pendingSignals = [];
  }

  /**
   * Attempt to reconnect peer connection
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log('Max reconnect attempts reached, giving up');
      this.handleError(new Error('Failed to reconnect after multiple attempts'));
      return;
    }

    if (!this.callOptions) {
      console.error('Cannot reconnect without call options');
      this.handleError(new Error('Missing call options for reconnection'));
      return;
    }

    console.log(`Attempting to reconnect (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectAttempts++;
    
    // Re-create the peer connection
    this.createPeerConnection(this.isPeerInitiator, this.callOptions);
    
    // Notify the other side that we're trying to reconnect
    this.socket.emit('webrtc:reconnect', {
      callId: this.callId,
      recipientId: this.recipientId
    });
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    console.error('WebRTC error:', error);
    this.cleanup();
    this.handlers.onError(error);
  }

  /**
   * Handle connection close
   */
  private handleClose(): void {
    console.log('Handling WebRTC close');
    this.cleanup();
    this.handlers.onClose();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    console.log('Cleaning up WebRTC connection');
    
    // Clear timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped local ${track.kind} track`);
      });
      this.localStream = null;
    }
    
    // Clear remote stream reference (we don't stop these tracks)
    this.remoteStream = null;
    
    // Destroy peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    
    this.isConnected = false;
    this.pendingSignals = [];
  }

  /**
   * End call and clean up
   */
  endCall(): void {
    console.log('Ending call');
    this.cleanup();
  }

  /**
   * Update call ID
   */
  public updateCallId(callId: string): void {
    console.log('Updating callId:', callId);
    this.callId = callId;
    
    // Check if we should process any pending signals now that we have a callId
    if (this.callId && this.recipientId && this.pendingSignals.length > 0) {
      console.log(`Processing ${this.pendingSignals.length} pending signals after callId update`);
      this.processPendingSignals();
    }
  }
  
  /**
   * Update recipient ID
   */
  public updateRecipientId(recipientId: string): void {
    console.log('Updating recipientId:', recipientId);
    this.recipientId = recipientId;
    
    // Check if we should process any pending signals now that we have a recipientId
    if (this.callId && this.recipientId && this.pendingSignals.length > 0) {
      console.log(`Processing ${this.pendingSignals.length} pending signals after recipientId update`);
      this.processPendingSignals();
    }
  }

  /**
   * Get local media stream
   */
  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Toggle audio or video
   */
  public toggleMedia(type: 'audio' | 'video', enabled: boolean): void {
    if (!this.localStream) return;
    
    console.log(`Toggling ${type} to ${enabled ? 'enabled' : 'disabled'}`);
    
    const tracks = type === 'audio' 
      ? this.localStream.getAudioTracks() 
      : this.localStream.getVideoTracks();
    
    tracks.forEach(track => {
      track.enabled = enabled;
      console.log(`${type} track ${track.label} set to ${enabled}`);
      
      // For video, we may want to stop the track completely to turn off camera
      if (type === 'video' && !enabled) {
        track.stop();
      }
    });
    
    // If we're re-enabling video after stopping it, we need to get a new stream
    if (type === 'video' && enabled && this.localStream.getVideoTracks().length === 0 && this.callOptions?.type === 'video') {
      this.restartVideoTrack();
    }
  }
  
  /**
   * Restart video track after it has been stopped
   */
  private async restartVideoTrack(): Promise<void> {
    if (!this.localStream || !this.peer) return;
    
    try {
      console.log('Restarting video track');
      const videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack) {
        // Add to local stream
        this.localStream.addTrack(videoTrack);
        
        // Replace track in peer connection if possible
        const senders = (this.peer as any)._pc?.getSenders();
        if (senders) {
          const videoSender = senders.find((s: RTCRtpSender) => 
            s.track && s.track.kind === 'video'
          );
          
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          } else {
            console.warn('No video sender found to replace track');
          }
        }
      }
    } catch (error) {
      console.error('Failed to restart video:', error);
    }
  }

  /**
   * Switch between cameras (front/back)
   */
  public async switchCamera(): Promise<void> {
    if (!this.localStream) return;
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      console.log('Switching camera');
      const currentDeviceId = videoTrack.getSettings().deviceId;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      if (videoDevices.length < 2) {
        console.log('Only one camera available, cannot switch');
        return;
      }
      
      // Find an alternative camera
      const alternateCamera = videoDevices.find(d => d.deviceId !== currentDeviceId);
      if (!alternateCamera) {
        console.log('No alternative camera found');
        return;
      }
      
      const constraints = {
        video: {
          deviceId: { exact: alternateCamera.deviceId }
        }
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      if (newVideoTrack) {
        // Stop the current video track
        videoTrack.stop();
        
        // Add new track to local stream
        this.localStream.removeTrack(videoTrack);
        this.localStream.addTrack(newVideoTrack);
        
        // Replace in peer connection if possible
        if (this.peer) {
          const senders = (this.peer as any)._pc?.getSenders();
          if (senders) {
            const videoSender = senders.find((s: RTCRtpSender) => 
              s.track && s.track.kind === 'video'
            );
            if (videoSender) {
              videoSender.replaceTrack(newVideoTrack);
            }
          }
        }
        
        console.log('Camera switched successfully');
      }
    } catch (error) {
      console.error('Camera switch failed:', error);
      throw new Error(`Failed to switch camera: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}