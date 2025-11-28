/**
 * Login Page
 * Invite-only authentication with MetaMask connection
 * 
 * Backend Endpoints Called:
 * - POST /auth/seed-invite - Seeds a new invite code (dev mode)
 * - POST /auth/register - Registers user with invite code
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo and Title */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-blue-600">CipherHealth</h1>
          <p className="mt-2 text-gray-600">
            Secure, decentralized health record management
          </p>
        </div>

        {/* Connection Card */}
        <div className="bg-white rounded-xl shadow-lg p-8 space-y-6">
          <h2 className="text-xl font-semibold text-gray-800 text-center">
            Connect to Get Started
          </h2>

          {/* Step 1: Install MetaMask */}
          <div className={`flex items-center space-x-4 p-4 rounded-lg ${
            isMetaMaskInstalled ? 'bg-green-50' : 'bg-yellow-50'
          }`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              isMetaMaskInstalled ? 'bg-green-500' : 'bg-yellow-500'
            }`}>
              {isMetaMaskInstalled ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-semibold">1</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${isMetaMaskInstalled ? 'text-green-800' : 'text-yellow-800'}`}>
                {isMetaMaskInstalled ? 'MetaMask Detected' : 'Install MetaMask'}
              </p>
              {!isMetaMaskInstalled && (
                <a 
                  href="https://metamask.io/download/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  Download MetaMask →
                </a>
              )}
            </div>
          </div>

          {/* Step 2: Connect Wallet */}
          <div className={`flex items-center space-x-4 p-4 rounded-lg ${
            isConnected ? 'bg-green-50' : 'bg-gray-50'
          }`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              isConnected ? 'bg-green-500' : 'bg-gray-400'
            }`}>
              {isConnected ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-semibold">2</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${isConnected ? 'text-green-800' : 'text-gray-700'}`}>
                {isConnected ? `Connected: ${address?.slice(0, 6)}...${address?.slice(-4)}` : 'Connect Wallet'}
              </p>
            </div>
            {isMetaMaskInstalled && !isConnected && (
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          {/* Step 3: Switch Network */}
          <div className={`flex items-center space-x-4 p-4 rounded-lg ${
            isCorrectNetwork ? 'bg-green-50' : isConnected ? 'bg-yellow-50' : 'bg-gray-50'
          }`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              isCorrectNetwork ? 'bg-green-500' : isConnected ? 'bg-yellow-500' : 'bg-gray-400'
            }`}>
              {isCorrectNetwork ? (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-white font-semibold">3</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${
                isCorrectNetwork ? 'text-green-800' : isConnected ? 'text-yellow-800' : 'text-gray-500'
              }`}>
                {isCorrectNetwork ? 'Sepolia Network' : 'Switch to Sepolia'}
              </p>
            </div>
            {isConnected && !isCorrectNetwork && (
              <button
                onClick={switchToSepolia}
                className="px-4 py-2 bg-yellow-500 text-white text-sm rounded-md hover:bg-yellow-600 transition-colors"
              >
                Switch
              </button>
            )}
          </div>

          {/* Login Button */}
          <button
            onClick={handleProceedToLogin}
            disabled={!isConnected || !isCorrectNetwork}
            className={`w-full py-3 rounded-lg font-medium transition-colors ${
              isConnected && isCorrectNetwork
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Continue with Invite Code
          </button>

          <p className="text-xs text-gray-500 text-center">
            This application uses invite-only access. Contact an administrator for an invite code.
          </p>
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
