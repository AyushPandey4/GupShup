'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { ChatContent } from '@/components/chat/chat-content';
import { useChat } from '@/contexts/chat-context';
import { useSocket } from '@/contexts/socket-context';
import { CallNotification } from './call-notification';
import { useToast } from '@/hooks/use-toast';

interface IncomingCall {
  callId: string;
  initiator: {
    id: string;
    name: string;
    username: string;
    profilePicture?: string;
  };
  type: 'audio' | 'video';
  isGroup: boolean;
  groupInfo?: {
    id: string;
    name: string;
  };
}

export function ChatLayout() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { activeChat } = useChat();
  const { socket } = useSocket();
  const { toast } = useToast();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // Handle auth redirection
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Handle incoming calls
  useEffect(() => {
    if (!socket) return;

    let audio: HTMLAudioElement | null = null;
    let timeout: NodeJS.Timeout | null = null;

    const handleIncomingCall = (call: IncomingCall) => {
      console.log('Incoming call:', call);
      
      // Properly format call data for consistency
      const formattedCall: IncomingCall = {
        callId: call.callId,
        initiator: {
          id: call.initiator._id || call.initiator.id || '',
          name: call.initiator.name || 'Unknown',
          username: call.initiator.username || '',
          profilePicture: call.initiator.profilePicture
        },
        type: call.type,
        isGroup: call.isGroup,
        groupInfo: call.groupInfo
      };
      
      // Create and configure audio element
      audio = new Audio('/sounds/incoming-call.mp3');
      audio.loop = true;
      audio.volume = 0.7; // Set to 70% volume
      
      // Play sound with error handling and retry
      const playSound = async () => {
        try {
          await audio?.play();
        } catch (err) {
          console.error('Failed to play call sound:', err);
          // Retry once after user interaction
          document.addEventListener('click', () => audio?.play(), { once: true });
        }
      };
      
      playSound();
      
      // Show incoming call notification
      setIncomingCall(formattedCall);
      
      // Set timeout for missed call
      timeout = setTimeout(() => {
        handleMissedCall(formattedCall);
      }, 30000); // 30 seconds timeout
    };

    // Handle missed call
    const handleMissedCall = (call: IncomingCall) => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      setIncomingCall(null);
      
      // Auto-reject if not answered
      if (socket) {
        socket.emit('call:reject', {
          callId: call.callId,
          reason: 'Call not answered'
        });
      }
      
      toast({
        title: 'Missed Call',
        description: `You missed a ${call.type} call from ${call.initiator.name}`,
        duration: 4000
      });
    };

    // Handle call cancellation
    const handleCallCancelled = ({ callId }: { callId: string }) => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      setIncomingCall(null);
    };

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:cancelled', handleCallCancelled);

    // Cleanup function
    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:cancelled', handleCallCancelled);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [socket, toast]);

  const handleCallNotificationClose = () => {
    setIncomingCall(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 w-80 border-r bg-card transition-transform duration-300 ease-in-out md:relative md:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <ChatSidebar onClose={() => setIsMobileMenuOpen(false)} />
      </div>

      {/* Chat content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatContent
          onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          showMenu={!isMobileMenuOpen}
        />
      </div>
      
      {/* Incoming call notification */}
      {incomingCall && (
        <CallNotification
          callId={incomingCall.callId}
          initiator={incomingCall.initiator}
          type={incomingCall.type}
          isGroup={incomingCall.isGroup}
          groupInfo={incomingCall.groupInfo}
          onClose={handleCallNotificationClose}
        />
      )}
    </div>
  );
}