/**
 * Seed Login Modal Component - Modern Colorful Theme
 * Handles invite-only authentication flow
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { seedInvite, register, seedLogin } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface SeedLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'invite' | 'register' | 'success';

export default function SeedLoginModal({ isOpen, onClose }: SeedLoginModalProps) {
  const router = useRouter();
  const { login } = useAuth();
  
  const [step, setStep] = useState<Step>('invite');
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSeedInvite = async () => {
    setIsLoading(true);
    setError('');
    
    const result = await seedInvite(inviteCode || undefined);
    
    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    
    if (result.data) {
      setGeneratedCode(result.data.code);
      setInviteCode(result.data.code);
      setStep('register');
    }
    setIsLoading(false);
  };

  const handleQuickLogin = async () => {
    if (!inviteCode) {
      setError('Please enter an invite code');
      return;
    }

    setIsLoading(true);
    setError('');

    const result = await seedLogin(inviteCode);

    if (result.error) {
      setError('');
      setStep('register');
      setIsLoading(false);
      return;
    }

    if (result.data) {
      login(result.data.user, result.data.access_token);
      setStep('success');
      
      setTimeout(() => {
        onClose();
        router.push('/dashboard');
      }, 1500);
    }
    setIsLoading(false);
  };

  const handleRegister = async () => {
    if (!username || !email) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    const result = await register({
      username,
      email,
      invite_code: inviteCode || generatedCode,
    });

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    if (result.data) {
      login(result.data.user, result.data.access_token);
      setStep('success');
      
      setTimeout(() => {
        onClose();
        router.push('/dashboard');
      }, 1500);
    }
    setIsLoading(false);
  };

  const handleUseExistingCode = () => {
    if (!inviteCode) {
      setError('Please enter an invite code');
      return;
    }
    handleQuickLogin();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card max-w-md w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-6 py-5">
          <h2 className="text-xl font-bold text-white">
            {step === 'invite' && '🔑 Invite-Only Access'}
            {step === 'register' && '✨ Complete Registration'}
            {step === 'success' && '🎉 Welcome!'}
          </h2>
          <p className="text-white/80 text-sm mt-1">
            {step === 'invite' && 'Enter or generate an invite code'}
            {step === 'register' && 'Create your account'}
            {step === 'success' && 'Registration successful'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2">
              <span>⚠️</span>
              {error}
            </div>
          )}

          {step === 'invite' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter existing invite code"
                  className="input-dark w-full"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={handleUseExistingCode}
                  disabled={isLoading}
                  className="flex-1 btn-ghost"
                >
                  Use Code
                </button>
                <button
                  onClick={handleSeedInvite}
                  disabled={isLoading}
                  className="flex-1 btn-neon"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Generating...
                    </span>
                  ) : 'Generate New'}
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center">
                Demo mode: Click "Generate New" to create an invite code
              </p>
            </div>
          )}

          {step === 'register' && (
            <div className="space-y-4">
              {generatedCode && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-sm text-emerald-800">
                    <span className="font-semibold">✓ Invite Code:</span>{' '}
                    <code className="bg-emerald-100 px-2 py-0.5 rounded font-mono">{generatedCode}</code>
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  className="input-dark w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="input-dark w-full"
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setStep('invite')}
                  className="btn-ghost"
                >
                  Back
                </button>
                <button
                  onClick={handleRegister}
                  disabled={isLoading}
                  className="flex-1 btn-neon"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Registering...
                    </span>
                  ) : 'Register'}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30 animate-bounce">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-900 font-bold text-lg mb-1">You're all set!</p>
              <p className="text-gray-500 text-sm">Redirecting to dashboard...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'success' && (
          <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
