/**
 * Home Page - Redirects to login or dashboard
 * Neo-Brutalist Design
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.push('/dashboard');
      } else {
        router.push('/auth');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
      <div className="text-center">
        {/* Animated Logo */}
        <div className="w-24 h-24 rounded-2xl bg-[#14B8A6] border-[4px] border-black flex items-center justify-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mx-auto mb-8 animate-float">
          <span className="text-5xl">🏥</span>
        </div>

        <h1 className="text-4xl font-bold mb-4">
          <span className="highlight-teal px-2 py-1">Cipher</span>Health
        </h1>

        {/* Loading Spinner */}
        <div className="relative w-16 h-16 mx-auto mt-8">
          <div className="w-16 h-16 border-[4px] border-gray-200 rounded-full"></div>
          <div className="absolute top-0 left-0 w-16 h-16 border-[4px] border-transparent border-t-[#14B8A6] rounded-full animate-spin"></div>
        </div>

        <p className="text-gray-600 mt-6 font-medium text-lg">
          Loading your secure workspace...
        </p>
      </div>
    </main>
  );
}
