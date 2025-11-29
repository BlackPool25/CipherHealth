/**
 * Navigation bar component with wallet connection
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
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/files', label: 'Files' },
    { href: '/upload', label: 'Upload' },
    { href: '/access-requests', label: 'Access Management' },
    { href: '/audit', label: 'Audit' },
    { href: '/profile', label: 'Profile' },
  ];

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Nav Links */}
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-blue-600">CipherHealth</span>
            </Link>
            
            {isAuthenticated && (
              <div className="hidden md:ml-8 md:flex md:space-x-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      router.pathname === link.href
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Right side - Wallet & Auth */}
          <div className="flex items-center space-x-4">
            {/* Network Status */}
            {isConnected && !isCorrectNetwork && (
              <button
                onClick={switchToSepolia}
                className="px-3 py-1.5 text-sm bg-yellow-100 text-yellow-800 rounded-md hover:bg-yellow-200 transition-colors"
              >
                Switch to Sepolia
              </button>
            )}
            
            {isConnected && isCorrectNetwork && (
              <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">
                Sepolia
              </span>
            )}

            {/* Wallet Connection */}
            {!isConnected ? (
              <button
                onClick={connect}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 rounded-md">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-mono text-gray-700">
                  {formatAddress(address!)}
                </span>
              </div>
            )}

            {/* User Menu */}
            {isAuthenticated && (
              <div className="flex items-center space-x-3">
                <span className="text-sm text-gray-600">
                  {user?.username}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
