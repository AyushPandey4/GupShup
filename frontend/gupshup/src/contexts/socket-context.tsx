'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth-context';
import { useToast } from '@/hooks/use-toast';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connectionError: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';

// Log environment setup
console.log('🔧 Socket Environment:', {
  SOCKET_URL,
  NODE_ENV: process.env.NODE_ENV,
  hasSocketUrlEnv: !!process.env.NEXT_PUBLIC_SOCKET_URL
});

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const CONNECTION_TIMEOUT = 20000; // 20 seconds
  const connectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize socket connection
  const initializeSocket = useCallback((token: string) => {
    console.log('🔌 Initializing socket connection...', {
      url: SOCKET_URL,
      hasToken: !!token,
      tokenLength: token?.length
    });
    
    // Close existing socket if any
    if (socketRef.current) {
      console.log('🔄 Closing existing socket connection');
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
    }
    
    // Create new socket instance with improved options
    const newSocket = io(SOCKET_URL, {
      auth: { 
        token,
        userId: user?.id || user?._id // Add user ID to auth for preventing self-calls
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: CONNECTION_TIMEOUT,
      autoConnect: false,
      forceNew: true,
      extraHeaders: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('📡 Socket instance created:', {
      url: SOCKET_URL,
      userId: user?.id || user?._id,
      options: {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        timeout: CONNECTION_TIMEOUT,
        autoConnect: false
      }
    });

    // Track in ref for cleanup
    socketRef.current = newSocket;
    
    // Socket event handlers
    const onConnect = () => {
      console.log('🟢 Socket connected successfully', {
        id: newSocket.id,
        connected: newSocket.connected,
        transport: newSocket.io.engine.transport.name,
        url: SOCKET_URL,
        auth: newSocket.auth
      });
      
      // Verify socket is properly authenticated
      newSocket.emit('auth:verify', null, (response: any) => {
        console.log('🔐 Auth verification response:', response);
      });

      setIsConnected(true);
      setConnectionError(null);
      reconnectAttemptsRef.current = 0;
      setSocket(newSocket);
      
      // Start a periodic ping to keep connection alive
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
      }
      
      connectionCheckIntervalRef.current = setInterval(() => {
        if (newSocket && newSocket.connected) {
          newSocket.emit('ping', null, (error: any) => {
            if (error) {
              console.error('❌ Ping failed:', error);
            } else {
              console.log('🏓 Ping successful:', {
                socketId: newSocket.id,
                transport: newSocket.io.engine.transport.name,
                connected: newSocket.connected
              });
            }
          });
        } else if (newSocket && !newSocket.connected) {
          console.log('❌ Socket disconnected during ping check, attempting to reconnect');
          newSocket.connect();
        }
      }, 5000);
    };

    const onDisconnect = (reason: Socket.DisconnectReason) => {
      console.log('🔴 Socket disconnected:', {
        reason,
        socketId: newSocket.id,
        wasConnected: newSocket.connected,
        transport: newSocket.io.engine.transport.name,
        url: SOCKET_URL,
        auth: newSocket.auth
      });
      setIsConnected(false);

      // Clear connection check interval
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }

      if (reason === 'io server disconnect') {
        setConnectionError('Disconnected by server. Attempting to reconnect...');
        // Try to reconnect immediately after server disconnect
        setTimeout(() => {
          if (newSocket) {
            console.log('🔄 Attempting to reconnect after server disconnect');
            newSocket.connect();
          }
        }, 1000);
      } else if (reason === 'transport close' || reason === 'transport error') {
        setConnectionError('Connection lost. Trying to reconnect...');
        // Log transport state
        console.log('🚨 Transport state:', {
          type: newSocket.io.engine.transport.name,
          readyState: newSocket.io.engine.readyState,
          protocol: newSocket.io.engine.protocol,
          auth: newSocket.auth
        });
      }
    };

    const onConnectError = (err: Error) => {
      console.error('❌ Socket connection error:', {
        error: err.message,
        type: err.name,
        socketId: newSocket.id,
        attempt: reconnectAttemptsRef.current + 1,
        url: SOCKET_URL,
        transport: newSocket?.io?.engine?.transport?.name
      });
      setConnectionError('Failed to connect to server');
      reconnectAttemptsRef.current++;
      
      if (reconnectAttemptsRef.current === MAX_RECONNECT_ATTEMPTS) {
        toast('Connection failed', {
          description: 'Could not connect to the server. Please refresh the page or try again later.',
          variant: 'error',
        });
      }
    };

    // Register event listeners before connecting
    newSocket.on('connect', onConnect);
    newSocket.on('disconnect', onDisconnect);
    newSocket.on('connect_error', onConnectError);
    newSocket.on('reconnect', (attempt: number) => {
      console.log(`🔄 Socket reconnected after ${attempt} attempts`);
      setIsConnected(true);
      setConnectionError(null);
      toast('Reconnected', {
        description: 'Your connection has been restored.',
        variant: 'success',
      });
    });
    newSocket.on('reconnect_attempt', (attempt: number) => {
      console.log(`🔄 Socket reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);
      reconnectAttemptsRef.current = attempt;
      setConnectionError(`Reconnecting... (${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
    });
    
    // Handle ping-pong for connection health
    newSocket.io.on("ping", () => {
      console.log("🏓 Socket ping received");
    });

    console.log('🔌 Attempting socket connection...');
    // Connect socket after setting up all handlers
    newSocket.connect();

    // Return cleanup function
    return () => {
      console.log('🧹 Cleaning up socket connection', {
        socketId: newSocket.id,
        wasConnected: newSocket.connected
      });
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
      newSocket.off('connect', onConnect);
      newSocket.off('disconnect', onDisconnect);
      newSocket.off('connect_error', onConnectError);
      newSocket.off('reconnect');
      newSocket.off('reconnect_attempt');
      newSocket.close();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
      setConnectionError(null);
    };
  }, [toast, user]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    console.log('🔄 Manually reconnecting socket...');
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.error('❌ No token found for reconnection');
      setConnectionError('No authentication token found');
      return;
    }
    
    // Close existing socket and initialize a new one
    return initializeSocket(token);
  }, [initializeSocket]);

  // Disconnect socket function for logout
  const disconnect = useCallback(() => {
    console.log('🔌 Manually disconnecting socket...');
    
    // Clear any intervals
    if (connectionCheckIntervalRef.current) {
      clearInterval(connectionCheckIntervalRef.current);
      connectionCheckIntervalRef.current = null;
    }
    
    // Disconnect and clean up existing socket
    if (socketRef.current) {
      console.log('🔴 Socket disconnecting:', {
        id: socketRef.current.id,
        connected: socketRef.current.connected
      });
      
      // Notify server about logout
      if (socketRef.current.connected) {
        socketRef.current.emit('auth:logout');
      }
      
      // Disconnect socket
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    // Reset state
    setSocket(null);
    setIsConnected(false);
    setConnectionError(null);
    reconnectAttemptsRef.current = 0;
  }, []);

  // Initialize socket when user is authenticated
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (user) {
      console.log('👤 User authenticated, checking token...');
      const token = localStorage.getItem('token');
      if (token) {
        console.log('🔑 Token found, initializing socket...');
        cleanup = initializeSocket(token);
      } else {
        console.error('❌ No authentication token found in localStorage');
        setConnectionError('No authentication token found');
      }
    } else {
      console.log('⚠️ No user, skipping socket initialization');
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [user, initializeSocket]);

  // Reconnect on window focus or online status change
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 Network is online, checking connection...');
      if (!isConnected && socketRef.current) {
        console.log('🔄 Reconnecting after network restored');
        socketRef.current.connect();
      }
    };

    const handleFocus = () => {
      console.log('👁️ Window focused, checking connection...');
      if (!isConnected && socketRef.current) {
        console.log('🔄 Reconnecting after window focus');
        socketRef.current.connect();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isConnected]);

  // Context value
  const contextValue: SocketContextType = {
    socket,
    isConnected,
    connectionError,
    reconnect,
    disconnect
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}