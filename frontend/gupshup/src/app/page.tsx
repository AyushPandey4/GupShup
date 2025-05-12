import { SplashScreen } from '@/components/SplashScreen';

export default function Home() {
  // Since this is a chat app, we'll redirect to the chat page or login page
  // We'll use a splash screen while checking authentication
  return (
    <main className="flex h-screen w-full items-center justify-center">
      <SplashScreen />
    </main>
  );
}