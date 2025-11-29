/**
 * Navigation bar component with wallet connection
 * Modern colorful healthcare theme
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useWalletContext } from '@/contexts/WalletContext';
import { useAuth } from '@/contexts/AuthContext';

export default function Navbar() {
  const router = useRouter();
  const { isConnected, isCorrectNetwork, address, connect, switchToSepolia } = useWalletContext();
  const { isAuthenticated, user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/files', label: 'Files', icon: '📁' },
    { href: '/upload', label: 'Upload', icon: '⬆️' },
    { href: '/access-requests', label: 'Access', icon: '🔐' },
    { href: '/audit', label: 'Audit', icon: '📋' },
    { href: '/profile', label: 'Profile', icon: '👤' },
  ];

  return (
    <nav className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Nav Links */}
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0 flex items-center group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 mr-3 group-hover:scale-105 transition-transform">
                <span className="text-xl">🏥</span>
              </div>
              <span className="text-xl font-bold gradient-text">CipherHealth</span>
            </Link>
            
            {isAuthenticated && (
              <div className="hidden md:ml-8 md:flex md:space-x-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      router.pathname === link.href
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/25'
                        : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    <span className="text-base">{link.icon}</span>
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Right side - Wallet & Auth */}
          <div className="flex items-center space-x-3">
            {/* Network Status */}
            {isConnected && !isCorrectNetwork && (
              <button
                onClick={switchToSepolia}
                className="px-4 py-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all duration-200 font-medium"
              >
                ⚠️ Switch to Sepolia
              </button>
            )}
            
            {isConnected && isCorrectNetwork && (
              <span className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                Sepolia
              </span>
            )}

            {/* Wallet Connection */}
            {!isConnected ? (
              <button
                onClick={connect}
                className="btn-neon text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center space-x-2 px-4 py-2 bg-gray-50 rounded-xl border border-gray-200">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-mono text-gray-700">
                  {formatAddress(address!)}
                </span>
              </div>
            )}

            {/* User Menu */}
            {isAuthenticated && (
              <div className="flex items-center space-x-3 pl-3 border-l border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
                    {user?.username?.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-700 font-medium hidden lg:block">
                    {user?.username}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="Logout"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Mobile nav */}
      {isAuthenticated && (
        <div className="md:hidden border-t border-gray-100 px-2 py-2 bg-gray-50">
          <div className="flex overflow-x-auto space-x-1 pb-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  router.pathname === link.href
                    ? 'bg-indigo-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-white hover:text-indigo-600'
                }`}
              >
                <span className="mr-1">{link.icon}</span>
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
