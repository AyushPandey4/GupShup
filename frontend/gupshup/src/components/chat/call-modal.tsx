'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/auth-context';
import { useSocket } from '@/contexts/socket-context';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Camera, CameraOff } from 'lucide-react';
import { WebRTCConnection } from '@/lib/webrtc';
import { useToast } from '@/hooks/use-toast';
import { VisuallyHidden } from '@/components/ui/visually-hidden';

// Call status types
type CallStatus = 
  | 'initiating'   // Initial state when setting up
  | 'ringing'      // Outgoing call, waiting for answer
  | 'connecting'   // Connecting WebRTC
  | 'connected'    // Successfully connected
  | 'reconnecting' // Trying to reconnect
  | 'ended';       // Call ended

interface CallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callType: 'audio' | 'video';
  recipient: any;
  isGroup: boolean;
  callId?: string;
  isIncoming?: boolean;
  incomingCallData?: {
    callId: string;
    initiator: {
      id: string;
      name: string;
      username: string;
      profilePicture?: string;
    };
  };
}

export function CallModal({ 
  open, 
  onOpenChange, 
  callType, 
  recipient, 
  isGroup,
  callId,
  isIncoming = false,
  incomingCallData
}: CallModalProps) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { toast } = useToast();
  
  // Call state
  const [callStatus, setCallStatus] = useState<CallStatus>('initiating');
  const [callDuration, setCallDuration] = useState(0);
  const [durationInterval, setDurationInterval] = useState<NodeJS.Timeout | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Media state
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
  const [isLocalVideoAvailable, setIsLocalVideoAvailable] = useState(callType === 'video');
  const [isRemoteVideoAvailable, setIsRemoteVideoAvailable] = useState(false);
  
  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection | null>(null);
  const cleanupFnRef = useRef<(() => void) | null>(null);
  
  const MAX_RETRY_ATTEMPTS = 3;
  
  // Initialize call when modal opens
  useEffect(() => {
    if (!open || !socket) return;

    let isCleanedUp = false;
    let ringtoneAudio: HTMLAudioElement | null = null;

    // Setup call
    const setupCall = async () => {
      try {
        console.log('Setting up', isIncoming ? 'incoming' : 'outgoing', callType, 'call');
        
        // Validate input data
        if (!recipient || (!recipient.id && !recipient._id)) {
          throw new Error('Invalid recipient data');
        }
        
        // Get recipient ID in a consistent format
        const recipientId = recipient.id || recipient._id;
        
        if (isIncoming && (!incomingCallData || !incomingCallData.callId)) {
          throw new Error('Missing incoming call data');
        }
        
        // Play ringing sound for outgoing calls
        if (!isIncoming) {
          ringtoneAudio = new Audio('/sounds/outgoing-call.mp3');
          ringtoneAudio.loop = true;
          ringtoneAudio.volume = 0.5;
          try {
            await ringtoneAudio.play();
          } catch (err) {
            console.warn('Failed to play ringtone:', err);
            // Don't throw error for audio play failure
          }
        }
        
        // Initialize WebRTC
        const webrtcConnection = new WebRTCConnection(socket, {
          onStream: (stream) => {
            console.log('Remote stream received');
            if (remoteVideoRef.current && !isCleanedUp) {
              remoteVideoRef.current.srcObject = stream;
              
              const hasVideo = stream.getVideoTracks().length > 0;
              setIsRemoteVideoAvailable(hasVideo);
              
              if (!hasVideo && callType === 'video') {
                toast({
                  title: 'Video Unavailable',
                  description: 'Remote user\'s video is unavailable',
                  duration: 3000
                });
              }
            }
          },
          onClose: () => {
            console.log('WebRTC connection closed');
            if (!isCleanedUp) {
              setCallStatus('ended');
              setTimeout(() => onOpenChange(false), 1500);
            }
          },
          onError: (error) => {
            console.error('WebRTC error:', error);
            if (isCleanedUp) return;
            
            setErrorMessage(`Call error: ${error.message}`);
            
            // Attempt retry if appropriate
            if (retryCount < MAX_RETRY_ATTEMPTS && 
                (error.message.includes('ICE') || 
                 error.message.includes('network') || 
                 error.message.includes('connection'))) {
              setRetryCount(prev => prev + 1);
              toast({
                title: 'Connection Issue',
                description: `Retrying connection (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})...`,
                duration: 3000
              });
              setupCall();
              return;
            }
            
            setCallStatus('ended');
            toast({
              title: 'Call Error',
              description: error.message,
              variant: 'error',
              duration: 4000
            });
            setTimeout(() => onOpenChange(false), 2000);
          },
          onConnect: () => {
            console.log('WebRTC peer connected');
            if (isCleanedUp) return;
            
            setCallStatus('connected');
            setErrorMessage(null);
            setRetryCount(0);
            
            // Stop ringing sound
            if (ringtoneAudio) {
              console.log('Stopping ringtone on WebRTC connect');
              ringtoneAudio.pause();
              ringtoneAudio.currentTime = 0;
            }
          
            // Start call duration timer
            const interval = setInterval(() => {
              setCallDuration(prev => prev + 1);
            }, 1000);
            setDurationInterval(interval);
          },
          onRemoteStreamEnded: () => {
            if (isCleanedUp) return;
            
            toast({
              title: 'Call Ending',
              description: 'Remote user ended the call',
              duration: 3000
            });
            setCallStatus('ended');
            setTimeout(() => onOpenChange(false), 1500);
          }
        });
        
        // Store reference for use in cleanup and other functions
        webrtcRef.current = webrtcConnection;

        if (isIncoming) {
          // For incoming calls, first accept the call on the socket
          const incomingCallId = incomingCallData?.callId || callId;
          
          // Ensure we have the initiator ID from incomingCallData
          if (!incomingCallData?.initiator?.id) {
            console.error('Missing initiator ID for incoming call', incomingCallData);
            throw new Error('Cannot accept call: Missing initiator ID');
          }
          
          console.log('Accepting incoming call', {
            callId: incomingCallId,
            initiatorId: incomingCallData.initiator.id,
            initiatorName: incomingCallData.initiator.name
          });
          
          setCallStatus('connecting');
          
          // Initialize WebRTC as non-initiator BEFORE emitting call:accept
          // This ensures we're ready to handle incoming signals
          await webrtcConnection.initializeCall(false, { 
            type: callType,
            callId: incomingCallId,
            recipientId: incomingCallData.initiator.id,
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
              }
            ]
          });
          
          // Now emit call:accept AFTER WebRTC is initialized
          socket.emit('call:accept', { 
            callId: incomingCallId,
            acceptedBy: user?.id || user?._id
          }, (response: any) => {
            if (response && response.status === 'error') {
              throw new Error(response.error || 'Failed to accept call');
            }
            console.log('Call acceptance acknowledged by server');
          });
        } else {
          // For outgoing calls, determine the recipient ID
          const recipientId = recipient?.id || recipient?._id;
          
          // Ensure we have a valid recipient ID
          if (!recipientId) {
            console.error('Missing recipient ID for outgoing call', recipient);
            throw new Error('Cannot make call: Missing recipient ID');
          }
          
          // First initialize WebRTC as initiator
          await webrtcConnection.initializeCall(true, { 
            type: callType,
            recipientId: recipientId,
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
              }
            ]
          });
          
          // Then initiate the call on the socket
          console.log('Initiating outgoing call to', recipient.name, {
            recipientId: recipientId,
            type: callType,
            isGroup,
            participants: isGroup ? recipient.participants?.map((p: any) => p.id || p._id) : undefined
          });

          // Ensure we're not calling ourselves
          if (user && (recipientId === user.id || recipientId === user._id)) {
            throw new Error("Cannot call yourself");
          }

          // Send call initiation request
          socket.emit('call:initiate', {
            recipientId: recipientId,
            type: callType,
            isGroup: isGroup,
            participants: isGroup ? recipient.participants?.map((p: any) => p.id || p._id) : undefined
          }, (response: any) => {
            if (!response) {
              throw new Error('No response received from server');
            }
            
            if (response.status === 'error' || !response.callId) {
              const errorMsg = response.error || 'Failed to initiate call: Invalid response';
              console.error('Call initiation failed:', errorMsg);
              throw new Error(errorMsg);
            }

            // Successfully received callId
            console.log('Call initiated successfully with ID:', response.callId);
            webrtcConnection.updateCallId(response.callId);
          });
          
          setCallStatus('ringing');
        }
      } catch (error) {
        console.error('Failed to setup call:', error);
        if (isCleanedUp) return;
        
        setErrorMessage(`Failed to setup call: ${error instanceof Error ? error.message : String(error)}`);
        setCallStatus('ended');
        
        toast({
          title: 'Call Failed',
          description: error instanceof Error ? error.message : String(error),
          variant: 'error',
          duration: 4000
        });
        
        setTimeout(() => onOpenChange(false), 2000);
      }
    };

    // Setup socket event listeners
    const setupSocketListeners = () => {
      // Handle call acceptance
      const handleCallAccepted = (data: { callId: string; acceptedBy: string }) => {
        console.log('Call accepted:', data.callId, 'by:', data.acceptedBy);
        
        // Ensure we're not accepting our own call
        if (user && (data.acceptedBy === user.id || data.acceptedBy === user._id)) {
          console.log('Ignoring self-accept event');
          return;
        }
        
        // Validate call ID match if we have a callId
        if (callId && data.callId !== callId) {
          console.warn('Received acceptance for different call ID');
          return;
        }

        if (isCleanedUp) return;
        
        setCallStatus('connected');
        setErrorMessage(null);
        
        // Stop ringing sound
        if (ringtoneAudio) {
          console.log('Stopping ringtone on call acceptance');
          ringtoneAudio.pause();
          ringtoneAudio.currentTime = 0;
        }
        
        // Start call duration timer
        const interval = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
        setDurationInterval(interval);
      };

      // Handle call rejection
      const handleCallRejected = (data: { callId: string; reason?: string }) => {
        console.log('Call rejected:', data.callId, data.reason);
        
        // Validate call ID match if we have a callId
        if (callId && data.callId !== callId) {
          console.warn('Received rejection for different call ID');
          return;
        }

        if (isCleanedUp) return;
        
        // Stop ringing sound
        if (ringtoneAudio) {
          ringtoneAudio.pause();
          ringtoneAudio.currentTime = 0;
        }

        setErrorMessage(data.reason || 'Call rejected');
        setCallStatus('ended');
        
        toast({
          title: 'Call Rejected',
          description: data.reason || 'Recipient is unavailable',
          variant: 'error',
          duration: 3000
        });
        
        setTimeout(() => onOpenChange(false), 2000);
      };

      // Handle call ending
      const handleCallEnded = (data: { callId: string; endedBy: string; reason?: string }) => {
        console.log('Call ended:', data.callId, 'by:', data.endedBy, 'reason:', data.reason);
        
        // Validate call ID match if we have a callId
        if (callId && data.callId !== callId) {
          console.warn('Received end event for different call ID');
          return;
        }

        if (isCleanedUp) return;
        
        // Stop ringing sound
        if (ringtoneAudio) {
          ringtoneAudio.pause();
          ringtoneAudio.currentTime = 0;
        }

        setErrorMessage(data.reason || 'Call ended by other participant');
        setCallStatus('ended');
        
        toast({
          title: 'Call Ended',
          description: data.reason || 'Call ended by other participant',
          variant: 'error',
          duration: 3000
        });
        
        setTimeout(() => onOpenChange(false), 1500);
      };

      // Handle reconnection requests
      const handleReconnect = () => {
        if (isCleanedUp) return;
        
        setCallStatus('reconnecting');
        
        toast({
          title: 'Reconnecting',
          description: 'Attempting to reconnect call...',
          duration: 2000
        });
      };

      // Register event handlers
      socket.on('call:accepted', handleCallAccepted);
      socket.on('call:rejected', handleCallRejected);
      socket.on('call:ended', handleCallEnded);
      socket.on('webrtc:reconnect', handleReconnect);

      // Return cleanup function
      return () => {
        socket.off('call:accepted', handleCallAccepted);
        socket.off('call:rejected', handleCallRejected);
        socket.off('call:ended', handleCallEnded);
        socket.off('webrtc:reconnect', handleReconnect);
      };
    };

    // Start setup
    setupCall();
    const removeSocketListeners = setupSocketListeners();

    // Create cleanup function
    const cleanup = () => {
      isCleanedUp = true;
      console.log('Cleanup function called - ending call and cleaning resources');
      
      // Clean up audio
      if (ringtoneAudio) {
        console.log('Stopping ringtone in cleanup');
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
        ringtoneAudio = null;
      }
      
      // Clean up intervals
      if (durationInterval) {
        console.log('Clearing duration interval');
        clearInterval(durationInterval);
        setDurationInterval(null);
      }
      
      // Clean up WebRTC
      if (webrtcRef.current) {
        console.log('Ending WebRTC call');
        webrtcRef.current.endCall();
        webrtcRef.current = null;
      }
      
      // Remove socket listeners
      console.log('Removing socket listeners');
      removeSocketListeners();
      
      // End call if not already ended
      if (callStatus !== 'ended' && socket) {
        console.log('Emitting call:end event');
        socket.emit('call:end', { 
          callId, 
          reason: 'User ended call' 
        });
      }
    };

    // Store cleanup function
    cleanupFnRef.current = cleanup;

    // Return cleanup function
    return cleanup;
  }, [
    open, 
    socket, 
    callType, 
    recipient, 
    isGroup, 
    isIncoming, 
    callId, 
    incomingCallData, 
    toast, 
    onOpenChange, 
    retryCount,
    durationInterval
  ]);

  // Setup local video preview
  useEffect(() => {
    if (open && callType === 'video' && localVideoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
            setIsLocalVideoAvailable(true);
          }
        })
        .catch(err => {
          console.error('Error accessing media devices:', err);
          setIsLocalVideoAvailable(false);
          
          toast({
            title: 'Camera Unavailable',
            description: 'Could not access your camera',
            variant: 'error',
            duration: 3000
          });
        });
    }
    
    return () => {
      // Clean up local video preview
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        localVideoRef.current.srcObject = null;
      }
    };
  }, [open, callType, toast]);

  // Handle media toggling
  const toggleMute = () => {
    if (webrtcRef.current) {
      const stream = webrtcRef.current.getLocalStream();
      if (stream) {
        const audioTracks = stream.getAudioTracks();
        
        if (audioTracks.length > 0) {
          const newState = !isMuted;
          audioTracks.forEach(track => {
            track.enabled = !newState;
          });
          setIsMuted(newState);
        }
      }
    }
  };

  const toggleVideo = () => {
    if (webrtcRef.current) {
      const stream = webrtcRef.current.getLocalStream();
      if (stream) {
        const videoTracks = stream.getVideoTracks();
        
        if (videoTracks.length > 0) {
          const newState = !isVideoEnabled;
          videoTracks.forEach(track => {
            track.enabled = newState;
          });
          setIsVideoEnabled(newState);
          
          // If turning off, may want to stop the tracks
          if (!newState) {
            videoTracks.forEach(track => track.stop());
          }
        }
      }
    }
  };

  const switchCamera = async () => {
    if (webrtcRef.current) {
      try {
        await webrtcRef.current.switchCamera();
        
        toast({
          title: 'Camera Switched',
          description: 'Switched to different camera',
          duration: 3000
        });
      } catch (error) {
        console.error('Failed to switch camera:', error);
        
        toast({
          title: 'Camera Switch Failed',
          description: String(error),
          variant: 'error',
          duration: 3000
        });
      }
    }
  };

  const handleEndCall = () => {
    // End call via WebRTC
    if (webrtcRef.current) {
      webrtcRef.current.endCall();
    }
    
    // End call via socket
    if (socket) {
      socket.emit('call:end', { 
        callId, 
        reason: 'User ended call' 
      });
    }
    
    // Update UI state
    setCallStatus('ended');
    
    // Close modal after a short delay
    setTimeout(() => onOpenChange(false), 1000);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Render the call UI
  return (
    <Dialog 
      open={open} 
      onOpenChange={(isOpen) => {
        if (!isOpen && cleanupFnRef.current) {
          cleanupFnRef.current();
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogTitle>
          {isIncoming ? 'Incoming Call' : callStatus === 'connected' ? 'On Call' : 'Calling'}
        </DialogTitle>
        
        <div className="flex flex-col items-center space-y-4">
          <Avatar className="h-24 w-24">
            <AvatarImage src={recipient?.profilePicture} />
            <AvatarFallback>{recipient?.name?.[0] || '?'}</AvatarFallback>
          </Avatar>
          
          <div className="text-center">
            <h3 className="text-lg font-semibold">{recipient?.name}</h3>
            {callStatus === 'connected' ? (
              <p className="text-sm text-muted-foreground">
                {formatDuration(callDuration)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {callStatus === 'ringing' ? 'Ringing...' : 
                 callStatus === 'connecting' ? 'Connecting...' :
                 callStatus === 'reconnecting' ? 'Reconnecting...' :
                 callStatus === 'ended' ? errorMessage || 'Call ended' :
                 'Initiating call...'}
              </p>
            )}
          </div>

          {callType === 'video' && (
            <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden">
              {isRemoteVideoAvailable ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <VideoOff className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
              
              {isLocalVideoAvailable && (
                <div className="absolute bottom-4 right-4 w-1/4 aspect-video bg-background rounded-lg overflow-hidden shadow-lg">
                  <video 
                    ref={localVideoRef}
                    autoPlay 
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center space-x-4">
            <Button 
              variant="outline" 
              size="icon" 
              className={isMuted ? 'bg-destructive text-destructive-foreground' : ''}
              onClick={toggleMute}
              disabled={callStatus !== 'connected'}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <VisuallyHidden>{isMuted ? 'Unmute' : 'Mute'}</VisuallyHidden>
            </Button>
            
            {callType === 'video' && (
              <>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className={!isVideoEnabled ? 'bg-destructive text-destructive-foreground' : ''}
                  onClick={toggleVideo}
                  disabled={callStatus !== 'connected'}
                >
                  {isVideoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  <VisuallyHidden>{isVideoEnabled ? 'Disable Video' : 'Enable Video'}</VisuallyHidden>
                </Button>
                
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={switchCamera}
                  disabled={callStatus !== 'connected' || !isVideoEnabled}
                >
                  <Camera className="h-4 w-4" />
                  <VisuallyHidden>Switch Camera</VisuallyHidden>
                </Button>
              </>
            )}
                  
            <Button 
              variant="destructive"
              size="icon" 
              onClick={handleEndCall}
            >
              <PhoneOff className="h-4 w-4" />
              <VisuallyHidden>End Call</VisuallyHidden>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}