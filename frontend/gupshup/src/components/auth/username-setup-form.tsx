'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, X } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

const formSchema = z.object({
  username: z
    .string()
    .min(3, {
      message: 'Username must be at least 3 characters.',
    })
    .max(20, {
      message: 'Username must not be longer than 20 characters.',
    })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: 'Username can only contain letters, numbers, and underscores.',
    }),
});

export function UsernameSetupForm() {
  const router = useRouter();
  const { promise } = useToast();
  const { updateUsername, isAuthenticated, user } = useAuth();
  const [isChecking, setIsChecking] = React.useState(false);
  const [isAvailable, setIsAvailable] = React.useState<boolean | null>(null);
  const debounceTimeout = React.useRef<NodeJS.Timeout | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
    },
  });

  React.useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isAuthenticated, router]);

  const checkUsernameAvailability = React.useCallback(async (username: string) => {
    if (username.length < 3) {
      setIsAvailable(null);
      return;
    }

    setIsChecking(true);
    try {
      // Simulate API call with delay
      await new Promise(resolve => setTimeout(resolve, 800));
      const available = !username.includes('taken');
      setIsAvailable(available);
    } catch (error) {
      setIsAvailable(null);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const username = form.watch('username');

  React.useEffect(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    if (username.length >= 3) {
      debounceTimeout.current = setTimeout(() => {
        checkUsernameAvailability(username);
      }, 500);
    } else {
      setIsAvailable(null);
    }

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [username, checkUsernameAvailability]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!isAvailable) {
      promise(
        Promise.reject(new Error('Username not available')),
        {
          loading: 'Checking username...',
          error: () => ({
            message: 'Username not available',
            description: 'Please choose a different username.',
            // Remove variant and use error() method instead
          })
        }
      );
      return;
    }

    try {
      await promise(
        updateUsername(values.username),
        {
          loading: 'Setting up your username...',
          success: () => {
            router.push('/chat');
            return {
              message: 'Success!',
              description: 'Your username has been set.',
            };
          },
          error: (err) => ({
            message: 'Setup failed',
            description: err.message || 'Failed to set username. Please try again.',
            // Remove variant here too
          })
        }
      );
    } catch (error) {
      console.error('Unexpected error:', error);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    placeholder="cooluser123"
                    autoComplete="username"
                    {...field}
                  />
                </FormControl>
                {isChecking && (
                  <div className="absolute right-3 top-2.5">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {isAvailable === true && !isChecking && (
                  <div className="absolute right-3 top-2.5">
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                )}
                {isAvailable === false && !isChecking && (
                  <div className="absolute right-3 top-2.5">
                    <X className="h-5 w-5 text-destructive" />
                  </div>
                )}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting || isChecking || isAvailable === false}
        >
          {form.formState.isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Continue
        </Button>
      </form>
    </Form>
  );
}