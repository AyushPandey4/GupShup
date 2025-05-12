'use client';

import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import axios from 'axios';

export function GoogleSignInButton() {
  const { loginWithGoogle } = useAuth();
  const { promise } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setIsLoading(true);
      try {
        // Get user info from Google
        const userInfo = await axios.get(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
          }
        );

        await promise(
          loginWithGoogle(tokenResponse.access_token),
          {
            loading: 'Signing in with Google...',
            success: () => {
              router.push('/chat');
              return {
                message: 'Success!',
                description: 'Successfully signed in with Google',
              };
            },
            error: (err) => ({
              message: 'Failed to sign in',
              description: err?.message || 'An error occurred during sign in'
            })
          }
        );
      } catch (err) {
        console.error('Google sign-in error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      console.error('Google OAuth error:', error);
      // Don't show error for user-cancelled flow
      if (error.toString().includes('popup_closed_by_user')) {
        return;
      }
    },
    flow: 'implicit'
  });

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={() => handleGoogleLogin()}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <svg
          className="mr-2 h-4 w-4"
          aria-hidden="true"
          focusable="false"
          data-prefix="fab"
          data-icon="google"
          role="img"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 488 512"
        >
          <path
            fill="currentColor"
            d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
          ></path>
        </svg>
      )}
      Continue with Google
    </Button>
  );
}