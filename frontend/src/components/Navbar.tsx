/**
 * Navigation bar component with wallet connection
 * Neo-Brutalist CipherHealth Theme - Paperfolio Inspired
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useWalletContext } from '@/contexts/WalletContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  FolderOpen,
  Shield,
  Users,
  Upload,
  ClipboardList,
  User,
  LogOut,
  Zap,
  Menu,
  X
} from 'lucide-react';
import { useState } from 'react';

export default function Navbar() {
  const router = useRouter();
  const { isConnected, isCorrectNetwork, address, connect, switchToSepolia } = useWalletContext();
  const { isAuthenticated, user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/auth');
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Base navigation links (shown to all authenticated users)
  const baseNavLinks = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  // Patient-specific links
  const patientNavLinks = [
    { href: '/files', label: 'My Files', icon: FolderOpen },
    { href: '/hospital-access', label: 'Access', icon: Shield },
  ];

  // Hospital-specific links
  const hospitalNavLinks = [
    { href: '/my-patients', label: 'Patients', icon: Users },
    { href: '/patient-files', label: 'Files', icon: FolderOpen },
    { href: '/upload', label: 'Upload', icon: Upload },
  ];

  // Common links for all users
  const commonNavLinks = [
    { href: '/audit', label: 'Audit', icon: ClipboardList },
    { href: '/profile', label: 'Profile', icon: User },
  ];

  // Build nav links based on user role
  const navLinks = [
    ...baseNavLinks,
    ...(user?.role === 'patient' ? patientNavLinks : []),
    ...(user?.role === 'hospital' ? hospitalNavLinks : []),
    ...commonNavLinks,
  ];

  return (
    <nav className="bg-white border-b-[3px] border-black sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-[#14B8A6] border-[3px] border-black flex items-center justify-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:-translate-y-0.5 transition-all">
              <span className="text-xl">🏥</span>
            </div>
            <span className="text-xl font-bold hidden sm:block">CipherHealth</span>
          </Link>

          {/* Desktop Nav Links */}
          {isAuthenticated && (
            <div className="hidden lg:flex items-center gap-1">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = router.pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${isActive
                        ? 'bg-black text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,0.2)]'
                        : 'text-black hover:bg-gray-100'
                      }`}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Right Side Actions */}
          <div className="flex items-center gap-3">
            {/* Network Status Badge */}
            {isConnected && !isCorrectNetwork && (
              <button
                onClick={switchToSepolia}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#FFC224] border-2 border-black rounded-lg text-sm font-bold hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                ⚠️ Switch Network
              </button>
            )}

            {isConnected && isCorrectNetwork && (
              <Badge variant="success" className="hidden sm:flex">
                <span className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse mr-1" />
                Sepolia
              </Badge>
            )}

            {/* Wallet Connection */}
            {!isConnected ? (
              <Button
                onClick={connect}
                variant="yellow"
                size="sm"
                className="hidden sm:flex"
              >
                <Zap className="w-4 h-4" />
                Connect
              </Button>
            ) : (
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg border-2 border-black">
                <span className="w-2 h-2 bg-[#10B981] rounded-full" />
                <span className="text-sm font-mono font-bold">
                  {formatAddress(address!)}
                </span>
              </div>
            )}

            {/* User Menu */}
            {isAuthenticated && (
              <div className="hidden sm:flex items-center gap-3 pl-3 border-l-2 border-black">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-[#14B8A6] border-[3px] border-black flex items-center justify-center text-white text-sm font-bold">
                    {user?.username?.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-bold hidden xl:block">
                    {user?.username}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg border-2 border-black hover:bg-[#E7000B] hover:text-white hover:border-[#E7000B] transition-all"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Mobile Menu Button */}
            <button
              className="lg:hidden p-2 border-2 border-black rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && isAuthenticated && (
        <div className="lg:hidden border-t-2 border-black bg-white">
          <div className="px-4 py-4 space-y-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = router.pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-base font-bold transition-all ${isActive
                      ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]'
                      : 'bg-gray-50 text-black border-2 border-black hover:bg-gray-100'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile Wallet Section */}
            <div className="pt-4 border-t-2 border-black mt-4">
              {!isConnected ? (
                <Button onClick={connect} variant="yellow" className="w-full">
                  <Zap className="w-4 h-4" />
                  Connect Wallet
                </Button>
              ) : (
                <div className="flex items-center justify-between p-3 bg-gray-100 rounded-xl border-2 border-black">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#10B981] rounded-full" />
                    <span className="text-sm font-mono font-bold">
                      {formatAddress(address!)}
                    </span>
                  </div>
                  {!isCorrectNetwork && (
                    <button
                      onClick={switchToSepolia}
                      className="text-sm font-bold text-[#D97706] hover:underline"
                    >
                      Switch
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Mobile User Section */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-[#14B8A6] border-[3px] border-black flex items-center justify-center text-white font-bold">
                  {user?.username?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold">{user?.username}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                </div>
              </div>
              <Button onClick={handleLogout} variant="destructive" size="sm">
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
