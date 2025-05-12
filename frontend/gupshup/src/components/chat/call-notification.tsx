'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CallModal } from '@/components/chat/call-modal';
import { useSocket } from '@/contexts/socket-context';
import { useToast } from '@/hooks/use-toast';

interface CallNotificationProps {
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
  onClose: () => void;
}

export function CallNotification({
  callId,
  initiator,
  type,
  isGroup,
  groupInfo,
  onClose
}: CallNotificationProps) {
  const { socket } = useSocket();
  const { toast } = useToast();
  const [showCallModal, setShowCallModal] = useState(false);

  const handleAcceptCall = () => {
    console.log('Accepting call with data:', {
      callId,
      initiator,
      type,
      isGroup
    });
    
    // Validate that we have the necessary data before showing call modal
    if (!callId) {
      console.error('Missing callId for incoming call');
      toast({
        title: 'Call Error',
        description: 'Cannot accept call: Missing call ID',
        variant: 'error',
        duration: 3000
      });
      onClose();
      return;
    }
    
    if (!initiator?.id) {
      console.error('Missing initiator ID for incoming call');
      toast({
        title: 'Call Error',
        description: 'Cannot accept call: Missing caller information',
        variant: 'error',
        duration: 3000
      });
      onClose();
      return;
    }
    
    // Show call modal - DO NOT close notification yet
    // The notification will be closed when the modal changes
    setShowCallModal(true);
  };

  const handleRejectCall = () => {
    if (!socket) return;

    console.log('Rejecting call:', callId);
    socket.emit('call:reject', { 
      callId, 
      reason: 'Call declined by user' 
    }, (response: any) => {
      console.log('Call rejection acknowledged', response);
    });
    
    // Now close the notification
    onClose();
    
    toast({
      title: 'Call Rejected',
      description: `You declined a ${type} call from ${initiator.name}`,
      duration: 3000
    });
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 bg-background border rounded-lg shadow-lg p-4 max-w-sm w-full z-50">
        <div className="flex flex-col">
          <h3 className="text-lg font-semibold mb-2">
            Incoming {type} call
          </h3>
          <p className="text-muted-foreground mb-4">
            {isGroup
              ? `${initiator.name} is calling ${groupInfo?.name || 'the group'}`
              : `${initiator.name} is calling you`}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleRejectCall}
            >
              Decline
            </Button>
            <Button
              onClick={handleAcceptCall}
            >
              Accept
            </Button>
          </div>
        </div>
      </div>

      <CallModal
        open={showCallModal}
        onOpenChange={(open) => {
          console.log('Call modal open state changed:', open);
          setShowCallModal(open);
          if (!open) {
            console.log('Call modal closed, closing notification');
            onClose();
          }
        }}
        callType={type}
        recipient={isGroup ? groupInfo : initiator}
        isGroup={isGroup}
        callId={callId}
        isIncoming={true}
        incomingCallData={{
          callId,
          initiator: {
            id: initiator.id,
            name: initiator.name,
            username: initiator.username,
            profilePicture: initiator.profilePicture
          }
        }}
      />
    </>
  );
} 