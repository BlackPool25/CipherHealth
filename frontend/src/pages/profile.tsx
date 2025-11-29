/**
 * Profile Page - Modern Colorful User Profile
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { address, disconnect } = useWalletContext();
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleLogout = async () => {
    try {
      await logout();
      if (disconnect) disconnect();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-indigo-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated || !user) return null;

  const stats = [
    { label: 'Records Uploaded', value: '12', icon: '📁', color: 'indigo' },
    { label: 'Access Grants', value: '8', icon: '🔑', color: 'emerald' },
    { label: 'Active Shares', value: '5', icon: '👥', color: 'purple' },
    { label: 'Audit Events', value: '24', icon: '📋', color: 'sky' },
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Profile Card */}
        <div className="glass-card overflow-hidden mb-6">
          {/* Banner */}
          <div className="h-32 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 relative">
            <div className="absolute inset-0 opacity-30">
              <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <pattern id="dots" patternUnits="userSpaceOnUse" width="20" height="20">
                    <circle cx="2" cy="2" r="1" fill="white" opacity="0.3"/>
                  </pattern>
                </defs>
                <rect fill="url(#dots)" width="100" height="100"/>
              </svg>
            </div>
          </div>
          
          {/* Profile Info */}
          <div className="px-6 pb-6 -mt-12 relative">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold border-4 border-white shadow-xl">
                {user.username?.charAt(0).toUpperCase() || '?'}
              </div>
              
              <div className="flex-1 text-center sm:text-left">
                <h1 className="text-2xl font-bold text-gray-900">{user.username || 'Anonymous User'}</h1>
                <p className="text-gray-500 capitalize">Patient</p>
              </div>
              
              <button
                onClick={handleLogout}
                className="btn-ghost text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map((stat) => (
            <div key={stat.label} className="glass-card p-4 text-center card-lift">
              <div className={`icon-box icon-box-${stat.color} w-12 h-12 mx-auto mb-3`}>
                <span className="text-lg">{stat.icon}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Account Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Wallet Info */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="icon-box icon-box-amber">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">Wallet</h2>
            </div>
            
            {address ? (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-sm text-gray-500 mb-1">Connected Address</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-indigo-600 font-mono">{formatAddress(address)}</code>
                    <button
                      onClick={() => copyToClipboard(address, 'address')}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      {copied === 'address' ? (
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success">🟢 Connected</span>
                  <span className="text-sm text-gray-500">Sepolia Testnet</span>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <span className="text-amber-600">No wallet connected</span>
              </div>
            )}
          </div>

          {/* Account Info */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="icon-box icon-box-indigo">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">Account</h2>
            </div>
            
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">User ID</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-indigo-600 font-mono">{user.id}</code>
                  <button
                    onClick={() => copyToClipboard(String(user.id), 'id')}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                  >
                    {copied === 'id' ? (
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Role</p>
                <span className="badge-info capitalize">Patient</span>
              </div>
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div className="glass-card p-6 mt-6 border-l-4 border-emerald-500">
          <div className="flex items-start gap-4">
            <div className="icon-box icon-box-emerald flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Your Data is Secure</h3>
              <p className="text-gray-500 text-sm">
                All your health records are encrypted with proxy re-encryption and stored on decentralized infrastructure. 
                Only you control who can access your data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
