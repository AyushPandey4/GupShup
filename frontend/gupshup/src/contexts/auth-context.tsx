'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios, { AxiosError } from 'axios';

interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  profilePicture?: string;
  status?: 'online' | 'offline';
  lastSeen?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// API configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 10000, // 10 seconds timeout
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add request interceptor for token
  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Auto logout on 401 Unauthorized
          localStorage.removeItem('token');
          setUser(null);
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
      api.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  // Check auth status on mount
  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setIsLoading(false);
        return;
      }

      const response = await api.get('/users/profile');
      setUser(response.data);
    } catch (err) {
      localStorage.removeItem('token');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleRequest = async <T,>(request: Promise<T>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      return await request;
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      const errorMessage = error.response?.data?.error ||
        error.message ||
        'An unexpected error occurred';
      setError(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await handleRequest(
      api.post('/auth/login', { email, password })
    );
    localStorage.setItem('token', response.data.token);
    setUser(response.data.user);
  };

  const register = async (name: string, email: string, password: string) => {
    const response = await handleRequest(
      api.post('/auth/register', { name, email, password })
    );
    localStorage.setItem('token', response.data.token);
    setUser(response.data.user);
  };

  const loginWithGoogle = async (accessToken: string) => {
    const response = await handleRequest(
      api.post('/auth/google', { accessToken })
    );
    localStorage.setItem('token', response.data.token);
    setUser(response.data.user);
  };

  const logout = async () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const updateUsername = async (username: string) => {
    const response = await handleRequest(
      api.put('/auth/username', { username })
    );
    setUser(prev => prev ? { ...prev, username: response.data.username } : null);
  };

  // Type guard for File
  function isFile(value: unknown): value is File {
    return value instanceof File ||
      (typeof value === 'object' &&
        value !== null &&
        'name' in value &&
        'size' in value &&
        'type' in value);
  }

  // Type guard for Blob
  function isBlob(value: unknown): value is Blob {
    return value instanceof Blob ||
      (typeof value === 'object' &&
        value !== null &&
        'size' in value &&
        'type' in value);
  }

  const updateProfile = async (data: Partial<User> | FormData) => {
    try {
      let response;
      
      if (data instanceof FormData) {
        // Handle file upload
        response = await handleRequest(
          api.put('/users/profile', data, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
        );
      } else {
        // Handle regular data
        const formData = new FormData();
        Object.entries(data).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.append(key, String(value));
          }
        });
        
        response = await handleRequest(
          api.put('/users/profile', formData)
        );
      }
  
      setUser(response.data);
      return response.data;
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  };
  

  const forgotPassword = async (email: string) => {
    await handleRequest(api.post('/auth/forgot-password', { email }));
  };

  const resetPassword = async (token: string, password: string) => {
    await handleRequest(
      api.post('/auth/reset-password', { token, password })
    );
  };

  const clearError = () => setError(null);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    register,
    loginWithGoogle,
    logout,
    updateUsername,
    updateProfile,
    forgotPassword,
    resetPassword,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
