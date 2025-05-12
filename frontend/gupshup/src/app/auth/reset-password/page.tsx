import { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { MessageCircleHeart } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Reset Password | GupShup - Account Recovery',
  description: 'Reset your GupShup account password securely. Quick and easy password recovery process.',
  keywords: 'reset password, forgot password, account recovery, GupShup password reset',
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token: string };
}) {
  const { token } =  searchParams;

  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col space-y-2 text-center">
          <div className="flex justify-center mb-2">
            <MessageCircleHeart className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Create a new strong password for your account
          </p>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}