'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Menu,
  Phone,
  Video,
  Paperclip,
  Send,
  Smile,
  Image as ImageIcon,
  File,
  Video as VideoIcon,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChat } from '@/contexts/chat-context';
import { useAuth } from '@/contexts/auth-context';
import { useSocket } from '@/contexts/socket-context';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ChatInfoDialog } from '@/components/chat/chat-info-dialog';
import { EmojiPicker } from '@/components/chat/emoji-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CallModal } from '@/components/chat/call-modal';
import { E2EEncryption } from '@/lib/encryption';
import { useToast } from '@/hooks/use-toast';

// Add these type definitions if they don't exist in your project
interface Chat {
  id?: string;
  _id?: string;
  isGroup: boolean;
  name?: string;
  profilePicture?: string;
  participants: User[];
  publicKey?: string;
}

interface User {
  id?: string;
  _id?: string;
  name: string;
  profilePicture?: string;
  status?: 'online' | 'offline';
}

interface Message {
  id?: string;
  _id?: string;
  sender: User;
  text?: string;
  content?: string;
  type: 'audio' | 'video' | 'image' | 'text' | 'file';
  fileUrl?: string;
  fileName?: string;
  createdAt?: Date | string;
  timestamp?: Date | string;
  status?: 'sent' | 'delivered' | 'read';
  readBy?: string[];
}

interface ChatContentProps {
  onMenuToggle: () => void;
  showMenu: boolean;
}

export function ChatContent({ onMenuToggle, showMenu }: ChatContentProps) {
  // Context hooks
  const { activeChat, sendMessage, sendFile, messages, typingUsers } = useChat();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { toast } = useToast();
  
  // State
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const initialScrollRef = useRef<boolean>(false);
  
  // Scroll helper functions
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      console.log('Scrolling to bottom with behavior:', behavior);
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  }, []);
  
  const isNearBottom = useCallback(() => {
    const container = scrollAreaRef.current;
    if (!container) return true;
    
    const scrollPosition = container.scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;
    // Consider "near bottom" if within 150px of bottom
    return scrollHeight - scrollPosition < 150;
  }, []);

  // Force scroll to bottom for initial load
  const forceScrollToBottom = useCallback(() => {
    // Try multiple times to ensure scroll works
    const scroll = () => {
      if (messagesEndRef.current) {
        console.log('Force scrolling to bottom');
        messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
      }
    };
    
    // Try immediately
    scroll();
    
    // And with slight delays to handle various timing issues
    setTimeout(scroll, 50);
    setTimeout(scroll, 300);
  }, []);

  // Memoized values
  const chatPartner = useMemo(() => {
    if (!activeChat || activeChat.isGroup) return null;
    
    // Find the participant that's not the current user
    const otherParticipant = activeChat.participants.find(
      participant => {
        const participantId = participant.id || participant._id;
        const userId = user?.id || (user as any)?._id;
        return participantId !== userId;
      }
    );
    
    return otherParticipant || activeChat.participants[0];
  }, [activeChat, user]);

  // Get typing users for current chat
  const currentTypingUsers = useMemo(() => {
    if (!activeChat) return [];
    const chatId = activeChat.id || activeChat._id;
    return typingUsers[chatId] || [];
  }, [activeChat, typingUsers]);

  // Filter out current user from typing users
  const otherTypingUsers = useMemo(() => {
    return currentTypingUsers.filter(userId => userId !== user?.id);
  }, [currentTypingUsers, user]);

  // Effects
  useEffect(() => {
    const initEncryption = async () => {
      if (!socket) return;
      
      try {
        // Initialize encryption but don't fail if it doesn't work
        await E2EEncryption.getInstance();
        console.log('Encryption initialized successfully');
      } catch (error) {
        // Just log the error, don't show a toast
        console.warn('Encryption initialization warning:', error);
      }
    };
    
    initEncryption();
  }, [socket]);

  // Scroll to bottom when messages change
  useEffect(() => {
    console.log('Messages updated, total count:', messages.length);
    
    // If it's the initial load, force scroll to bottom
    if (messages.length > 0 && !initialScrollRef.current) {
      console.log('Initial message load, forcing scroll to bottom');
      initialScrollRef.current = true;
      forceScrollToBottom();
    } else if (isNearBottom()) {
      // Otherwise only scroll if we're near the bottom already
      scrollToBottom('auto');
    }
  }, [messages, scrollToBottom, isNearBottom, forceScrollToBottom]);

  // Reset initial scroll ref when active chat changes
  useEffect(() => {
    if (activeChat) {
      console.log('Active chat changed:', activeChat.id || activeChat._id);
      // Reset initial scroll flag to force scroll on new chat
      initialScrollRef.current = false;
      // Try to scroll now in case content is already loaded
      forceScrollToBottom();
    }
  }, [activeChat, forceScrollToBottom]);

  // Cleanup effect for typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Only close if clicking outside all emoji picker elements
      const target = event.target as HTMLElement;
      if (
        emojiPickerOpen && 
        !target.closest('.emoji-picker-container') && 
        !target.closest('.emoji-trigger-button')
      ) {
        console.log('Closing emoji picker from outside click');
        setEmojiPickerOpen(false);
      }
    };

    // Add with capture phase to handle clicks before they reach other handlers
    document.addEventListener('click', handleClickOutside, true);
    return () => {
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [emojiPickerOpen]);

  // Event handlers
  const handleSendMessage = useCallback(async () => {
    if (!message.trim() || !activeChat) return;

    try {
      // Clear the input immediately for better UX
      const messageText = message;
      setMessage('');
      
      console.log('Sending message:', messageText);
      const chatId = activeChat.id || activeChat._id || '';
      
      // Send the message - the chat context will handle adding it to the messages array
      await sendMessage(chatId, messageText);
    } catch (error) {
      console.error('Message sending error:', error);
      toast('Failed to send message', {
        variant: 'error'
      });
    }
  }, [message, activeChat, sendMessage, toast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);

    if (!activeChat || !socket) return;

    // Typing indicators
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing:start', { 
        chatId: activeChat.id || activeChat._id,
        userId: user?.id
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing:stop', { 
        chatId: activeChat.id || activeChat._id,
        userId: user?.id
      });
    }, 1000);
  }, [activeChat, isTyping, socket, user]);

  const handleFileUpload = useCallback(async (type: 'image' | 'file' | 'video') => {
    if (!activeChat) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'image' ? 'image/*' : 
                   type === 'video' ? 'video/*' : 
                   '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const chatId = activeChat.id || activeChat._id;
          await sendFile(chatId, file, type);
        } catch (error) {
          console.error('File upload error:', error);
          toast(`Failed to send ${type}`, {
            variant: 'error'
          });
        }
      }
    };

    input.click();
  }, [activeChat, sendFile, toast]);

  const initiateCall = useCallback((type: 'audio' | 'video') => {
    setCallType(type);
    setCallModalOpen(true);
  }, []);

  // Message bubbles rendering
  const renderMessages = useCallback(() => {
    if (!messages || messages.length === 0) {
      return null;
    }

    console.log('Rendering messages, count:', messages.length);
    return messages.map((msg, index) => {
      // Check if the current user is the sender by comparing both id and _id
      const userId = user?.id || (user as any)?._id;
      const senderId = typeof msg.sender === 'object' 
        ? msg.sender?.id || (msg.sender as any)?._id 
        : msg.sender;
      
      const isSentByMe = senderId === userId;
      
      // Safely determine previous and next messages
      const previousMessage = index > 0 ? messages[index - 1] : null;
      
      // Get sender ID of previous message
      const prevSenderId = previousMessage && typeof previousMessage.sender === 'object'
        ? previousMessage.sender?.id || previousMessage.sender?._id
        : previousMessage?.sender;
      
      const showAvatar = !isSentByMe && (!previousMessage || prevSenderId !== senderId);
      
      const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
      
      // Get sender ID of next message
      const nextSenderId = nextMessage && typeof nextMessage.sender === 'object'
        ? nextMessage.sender?.id || nextMessage.sender?._id
        : nextMessage?.sender;
      
      const isLastInGroup = !nextMessage || nextSenderId !== senderId;

      // Generate a stable key for the message
      const messageKey = msg.id || msg._id || `msg-${index}`;

      // Get sender info 
      const senderObject = typeof msg.sender === 'object' ? msg.sender : null;
      const senderName = senderObject?.name || 'Unknown';
      const senderProfilePic = senderObject?.profilePicture;

      // Determine if we should show the sender's name
      const shouldShowSenderName = activeChat?.isGroup && !isSentByMe && showAvatar;

      // Message status display helper
      const renderMessageStatus = () => {
        if (!isSentByMe) return null;
        
        // Check readBy array first
        const readByArray = msg.readBy || [];
        if (readByArray.length > 0) {
          // If any other user has read the message
          if (readByArray.some(id => id !== (user?.id || (user as any)?._id))) {
            return <span className="ml-1 text-blue-500">✓✓</span>;
          }
        }
        
        switch(msg.status) {
          case 'sent':
            return <span className="ml-1 opacity-70">✓</span>;
          case 'delivered':
            return <span className="ml-1 opacity-70">✓✓</span>;
          case 'read':
            return <span className="ml-1 text-blue-500">✓✓</span>;
          default:
            return <span className="ml-1 opacity-70">✓</span>;
        }
      };

      return (
        <div
          key={messageKey}
          className={cn(
            "flex items-end gap-2 w-full",
            isSentByMe ? "justify-end" : "justify-start"
          )}
        >
          {!isSentByMe && showAvatar && (
            <Avatar className="h-8 w-8">
              <AvatarImage src={activeChat?.isGroup
                ? senderProfilePic 
                : chatPartner?.profilePicture}
              />
              <AvatarFallback>
                {activeChat?.isGroup
                  ? senderName[0] || 'U'
                  : chatPartner?.name?.[0] || 'U'}
              </AvatarFallback>
            </Avatar>
          )}

          {!isSentByMe && !showAvatar && <div className="w-8" />}

          <div
            className={cn(
              "max-w-[75%] rounded-t-lg p-3",
              isSentByMe
                ? "bg-primary text-primary-foreground rounded-bl-lg"
                : "bg-secondary text-secondary-foreground rounded-br-lg",
              isLastInGroup && (isSentByMe ? "rounded-br-lg" : "rounded-bl-lg")
            )}
          >
            {shouldShowSenderName && (
              <p className="text-xs font-medium mb-1">
                {senderName}
              </p>
            )}

            {msg.type === 'text' && (
              <div>
                {msg.text || (msg as any).content}
                {(msg as any).isEncrypted && (
                  <p className="text-xs text-muted-foreground mt-1">
                    🔒 End-to-end encrypted
                  </p>
                )}
              </div>
            )}

            {msg.type === 'image' && (
              <div className="mb-2">
                <img
                  src={msg.fileUrl}
                  alt="Image"
                  className="rounded max-w-full max-h-60 object-contain cursor-pointer"
                  onClick={() => window.open(msg.fileUrl, '_blank')}
                  onError={(e) => {
                    console.error('Image failed to load:', msg.fileUrl);
                    e.currentTarget.src = 'https://placehold.co/400x300?text=Image+Unavailable';
                  }}
                />
              </div>
            )}

            {msg.type === 'video' && (
              <div className="mb-2">
                <video
                  src={msg.fileUrl}
                  controls
                  className="rounded max-w-full max-h-60 object-contain"
                  onError={(e) => {
                    console.error('Video failed to load:', msg.fileUrl);
                    // Create fallback element when video can't be loaded
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                      // Create link element
                      const linkElement = document.createElement('div');
                      linkElement.className = 'flex items-center gap-2 py-2';
                      linkElement.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"></polygon>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                        <a href="${msg.fileUrl}" target="_blank" rel="noopener noreferrer" class="text-sm underline">
                          ${msg.fileName || 'Video file'} (Unable to preview)
                        </a>
                      `;
                      
                      // Replace video element with link
                      parent.innerHTML = '';
                      parent.appendChild(linkElement);
                    }
                  }}
                />
              </div>
            )}

            {msg.type === 'file' && (
              <div className="flex items-center gap-2 mb-2 py-1">
                <File size={20} />
                <a
                  href={msg.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm underline"
                >
                  {msg.fileName || 'Document'}
                </a>
              </div>
            )}

            <p className="text-xs opacity-70 mt-1 flex items-center">
              {(msg.createdAt || (msg as any).timestamp) &&
                format(new Date(msg.createdAt || (msg as any).timestamp || new Date()), 'HH:mm')}
              {isSentByMe && renderMessageStatus()}
            </p>
          </div>
        </div>
      );
    });
  }, [messages, user, activeChat, chatPartner]);

  // Update the typing indicator section
  const renderTypingIndicator = () => {
    if (otherTypingUsers.length === 0) return null;

    const typingNames = otherTypingUsers.map(userId => {
      const participant = activeChat?.participants.find(p => p.id === userId || (p as any)._id === userId);
      return participant?.name || 'Someone';
    });

    return (
      <div className="flex items-end gap-2">
        <Avatar className="h-8 w-8">
          <AvatarImage src={activeChat?.isGroup
            ? (activeChat as any).profilePicture
            : chatPartner?.profilePicture}
          />
          <AvatarFallback>
            {activeChat?.isGroup
              ? activeChat.name?.[0] || 'G'
              : chatPartner?.name?.[0] || 'U'}
          </AvatarFallback>
        </Avatar>
        <div className="bg-secondary text-secondary-foreground rounded-t-lg rounded-br-lg p-3">
          <div className="flex flex-col">
            <p className="text-sm mb-1">
              {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...
            </p>
            <div className="flex space-x-1">
              <div className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
              <div className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
              <div className="h-2 w-2 rounded-full bg-current animate-bounce" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render empty state if no active chat
  if (!activeChat) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col p-4 h-full text-center">
        <div className="mb-4">
          <Avatar className="h-24 w-24 mx-auto">
            <AvatarFallback>
              <Menu size={48} />
            </AvatarFallback>
          </Avatar>
        </div>
        <h2 className="text-2xl font-bold mb-2">Welcome to GupShup</h2>
        <p className="text-muted-foreground max-w-md">
          Select a chat from the sidebar or start a new conversation to begin messaging.
        </p>
        <Button
          className="mt-4 md:hidden"
          onClick={onMenuToggle}
        >
          Open Chats
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Chat header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden mr-2"
            onClick={onMenuToggle}
          >
            <Menu size={20} />
          </Button>
          <Avatar className="h-10 w-10">
            <AvatarImage src={activeChat?.isGroup
              ? (activeChat as any).profilePicture
              : chatPartner?.profilePicture}
            />
            <AvatarFallback>
              {activeChat?.isGroup
                ? activeChat.name?.[0] || 'G'
                : chatPartner?.name?.[0] || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="ml-3">
            <p className="font-medium">
              {activeChat.isGroup
                ? activeChat.name || 'Group Chat'
                : chatPartner?.name || 'User'}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeChat.isGroup
                ? `${activeChat.participants.length} members`
                : chatPartner?.status === 'online'
                  ? 'Online'
                  : 'Offline'}
            </p>
          </div>
        </div>
        <div className="flex space-x-1">
          <Button variant="ghost" size="icon" onClick={() => initiateCall('audio')}>
            <Phone size={20} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => initiateCall('video')}>
            <Video size={20} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setInfoOpen(true)}>
            <Info size={20} />
          </Button>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 relative overflow-hidden">
        <div 
          ref={scrollAreaRef}
          className="absolute inset-0 p-4 overflow-y-auto"
          onLoad={forceScrollToBottom}
        >
          <div className="space-y-4">
            {/* Welcome message */}
            <div className="bg-accent/50 rounded-lg p-3 text-center text-sm mb-6">
              <p>
                {activeChat.isGroup
                  ? `Welcome to ${activeChat.name || 'the group'}! Say hi to everyone.`
                  : `This is the beginning of your conversation with ${chatPartner?.name || 'this user'}.`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Messages are end-to-end encrypted. No one outside this chat can read them.
              </p>
            </div>

            {/* Message bubbles */}
            {renderMessages()}

            {/* Show typing indicator */}
            {renderTypingIndicator()}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>
      </div>

      {/* Message input */}
      <div className="p-3 border-t">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="emoji-trigger-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEmojiPickerOpen(!emojiPickerOpen);
              }}
            >
              <Smile size={20} />
            </Button>
            {emojiPickerOpen && (
              <div 
                className="absolute bottom-12 left-0 z-[9999] emoji-picker-container" 
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="fixed inset-0 z-[999]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmojiPickerOpen(false);
                  }}
                />
                <div className="relative z-[9999]" onClick={(e) => e.stopPropagation()}>
                  <EmojiPicker
                    onSelect={(emoji) => {
                      console.log('Emoji selected in chat:', emoji);
                      setMessage(prev => prev + emoji);
                      // Don't close the picker here to allow multiple emoji selection
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Paperclip size={20} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleFileUpload('image')}>
                <ImageIcon className="mr-2 h-4 w-4" />
                <span>Image</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleFileUpload('video')}>
                <VideoIcon className="mr-2 h-4 w-4" />
                <span>Video</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleFileUpload('file')}>
                <File className="mr-2 h-4 w-4" />
                <span>Document</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Input
            placeholder="Type a message..."
            className="flex-1"
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={handleSendMessage}
            disabled={!message.trim()}
          >
            <Send size={20} />
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <ChatInfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        chat={activeChat}
      />

      <CallModal
        open={callModalOpen}
        onOpenChange={setCallModalOpen}
        callType={callType}
        recipient={activeChat.isGroup ? activeChat : chatPartner!}
        isGroup={activeChat.isGroup}
      />
    </>
  );
}