'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import { useAuth } from './auth-context';
import { useSocket } from './socket-context';
import { E2EEncryption } from '@/lib/encryption';
import { useToast } from '@/hooks/use-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

// Types
interface User {
  _id: string;
  id?: string;
  name: string;
  username: string;
  profilePicture?: string;
  status?: 'online' | 'offline';
  lastSeen?: string;
  contacts?: User[];
  publicKey?: string;
}

type FileType = 'image' | 'video' | 'audio' | 'file';
type MessageType = 'text' | FileType;

interface Message {
  id: string;
  _id?: string;
  chatId: string;
  sender: User;
  text?: string;
  type: MessageType;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  createdAt: string;
  status: 'sent' | 'delivered' | 'read';
  readBy?: string[];
}

interface Chat {
  id?: string;
  _id: string;
  name?: string;
  participants: User[];
  isGroup: boolean;
  admins?: User[];
  createdBy?: User;
  lastMessage?: Message;
  createdAt: string;
  updatedAt: string;
  publicKey?: string;
}

type MessageStatus = 'sent' | 'delivered' | 'read';

interface ChatContextType {
  chats: Chat[];
  contacts: User[];
  groups: Chat[];
  messages: Message[];
  activeChat: Chat | null;
  isLoading: boolean;
  error: string | null;
  loadChats: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  openChat: (chatId: string | null, contact?: User) => Promise<void | Chat>;
  sendMessage: (chatId: string, text: string) => Promise<Message | void>;
  sendFile: (chatId: string, file: File, type: FileType) => Promise<Message | void>;
  createGroup: (name: string, participants: string[]) => Promise<Chat | void>;
  clearError: () => void;
  searchUsers: (query: string) => Promise<User[]>;
  typingUsers: { [chatId: string]: string[] };
  refreshChats: () => Promise<void>;
}

// Context
const ChatContext = createContext<ChatContextType | undefined>(undefined);

// API Client
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 10000,
});

// Add allowed file type configurations
const ALLOWED_FILE_TYPES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  video: ['.mp4', '.webm', '.ogg', '.mov', '.avi'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
  file: [
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Text files
    '.txt', '.rtf', '.md',
    // Code files
    '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json',
    // Compressed files
    '.zip', '.rar', '.7z'
  ]
} as const;

const MAX_FILE_SIZES = {
  image: 5 * 1024 * 1024,    // 5MB
  video: 50 * 1024 * 1024,   // 50MB
  audio: 10 * 1024 * 1024,   // 10MB
  file: 25 * 1024 * 1024     // 25MB
} as const;

// Helper function to get file extension
const getFileExtension = (fileName: string): string => {
  return fileName.toLowerCase().slice((Math.max(0, fileName.lastIndexOf(".")) || Infinity));
};

// Helper function to check if file type is allowed
const isFileTypeAllowed = (file: File, type: FileType): boolean => {
  const extension = getFileExtension(file.name);
  const allowedExtensions = ALLOWED_FILE_TYPES[type];
  
  // For files, also check by MIME type
  if (type === 'file') {
    // Common document MIME types
    const documentMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/rtf',
      'text/markdown',
      'application/json',
      'text/javascript',
      'text/css',
      'text/html',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed'
    ];
    
    if (documentMimeTypes.includes(file.type)) {
      return true;
    }
  }
  
  return allowedExtensions.some(ext => extension === ext);
};

const getFileTypeFromMime = (mimeType: string): FileType => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { socket, isConnected } = useSocket();
  const { toast } = useToast();
  const [chats, setChats] = useState<Chat[]>([]);
  const [contacts, setContacts] = useState<User[]>([]);
  const [groups, setGroups] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<{ [chatId: string]: string[] }>({});
  const [encryptionReady, setEncryptionReady] = useState(false);
  
  // Keep track of pending messages to avoid duplication
  const pendingMessagesRef = useRef<Set<string>>(new Set());
  // Keep track of the last chat ID for resetting on change
  const lastActiveChatIdRef = useRef<string | null>(null);

  // Request interceptor for auth token
  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    return () => {
      api.interceptors.request.eject(requestInterceptor);
    };
  }, []);

  // Initialize encryption on mount
  useEffect(() => {
    const initEncryption = async () => {
      try {
        // We're using client-side only encryption
        // If the backend doesn't handle encryption, we just encrypt the messages
        // on the client side and store the encrypted messages in the database
        // This is not true E2E encryption but provides some level of privacy
        const e2e = await E2EEncryption.getInstance();
        setEncryptionReady(e2e.isReady());
      } catch (error) {
        console.error('Encryption initialization error:', error);
        // Retry initialization after a delay
        setTimeout(initEncryption, 1000);
      }
    };

    if (user) {
      initEncryption();
    }

    return () => {
      setEncryptionReady(false);
    };
  }, [user]);

  // Track active chat changes to mark messages as read
  useEffect(() => {
    if (!activeChat || !socket || !isConnected) return;
    
    const chatId = activeChat._id || activeChat.id as string;
    console.log(`Active chat changed to: ${chatId}`);
    
    // Only send read receipt if this is a different chat
    if (lastActiveChatIdRef.current !== chatId) {
      console.log('Marking messages as read for new active chat');
      socket.emit('messages:read', { chatId });
      
      // Immediately update message status for UI
      setMessages(prev =>
        prev.map(msg => 
          msg.chatId === chatId && msg.sender.id !== user?.id 
            ? { ...msg, status: 'read' }
            : msg
        )
      );
      
      lastActiveChatIdRef.current = chatId;
    }
  }, [activeChat, socket, isConnected, user?.id]);

  // Refresh chats when socket connection changes
  useEffect(() => {
    if (isConnected && user) {
      console.log('🔌 Socket connected, refreshing chat data');
      loadChats().catch(err => {
        console.error('❌ Failed to load chats on connection:', err);
      });
    }
  }, [isConnected, user]);

  // Helper function to create a hybrid id that works with both id and _id
  const createHybridId = useCallback((item: { id?: string; _id?: string }) => {
    return item.id || item._id;
  }, []);
  
  // Helper function to compare ids accounting for both id and _id
  const isSameId = useCallback((id1: string | undefined, id2: string | undefined) => {
    if (!id1 || !id2) return false;
    return id1 === id2;
  }, []);
  
  // Helper function to find an item by either id or _id
  const findItemById = useCallback(<T extends { id?: string; _id?: string }>(
    items: T[],
    idToFind: string
  ): T | undefined => {
    return items.find(item => isSameId(item.id, idToFind) || isSameId(item._id, idToFind));
  }, [isSameId]);

  // search the contacts
  const searchUsers = async (query: string) => {
    if (query.length < 2) return [];
  
    try {
      const response = await api.get(`/users/search`, {
        params: { query }
      });
      return response.data;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  };
  
  // Load initial data
  useEffect(() => {
    if (user) {
      loadChats();
    }
  }, [user]);

  // Socket event handlers
  const handleNewMessage = useCallback((message: Message) => {
    // Generate unique ID for message
    const messageId = message.id || message._id as string;
    const chatId = message.chatId;
    
    // Check if message is from current user
    const isOwnMessage = message.sender?.id === user?.id || message.sender?._id === (user as any)?._id;
    console.log('📨 Processing new message:', {
      messageId,
      chatId,
      isOwnMessage,
      activeChat: activeChat?.id || activeChat?._id,
      messageText: message.text ? 
        (message.text.length > 20 ? message.text.substring(0, 20) + '...' : message.text) 
        : '[no text]'
    });

    // Determine message status based on readBy array
    const determineMessageStatus = (msg: Message): Message['status'] => {
      const readBy = msg.readBy || [];
      if (readBy.length > 0) {
        // If any other user has read the message
        if (readBy.some(id => id !== (user?.id || (user as any)?._id))) {
          return 'read';
        }
      }
      return msg.status || (isOwnMessage ? 'sent' : 'received');
    };

    // Update messages state with retry mechanism
    const updateMessages = () => {
      setMessages(prev => {
        // Always update messages for the active chat
        const isActiveChat = activeChat && 
          (activeChat.id === chatId || activeChat._id === chatId);
        
        if (!isActiveChat) {
          console.log('📝 Message not for active chat, skipping update');
          return prev;
        }

        // Check if message already exists
        const existingMessage = prev.find(m => 
          m.id === messageId || 
          m._id === messageId || 
          (m.chatId === chatId && m.createdAt === message.createdAt)
        );
        
        if (existingMessage) {
          console.log('📝 Updating existing message:', messageId);
          return prev.map(m => 
            (m.id === messageId || m._id === messageId) 
              ? { ...m, ...message, status: determineMessageStatus(message) }
              : m
          );
        }
        
        // For own messages, only add if not in pending
        if (isOwnMessage && pendingMessagesRef.current.has(messageId)) {
          console.log('📝 Message in pending, updating status:', messageId);
          pendingMessagesRef.current.delete(messageId);
          return prev.map(m => 
            (m.id === messageId || m._id === messageId)
              ? { ...m, status: determineMessageStatus(message) }
              : m
          );
        }
        
        // Add new message
        console.log('📝 Adding new message to chat:', messageId);
        return [...prev, { 
          ...message, 
          status: determineMessageStatus(message)
        }];
      });
    };

    // Try to update messages
    updateMessages();

    // Update chats list with retry mechanism
    const updateChats = () => {
      setChats(prev => {
        const updatedChats = prev.map(chat => {
          const chatHybridId = chat.id || chat._id;
          
          if (chatHybridId === chatId) {
            console.log('📝 Updating chat with new message:', chatHybridId);
            // Update the chat with the new message
            const updatedChat: Chat = { 
              ...chat, 
              lastMessage: { 
                ...message, 
                status: determineMessageStatus(message)
              },
              updatedAt: new Date().toISOString()
            };
            
            // If this is the active chat, also update its messages
            if (activeChat && (activeChat.id === chatId || activeChat._id === chatId)) {
              // Ensure we're updating with a valid Chat object
              const updatedActiveChat: Chat = {
                ...activeChat,
                ...updatedChat
              };
              setActiveChat(updatedActiveChat);
            }
            
            return updatedChat;
          }
          return chat;
        });
        
        // Sort chats by last message time
        return updatedChats.sort((a, b) => {
          const timeA = a.lastMessage?.createdAt || a.updatedAt;
          const timeB = b.lastMessage?.createdAt || b.updatedAt;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
      });
    };

    // Try to update chats
    updateChats();

    // Send delivery receipt for messages from others
    if (socket && isConnected && !isOwnMessage) {
      console.log('📤 Sending delivery receipt for:', messageId);
      socket.emit('message:delivered', { messageId });
      
      // If this is the active chat, also mark as read immediately
      if (activeChat && (activeChat.id === chatId || activeChat._id === chatId)) {
        console.log('📤 Sending read receipt for active chat message:', messageId);
        socket.emit('messages:read', { chatId });
      }
    }
  }, [socket, user, isConnected, activeChat]);

  // Add an effect to handle active chat message updates
  useEffect(() => {
    if (activeChat) {
      const chatId = activeChat.id || activeChat._id;
      console.log(`Active chat changed or updated: ${chatId}`);
      
      // Reload messages when active chat changes
      loadMessages(chatId).catch(error => {
        console.error('Failed to load messages for active chat:', error);
      });
    }
  }, [activeChat?._id, activeChat?.id]);

  // Add message status update handler
  const handleMessageStatus = useCallback((data: { messageId: string; status: MessageStatus; chatId: string }) => {
    const { messageId, status, chatId } = data;
    
    // Update active chat if it matches
    setActiveChat((prev) => {
      if (!prev || prev._id !== chatId) return prev;
      
      const updatedChat: Chat = {
        ...prev,
        lastMessage: prev.lastMessage ? {
          ...prev.lastMessage,
          status: status as 'delivered' | 'read',
          id: messageId,
          _id: messageId,
          chatId: chatId
        } : undefined
      };
      
      return updatedChat;
    });

    // Update messages in the active chat
    setMessages((prevMessages) => {
      return prevMessages.map((msg) => {
        if (msg.id === messageId || msg._id === messageId) {
          const updatedMessage: Message = {
            ...msg,
            status: status as 'delivered' | 'read'
          };
          return updatedMessage;
        }
        return msg;
      });
    });
  }, []);

  const handleUserStatusChange = useCallback((userId: string, status: 'online' | 'offline') => {
    console.log(`User ${userId} is now ${status}`);
    
    setContacts(prev =>
      prev.map(contact =>
        contact.id === userId || contact._id === userId
          ? { ...contact, status }
          : contact
      )
    );

    // Update status in active chat participants
    setActiveChat(prev => {
      if (!prev || !prev.participants) return prev;
      return {
        ...prev,
        participants: prev.participants.map(p =>
          p.id === userId || p._id === userId ? { ...p, status } : p
        )
      };
    });
    
    // Update status in all chats
    setChats(prev => 
      prev.map(chat => {
        if (!chat.isGroup) {
          const otherUser = chat.participants.find(p => p.id === userId || p._id === userId);
          if (otherUser) {
            return {
              ...chat,
              participants: chat.participants.map(p => 
                p.id === userId || p._id === userId ? { ...p, status } : p
              )
            };
          }
        }
        return chat;
      })
    );
  }, []);

  // Add typing handlers
  const handleTypingStart = useCallback((data: { chatId: string; userId: string }) => {
    console.log(`User ${data.userId} is typing in chat ${data.chatId}`);
    
    setTypingUsers(prev => {
      const currentUsers = prev[data.chatId] || [];
      if (!currentUsers.includes(data.userId)) {
        return {
          ...prev,
          [data.chatId]: [...currentUsers, data.userId]
        };
      }
      return prev;
    });
  }, []);

  const handleTypingStop = useCallback((data: { chatId: string; userId: string }) => {
    console.log(`User ${data.userId} stopped typing in chat ${data.chatId}`);
    
    setTypingUsers(prev => ({
      ...prev,
      [data.chatId]: (prev[data.chatId] || []).filter(id => id !== data.userId)
    }));
  }, []);

  // Ensure socket event listeners are set up for real-time updates
  useEffect(() => {
    if (!socket || !isConnected) {
      console.log('⚠️ Socket not ready, skipping event setup', {
        socketExists: !!socket,
        isConnected,
        socketId: socket?.id
      });
      return;
    }

    console.log('🔌 Setting up socket event listeners', {
      socketId: socket.id,
      connected: socket.connected,
      transport: socket.io.engine.transport.name
    });

    // Create event handler functions that we can remove later
    const messageHandler = (message: Message) => {
      console.log('🔥 SOCKET MESSAGE RECEIVED:', {
        messageId: message.id || message._id,
        text: message.text?.substring(0, 20),
        chatId: message.chatId,
        sender: message.sender?.name,
        timestamp: new Date().toISOString(),
        activeChat: activeChat ? {
          id: activeChat.id,
          _id: activeChat._id
        } : null,
        socketId: socket.id,
        connected: socket.connected
      });
      
      // Double check if message should be handled
      const shouldHandleMessage = activeChat && 
        (activeChat.id === message.chatId || activeChat._id === message.chatId);
      
      console.log('📝 Message handling decision:', {
        shouldHandle: shouldHandleMessage,
        activeChatId: activeChat?.id || activeChat?._id,
        messageChatId: message.chatId
      });

      handleNewMessage(message);
    };

    const statusHandler = (data: any) => {
      console.log('🔄 SOCKET STATUS UPDATE:', data);
      handleMessageStatus(data);
    };

    const onlineHandler = (userId: string) => {
      console.log('🟢 SOCKET USER ONLINE:', userId);
      handleUserStatusChange(userId, 'online');
    };

    const offlineHandler = (userId: string) => {
      console.log('🔴 SOCKET USER OFFLINE:', userId);
      handleUserStatusChange(userId, 'offline');
    };

    const typingStartHandler = (data: any) => {
      console.log('⌨️ SOCKET TYPING START:', data);
      handleTypingStart(data);
    };

    const typingStopHandler = (data: any) => {
      console.log('✋ SOCKET TYPING STOP:', data);
      handleTypingStop(data);
    };

    const chatUpdateHandler = (chat: Chat) => {
      console.log('📝 SOCKET CHAT UPDATED:', {
        chatId: chat.id || chat._id,
        name: chat.name,
        timestamp: new Date().toISOString()
      });
      setChats(prev => {
        const index = prev.findIndex(c => c.id === chat.id || c._id === chat._id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = chat;
          return updated;
        }
        return [chat, ...prev];
      });
      
      // Update active chat if it's the one that was updated
      setActiveChat(prev => {
        if (prev && (prev.id === chat.id || prev._id === chat._id)) {
          return chat;
        }
        return prev;
      });
    };

    // Register all event handlers with error handling
    try {
      // First remove any existing handlers to prevent duplicates
      socket.off('message:received');
      socket.off('message:status');
      socket.off('user:online');
      socket.off('user:offline');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('chat:updated');

      // Now register new handlers
      socket.on('message:received', (message: Message) => {
        console.log('🎯 Message received event triggered:', {
          messageId: message.id || message._id,
          chatId: message.chatId,
          text: message.text?.substring(0, 20),
          sender: message.sender?.name,
          timestamp: new Date().toISOString()
        });
        messageHandler(message);
      });

      socket.on('message:status', (data: any) => {
        console.log('📱 Message status event triggered:', data);
        statusHandler(data);
      });

      socket.on('user:online', (userId: string) => {
        console.log('🟢 User online event triggered:', userId);
        onlineHandler(userId);
      });

      socket.on('user:offline', (userId: string) => {
        console.log('🔴 User offline event triggered:', userId);
        offlineHandler(userId);
      });

      socket.on('typing:start', (data: any) => {
        console.log('⌨️ Typing start event triggered:', data);
        typingStartHandler(data);
      });

      socket.on('typing:stop', (data: any) => {
        console.log('✋ Typing stop event triggered:', data);
        typingStopHandler(data);
      });

      socket.on('chat:updated', (chat: Chat) => {
        console.log('📝 Chat updated event triggered:', {
          chatId: chat.id || chat._id,
          name: chat.name,
          timestamp: new Date().toISOString()
        });
        chatUpdateHandler(chat);
      });

      // Add connection event handlers
      socket.on('connect', () => {
        console.log('🔌 Socket connected:', {
          id: socket.id,
          transport: socket.io.engine.transport.name
        });
      });

      socket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected:', {
          reason,
          id: socket.id
        });
      });

      socket.on('connect_error', (error) => {
        console.log('❌ Socket connection error:', {
          error: error.message,
          id: socket.id
        });
      });

      // Verify event registration
      console.log('✅ Socket events registered:', {
        socketId: socket.id,
        connected: socket.connected,
        transport: socket.io.engine.transport.name,
        activeHandlers: {
          messageReceived: socket.listeners('message:received').length,
          messageStatus: socket.listeners('message:status').length,
          userStatus: {
            online: socket.listeners('user:online').length,
            offline: socket.listeners('user:offline').length
          },
          typing: {
            start: socket.listeners('typing:start').length,
            stop: socket.listeners('typing:stop').length
          },
          chatUpdated: socket.listeners('chat:updated').length,
          connect: socket.listeners('connect').length,
          disconnect: socket.listeners('disconnect').length,
          connectError: socket.listeners('connect_error').length
        }
      });

      // Test socket connection
      socket.emit('test:echo', { message: 'test' }, (response: any) => {
        console.log('🧪 Socket test echo response:', response);
      });

    } catch (error) {
      console.error('❌ Failed to register socket events:', error);
      // Attempt to reconnect socket
      socket.connect();
    }

    // Clean up function
    return () => {
      console.log('🧹 Cleaning up socket event listeners', {
        socketId: socket.id,
        connected: socket.connected,
        activeListeners: {
          messageReceived: socket.listeners('message:received').length,
          messageStatus: socket.listeners('message:status').length,
          typing: socket.listeners('typing:start').length + socket.listeners('typing:stop').length
        }
      });
      
      try {
        // Remove all event handlers
        socket.off('message:received', messageHandler);
        socket.off('message:status', statusHandler);
        socket.off('user:online', onlineHandler);
        socket.off('user:offline', offlineHandler);
        socket.off('typing:start', typingStartHandler);
        socket.off('typing:stop', typingStopHandler);
        socket.off('chat:updated', chatUpdateHandler);
        
        console.log('✅ Socket events cleaned up successfully');
      } catch (error) {
        console.error('❌ Error cleaning up socket events:', error);
      }
    };
  }, [socket, isConnected, activeChat, handleNewMessage, handleMessageStatus, handleUserStatusChange, handleTypingStart, handleTypingStop]);

  // Helper function for API requests
  const handleRequest = async <T,>(requestFn: () => Promise<T>): Promise<T | void> => {
    setIsLoading(true);
    setError(null);
    try {
      return await requestFn();
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      const errorMessage = error.response?.data?.error ||
        error.message ||
        'An unexpected error occurred';
      setError(errorMessage);
      
      // Show toast for errors
      toast('Error', {
        description: errorMessage,
        variant: 'error',
      });
      
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const loadChats = async () => {
    return handleRequest(async () => {
      console.log('Loading chats from server');
      
      const [chatsResponse, profileResponse] = await Promise.all([
        api.get<Chat[]>('/chats'),
        api.get<{ user: User; contacts?: User[] }>('/users/profile')
      ]);

      const loadedChats = chatsResponse.data;
      const loadedContacts = profileResponse.data.contacts || [];

      // Normalize chat data - ensure both id and _id are set
      const normalizedChats = loadedChats.map(chat => {
        if (chat._id && !chat.id) {
          return { ...chat, id: chat._id };
        } else if (chat.id && !chat._id) {
          return { ...chat, _id: chat.id };
        }
        return chat;
      });
      
      // Sort chats by last message time
      const sortedChats = normalizedChats.sort((a, b) => {
        const timeA = a.lastMessage?.createdAt || a.updatedAt;
        const timeB = b.lastMessage?.createdAt || b.updatedAt;
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      setChats(sortedChats);
      setContacts(loadedContacts);
      setGroups(sortedChats.filter(chat => chat.isGroup));
      
      console.log(`Loaded ${sortedChats.length} chats, ${loadedContacts.length} contacts`);
    });
  };

  const refreshChats = async () => {
    return loadChats();
  };

  const loadMessages = async (chatId: string) => {
    return handleRequest(async () => {
      console.log(`Loading messages for chat ${chatId}`);
      
      const response = await api.get<Message[]>(`/messages/${chatId}`);
      
      // Normalize message data
      const normalizedMessages = response.data.map(msg => {
        if (msg._id && !msg.id) {
          return { ...msg, id: msg._id };
        } else if (msg.id && !msg._id) {
          return { ...msg, _id: msg.id };
        }
        return msg;
      });
      
      // Sort messages by creation time to ensure proper order
      const sortedMessages = normalizedMessages.sort((a, b) => {
        const timeA = new Date(a.createdAt || (a as any).timestamp || 0).getTime();
        const timeB = new Date(b.createdAt || (b as any).timestamp || 0).getTime();
        return timeA - timeB; // Ascending order - oldest first
      });
      
      setMessages(sortedMessages);
      console.log(`Loaded ${sortedMessages.length} messages for chat ${chatId}`);
      
      // Mark messages as read if connected
      if (socket && isConnected) {
        socket.emit('messages:read', { chatId });
      }
    });
  };

  const openChat = async (chatId: string | null, contact?: User): Promise<Chat | void> => {
    if (chatId) {
      console.log("Looking for chat with ID:", chatId);
      // Try to find the chat by id or _id
      const chat = findItemById(chats, chatId);
      
      if (chat) {
        console.log("Found chat:", chat);
        setActiveChat(chat);
        await loadMessages(chat.id || chat._id);
        return chat;
      } else {
        console.error("Chat not found with ID:", chatId);
        toast('Error', {
          description: 'Chat not found',
          variant: 'error',
        });
      }
    } else if (contact) {
      return handleRequest(async () => {
        console.log("Creating new chat with contact:", contact);
        
        const response = await api.post<Chat>('/chats', {
          participantId: contact._id || contact.id
        });

        const newChat = response.data;
        // Make sure both id and _id are available
        if (newChat._id && !newChat.id) {
          newChat.id = newChat._id;
        } else if (newChat.id && !newChat._id) {
          newChat._id = newChat.id;
        }
        
        setChats(prev => [newChat, ...prev]);
        setActiveChat(newChat);
        setMessages([]);
        
        console.log("Created new chat:", newChat);
        return newChat;
      });
    }
  };

  const sendMessage = async (chatId: string, text: string) => {
    return handleRequest(async () => {
      if (!text.trim()) {
        throw new Error('Message cannot be empty');
      }

      if (text.length > 5000) {
        throw new Error('Message cannot exceed 5000 characters');
      }

      console.log('📤 Preparing to send message:', {
        chatId,
        textLength: text.length,
        socketConnected: socket?.connected,
        activeChat: activeChat?.id || activeChat?._id
      });

      // Try to encrypt, but don't throw an error if it fails
      let encryptedMessage = text;
      try {
        const e2e = await E2EEncryption.getInstance();
        encryptedMessage = await e2e.encryptMessage(text);
      } catch (error) {
        console.warn('Could not encrypt message, sending in plain text:', error);
      }

      // Generate a unique client ID for this message to track it
      const clientMessageId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Create a temporary message to show immediately
      const tempMessage: Message = {
        id: clientMessageId,
        chatId: chatId,
        sender: user as unknown as User,
        text: text,
        type: 'text',
        createdAt: new Date().toISOString(),
        status: 'sent'
      };
      
      console.log('📤 Adding temporary message:', {
        id: clientMessageId,
        chatId,
        status: 'sent'
      });

      // Add to messages immediately for responsive UI
      setMessages(prev => [...prev, tempMessage]);
      
      // Send message via API
      console.log('📤 Sending message to server...');
      const response = await api.post<Message>(`/messages/${chatId}`, {
        text: encryptedMessage,
        type: 'text',
        clientMessageId
      });

      console.log('📤 Server response received:', {
        status: response.status,
        messageId: response.data.id || response.data._id
      });

      // Process the sent message
      const newMessage = response.data;
      const messageId = newMessage.id || newMessage._id as string;
      
      // Add to pending messages to prevent duplication
      pendingMessagesRef.current.add(messageId);
      
      // Replace the temporary message with the real one
      setMessages(prev => {
        console.log('📤 Updating temporary message with server response:', {
          tempId: clientMessageId,
          newId: messageId
        });
        return prev.map(m => 
          m.id === clientMessageId 
            ? { ...newMessage, status: 'sent' as const }
            : m
        );
      });

      // Update chat's lastMessage
      setChats(prev => {
        console.log('📤 Updating chat with new message:', {
          chatId,
          messageId,
          status: 'sent'
        });
        const updatedChats = prev.map(chat => {
          const chatHybridId = chat.id || chat._id;
          if (chatHybridId === chatId) {
            return {
              ...chat,
              lastMessage: { ...newMessage, status: 'sent' as const },
              updatedAt: new Date().toISOString()
            };
          }
          return chat;
        });
        
        // Sort chats by last message time
        return updatedChats.sort((a, b) => {
          const timeA = a.lastMessage?.createdAt || a.updatedAt;
          const timeB = b.lastMessage?.createdAt || b.updatedAt;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
      });

      // Emit a socket event to notify about the new message
      if (socket && isConnected) {
        console.log('📤 Emitting socket event for new message:', {
          messageId,
          chatId,
          socketId: socket.id,
          connected: socket.connected
        });
        socket.emit('message:sent', { messageId, chatId });
      } else {
        console.warn('⚠️ Socket not available for message notification:', {
          socketAvailable: !!socket,
          connected: socket?.connected
        });
      }

      return newMessage;
    });
  };

  const sendFile = async (chatId: string, file: File, type: FileType) => {
    return handleRequest(async () => {
      // Validate file size
      const maxSize = MAX_FILE_SIZES[type];
      if (file.size > maxSize) {
        throw new Error(`File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`);
      }

      // For files, we'll be more lenient with type detection
      if (type !== 'file') {
        // Only strictly validate type for media files
        const detectedType = getFileTypeFromMime(file.type);
        if (type !== detectedType && detectedType !== 'file') {
          throw new Error(`Invalid file type. Expected ${type} but got ${detectedType}`);
        }
      }

      if (!isFileTypeAllowed(file, type)) {
        const allowedExtensions = ALLOWED_FILE_TYPES[type].join(', ');
        throw new Error(`Invalid file type. Allowed extensions: ${allowedExtensions}`);
      }

      console.log(`📤 Sending ${type} to server:`, {
        name: file.name,
        type: file.type,
        size: `${(file.size / (1024 * 1024)).toFixed(2)}MB`,
        extension: getFileExtension(file.name),
        detectedType: getFileTypeFromMime(file.type)
      });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);
      formData.append('fileName', file.name);

      // Generate a temporary ID for immediate feedback
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Create object URL for immediate preview
      const tempUrl = URL.createObjectURL(file);
      
      // Create a temporary message to show immediately
      const tempMessage: Message = {
        id: tempId,
        chatId: chatId,
        sender: user as unknown as User,
        type: type,
        fileUrl: tempUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        createdAt: new Date().toISOString(),
        status: 'sent'
      };
      
      // Add to messages immediately for responsive UI
      setMessages(prev => [...prev, tempMessage]);
      
      // Send file via API
      const response = await api.post<Message>(`/messages/${chatId}`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data'
        }
      });

      const newMessage = response.data;
      const messageId = newMessage.id || newMessage._id as string;
      
      // Add to pending messages to prevent duplication
      pendingMessagesRef.current.add(messageId);
      
      // Replace the temporary message with the real one
      setMessages(prev => {
        return prev.map(m => 
          m.id === tempId
            ? { ...newMessage, status: 'sent' as const }
            : m
        );
      });

      // Revoke the temporary object URL to free memory
      URL.revokeObjectURL(tempUrl);

      // Update chat's lastMessage
      setChats(prev => {
        return prev.map(chat => {
          const chatHybridId = chat.id || chat._id;
          if (chatHybridId === chatId) {
            return {
              ...chat,
              lastMessage: { ...newMessage, status: 'sent' as const },
              updatedAt: new Date().toISOString()
            } as Chat;
          }
          return chat;
        }).sort((a, b) => {
          // Sort chats by last message time
          const timeA = a.lastMessage?.createdAt || a.updatedAt;
          const timeB = b.lastMessage?.createdAt || b.updatedAt;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
      });

      toast(`${type.charAt(0).toUpperCase() + type.slice(1)} sent`, {
        variant: 'success',
      });

      return newMessage;
    });
  };

  const createGroup = async (name: string, participantIds: string[]) => {
    return handleRequest(async () => {
      console.log(`Creating group "${name}" with ${participantIds.length} participants`);
      
      const response = await api.post<Chat>('/chats/group', {
        name,
        participants: participantIds
      });

      const newGroup = response.data;
      // Ensure both id and _id are set
      if (newGroup._id && !newGroup.id) {
        newGroup.id = newGroup._id;
      } else if (newGroup.id && !newGroup._id) {
        newGroup._id = newGroup.id;
      }
      
      setChats(prev => [newGroup, ...prev]);
      setGroups(prev => [newGroup, ...prev]);
      setActiveChat(newGroup);
      setMessages([]);
      
      console.log("Created new group:", newGroup);
      return newGroup;
    });
  };

  const clearError = () => setError(null);

  const contextValue: ChatContextType = {
    chats,
    contacts,
    groups,
    messages,
    activeChat,
    isLoading,
    error,
    loadChats,
    loadMessages,
    openChat,
    sendMessage,
    sendFile,
    createGroup,
    clearError,
    searchUsers,
    typingUsers,
    refreshChats
  };

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}