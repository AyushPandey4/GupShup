'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useChat } from '@/contexts/chat-context';
import { Users } from 'lucide-react';

interface GroupItemProps {
  group: any;
  onClick?: () => void;
}

export function GroupItem({ group, onClick }: GroupItemProps) {
  const { openChat, activeChat } = useChat();
  const isActive = activeChat?.id === group.id;

  const handleOpenChat = () => {
    if (onClick) {
      onClick();
    } else {
      openChat(group.id);
    }
  };

  return (
    <div 
      className={cn(
        "flex items-center p-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors",
        isActive && "bg-accent"
      )}
      onClick={handleOpenChat}
    >
      <Avatar>
        <AvatarImage src={group.profilePicture} />
        <AvatarFallback>
          <Users size={20} />
        </AvatarFallback>
      </Avatar>
      <div className="ml-3 flex-1 overflow-hidden">
        <div className="flex justify-between items-center">
          <p className="font-medium truncate">{group.name}</p>
          {group.lastMessage && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(group.lastMessage.timestamp), 'HH:mm')}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {group.lastMessage ? (
            <p className="text-sm text-muted-foreground truncate">
              {group.lastMessage.senderName}: {group.lastMessage.text}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{group.participants.length} members</p>
          )}
        </div>
      </div>
    </div>
  );
}