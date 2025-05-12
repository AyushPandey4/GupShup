'use client';

import { toast as sonnerToast } from 'sonner';
import type { ToastT } from 'sonner';

/**
 * Extended toast function with shadcn/sonner
 */
export function toast(
  messageOrOptions: string | React.ReactNode | { 
    title: string | React.ReactNode;
    description?: string | React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
    duration?: number;
    position?: ToastT['position'];
    [key: string]: any;
  },
  options?: {
    description?: string | React.ReactNode;
    action?: {
      label: string;
      onClick: () => void;
    };
    duration?: number;
    position?: ToastT['position'];
    variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
    icon?: React.ReactNode;
    dismissible?: boolean;
    id?: string;
    className?: string;
    style?: React.CSSProperties;
  }
) {
  // Handle case where first argument is an object with title & description
  if (typeof messageOrOptions === 'object' && messageOrOptions !== null && 'title' in messageOrOptions) {
    const { title, description, variant = 'default', ...rest } = messageOrOptions;
    const toastFn = variant === 'error' ? sonnerToast.error : 
                   variant === 'success' ? sonnerToast.success :
                   variant === 'warning' ? sonnerToast.warning :
                   variant === 'info' ? sonnerToast.info : sonnerToast;
    
    return toastFn(title, {
      description,
      ...rest
    });
  }
  
  // Handle normal usage (message + options)
  const {
    description,
    action,
    duration = 5000,
    position = 'top-center',
    variant = 'default',
    icon,
    dismissible = true,
    id,
    className,
    style,
  } = options || {};

  const toastVariants = {
    default: sonnerToast,
    success: sonnerToast.success,
    warning: sonnerToast.warning,
    error: sonnerToast.error,
    info: sonnerToast.info,
  };

  const toastFn = toastVariants[variant] || sonnerToast;

  return toastFn(messageOrOptions, {
    description,
    duration,
    position,
    action,
    icon,
    dismissible,
    id,
    className,
    style,
  });
}

/**
 * React hook version of the toast
 */
export function useToast() {
  return {
    toast,
    dismiss: sonnerToast.dismiss,
    promise: sonnerToast.promise,
    loading: sonnerToast.loading,
    success: sonnerToast.success,
    error: sonnerToast.error,
    warning: sonnerToast.warning,
    info: sonnerToast.info,
  };
}

// Type exports for convenience
export type { ToastT as Toast } from 'sonner';