import { Metadata } from 'next';
import { UsernameSetupForm } from '@/components/auth/username-setup-form';
import { MessageCircleHeart } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Setup Username | GupShup - Choose Your Identity',
  description: 'Choose your unique username for GupShup. Make it easy for friends to find and connect with you.',
  keywords: 'username setup, choose username, chat profile, GupShup username',
};

export default function SetupUsernamePage() {
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col space-y-2 text-center">
          <div className="flex justify-center mb-2">
            <MessageCircleHeart className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Choose a username
          </h1>
          <p className="text-sm text-muted-foreground">
            This unique username will be used to find you on GupShup
          </p>
        </div>
        <UsernameSetupForm />
      </div>
    </div>
  );
}