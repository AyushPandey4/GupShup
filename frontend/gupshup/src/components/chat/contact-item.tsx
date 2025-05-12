'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useChat } from '@/contexts/chat-context';

interface ContactItemProps {
  contact: any;
  lastMessage?: any;
  chatId?: string;
  onClick?: () => void;
}

export function ContactItem({ contact, lastMessage, chatId, onClick }: ContactItemProps) {
  const { openChat, activeChat } = useChat();

  const isActive = activeChat?.id === chatId;
  const isOnline = contact.status === 'online';

  const handleOpenChat = () => {
    if (onClick) {
      onClick();
    } else if (chatId) {
      openChat(chatId);
    } else {
      openChat(null, contact);
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
      <div className="relative">
        <Avatar>
          <AvatarImage src={contact.profilePicture} />
          <AvatarFallback>{contact.name[0]}</AvatarFallback>
        </Avatar>
        {isOnline && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"></span>
        )}
      </div>
      <div className="ml-3 flex-1 overflow-hidden">
        <div className="flex justify-between items-center">
          <p className="font-medium truncate">{contact.name}</p>
          {lastMessage?.timestamp && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(lastMessage.timestamp), 'HH:mm')}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {lastMessage ? (
            <p className="text-sm text-muted-foreground truncate">
              {lastMessage.sender === contact.id ? '' : 'You: '}
              {lastMessage.text}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">@{contact.username}</p>
          )}
        </div>
      </div>
    </div>
  );
}