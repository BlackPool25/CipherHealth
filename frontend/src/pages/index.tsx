/**
 * Home Page - Redirects to login or dashboard
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
        router.push('/login');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-mesh-gradient">
      <div className="text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-1 shadow-xl shadow-indigo-500/30 mx-auto mb-6 animate-float">
          <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
            <span className="text-4xl">🏥</span>
          </div>
        </div>
        <h1 className="text-3xl font-bold gradient-text mb-4">
          CipherHealth
        </h1>
        <div className="relative w-12 h-12 mx-auto">
          <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
          <div className="absolute top-0 left-0 w-12 h-12 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
        </div>
        <p className="text-gray-500 mt-4">Loading your secure workspace...</p>
      </div>
    </main>
  );
}
