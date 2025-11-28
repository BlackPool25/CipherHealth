/**
 * Seed Login Modal Component
 * Handles invite-only authentication flow
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { seedInvite, register } from '@/lib/api';
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
      // For demo purposes, we'll create a mock token
      // In production, this would come from the backend
      const mockToken = `demo_token_${Date.now()}`;
      login(result.data.user, mockToken);
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
    setStep('register');
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-4">
          <h2 className="text-xl font-semibold text-white">
            {step === 'invite' && 'Invite-Only Access'}
            {step === 'register' && 'Complete Registration'}
            {step === 'success' && 'Welcome!'}
          </h2>
          <p className="text-blue-100 text-sm mt-1">
            {step === 'invite' && 'Enter or generate an invite code'}
            {step === 'register' && 'Create your account'}
            {step === 'success' && 'Registration successful'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
              {error}
            </div>
          )}

          {step === 'invite' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter existing invite code"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={handleUseExistingCode}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  Use Code
                </button>
                <button
                  onClick={handleSeedInvite}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Generating...' : 'Generate New'}
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
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm text-green-800">
                    <span className="font-medium">Invite Code:</span>{' '}
                    <code className="bg-green-100 px-1 rounded">{generatedCode}</code>
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setStep('invite')}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleRegister}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Registering...' : 'Register'}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-600">Redirecting to dashboard...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'success' && (
          <div className="bg-gray-50 px-6 py-3 border-t">
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
