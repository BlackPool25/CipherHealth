/**
 * Login Page - Modern Colorful Theme
 * Invite-only authentication with MetaMask connection
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { useWalletContext } from '@/contexts/WalletContext';
import SeedLoginModal from '@/components/SeedLoginModal';

export default function LoginPage() {
  const router = useRouter();
  const { 
    isMetaMaskInstalled, 
    isConnected, 
    isCorrectNetwork, 
    address, 
    connect, 
    switchToSepolia,
    isLoading 
  } = useWalletContext();
  
  const [showLoginModal, setShowLoginModal] = useState(false);

  const handleConnect = async () => {
    await connect();
  };

  const handleProceedToLogin = () => {
    setShowLoginModal(true);
  };

  return (
    <div className="min-h-screen bg-mesh-gradient flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo and Title */}
        <div className="text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-1 shadow-xl shadow-indigo-500/30 animate-float">
              <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
                <span className="text-3xl">🏥</span>
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-bold gradient-text mb-2">CipherHealth</h1>
          <p className="text-gray-600">
            Secure, decentralized health record management
          </p>
        </div>

        {/* Connection Card */}
        <div className="glass-card p-8 space-y-6">
          <h2 className="text-xl font-bold text-gray-900 text-center">
            Connect to Get Started
          </h2>

          {/* Step 1: Install MetaMask */}
          <div className={`flex items-center space-x-4 p-4 rounded-xl border-2 ${
            isMetaMaskInstalled 
              ? 'bg-emerald-50 border-emerald-200' 
              : 'bg-amber-50 border-amber-200'
          }`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
              isMetaMaskInstalled 
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500' 
                : 'bg-gradient-to-br from-amber-500 to-orange-500'
            }`}>
              {isMetaMaskInstalled ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-bold">1</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-semibold ${isMetaMaskInstalled ? 'text-emerald-800' : 'text-amber-800'}`}>
                {isMetaMaskInstalled ? 'MetaMask Detected' : 'Install MetaMask'}
              </p>
              {!isMetaMaskInstalled && (
                <a 
                  href="https://metamask.io/download/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Download MetaMask →
                </a>
              )}
            </div>
          </div>

          {/* Step 2: Connect Wallet */}
          <div className={`flex items-center space-x-4 p-4 rounded-xl border-2 ${
            isConnected 
              ? 'bg-emerald-50 border-emerald-200' 
              : 'bg-gray-50 border-gray-200'
          }`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
              isConnected 
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500' 
                : 'bg-gray-300'
            }`}>
              {isConnected ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-bold">2</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-semibold ${isConnected ? 'text-emerald-800' : 'text-gray-600'}`}>
                {isConnected ? (
                  <span className="flex items-center gap-2">
                    Connected
                    <code className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono">
                      {address?.slice(0, 6)}...{address?.slice(-4)}
                    </code>
                  </span>
                ) : 'Connect Wallet'}
              </p>
            </div>
            {isMetaMaskInstalled && !isConnected && (
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="btn-neon text-sm py-2 px-4"
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          {/* Step 3: Switch Network */}
          <div className={`flex items-center space-x-4 p-4 rounded-xl border-2 ${
            isCorrectNetwork 
              ? 'bg-emerald-50 border-emerald-200' 
              : isConnected 
                ? 'bg-amber-50 border-amber-200' 
                : 'bg-gray-50 border-gray-200'
          }`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
              isCorrectNetwork 
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500' 
                : isConnected 
                  ? 'bg-gradient-to-br from-amber-500 to-orange-500' 
                  : 'bg-gray-300'
            }`}>
              {isCorrectNetwork ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-bold">3</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-semibold ${
                isCorrectNetwork 
                  ? 'text-emerald-800' 
                  : isConnected 
                    ? 'text-amber-800' 
                    : 'text-gray-500'
              }`}>
                {isCorrectNetwork ? (
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Sepolia Network
                  </span>
                ) : 'Switch to Sepolia'}
              </p>
            </div>
            {isConnected && !isCorrectNetwork && (
              <button
                onClick={switchToSepolia}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm rounded-xl font-semibold hover:opacity-90 transition-opacity shadow-md"
              >
                Switch
              </button>
            )}
          </div>

          {/* Login Button */}
          <button
            onClick={handleProceedToLogin}
            disabled={!isConnected || !isCorrectNetwork}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all duration-300 ${
              isConnected && isCorrectNetwork
                ? 'btn-neon'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed border-2 border-gray-200'
            }`}
          >
            Continue with Invite Code
          </button>

          <p className="text-sm text-gray-500 text-center">
            This application uses invite-only access.
            <br />
            Contact an administrator for an invite code.
          </p>
        </div>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-4 text-gray-500 text-sm">
          <span className="flex items-center gap-1.5 bg-white/80 px-3 py-1.5 rounded-full border border-gray-200">
            <span>🔒</span> End-to-End Encrypted
          </span>
          <span className="flex items-center gap-1.5 bg-white/80 px-3 py-1.5 rounded-full border border-gray-200">
            <span>⛓️</span> Blockchain Powered
          </span>
        </div>
      </div>

      {/* Seed Login Modal */}
      <SeedLoginModal 
        isOpen={showLoginModal} 
        onClose={() => setShowLoginModal(false)} 
      />
    </div>
  );
}
