import  { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';
import { MessageCircleHeart } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Login | GupShup - Secure Chat Application',
  description: 'Login to your GupShup account to start chatting with friends and family. Secure, fast, and reliable messaging.',
  keywords: 'login, sign in, chat app, messaging, GupShup login',
};

export default function LoginPage() {
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col space-y-2 text-center">
          <div className="flex justify-center mb-2">
            <MessageCircleHeart className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to sign in to your account
          </p>
        </div>
        <LoginForm />
        <p className="px-8 text-center text-sm text-muted-foreground">
          <Link
            href="/auth/register"
            className="hover:text-brand underline underline-offset-4"
          >
            Don&apos;t have an account? Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}