/**
 * Profile Page - Modern Colorful User Profile
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { getCurrentUser, listFiles, listGrants, getAuditLogs, updatePublicKey, verifyPassword } from '@/lib/api';
import KeyManager from '@/lib/KeyManager';

interface UserProfile {
  id: number;
  uuid: string;
  username: string;
  email: string;
  role: string;
  public_key: string | null;
  created_at: string;
}

interface ProfileStats {
  records: number;
  grants: number;
  shares: number;
  audits: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout, login } = useAuth();
  const { address, disconnect } = useWalletContext();
  const [copied, setCopied] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats>({ records: 0, grants: 0, shares: 0, audits: 0 });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  
  // Encryption key setup
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [isSettingUpKeys, setIsSettingUpKeys] = useState(false);
  const [keySetupError, setKeySetupError] = useState('');
  
  // Passphrase verification and key viewing
  const [showPassphraseVerify, setShowPassphraseVerify] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [testPassphrase, setTestPassphrase] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [revealedPrivateKey, setRevealedPrivateKey] = useState<string | null>(null);
  const [revealedSigningKey, setRevealedSigningKey] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  // Fetch full user profile with UUID
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user?.id) return;
      
      setIsLoadingProfile(true);
      
      // Fetch full profile from API
      const result = await getCurrentUser();
      if (result.data) {
        setUserProfile(result.data);
        
        // Update the auth context with UUID if missing
        if (!user.uuid && result.data.uuid) {
          login({
            ...user,
            uuid: result.data.uuid,
            role: result.data.role as 'patient' | 'hospital',
          }, localStorage.getItem('jwt_token') || '');
        }
      }
      
      // Fetch actual stats
      const [filesResult, grantsResult, auditsResult] = await Promise.all([
        listFiles(user.id),
        listGrants(user.id),
        getAuditLogs(user.id),
      ]);
      
      setStats({
        records: filesResult.data?.files?.length || 0,
        grants: grantsResult.data?.grants?.length || 0,
        shares: grantsResult.data?.grants?.filter((g: any) => g.status === 'active')?.length || 0,
        audits: auditsResult.data?.logs?.length || 0,
      });
      
      setIsLoadingProfile(false);
    };
    
    fetchProfile();
  }, [user?.id]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSetupKeys = async () => {
    if (keyPassphrase !== confirmPassphrase) {
      setKeySetupError('Passphrases do not match');
      return;
    }
    if (keyPassphrase.length < 8) {
      setKeySetupError('Passphrase must be at least 8 characters');
      return;
    }
    if (!user?.id) {
      setKeySetupError('User not logged in');
      return;
    }

    setIsSettingUpKeys(true);
    setKeySetupError('');

    try {
      // Generate keypair and store encrypted locally
      const keyResult = await KeyManager.createKeypair(String(user.id), keyPassphrase);
      
      if (!keyResult.success || !keyResult.publicKeyHex) {
        throw new Error(keyResult.error || 'Failed to create keypair');
      }

      // Send public key to backend (works for both patients and hospitals)
      const apiResult = await updatePublicKey(keyResult.publicKeyHex);

      if (apiResult.error) {
        throw new Error(apiResult.error);
      }

      // Update local profile state
      setUserProfile((prev) => prev ? { ...prev, public_key: keyResult.publicKeyHex! } : null);
      setShowKeySetup(false);
      setKeyPassphrase('');
      setConfirmPassphrase('');
      
      // Refresh profile
      const refreshResult = await getCurrentUser();
      if (refreshResult.data) {
        setUserProfile(refreshResult.data);
      }
    } catch (error) {
      setKeySetupError(error instanceof Error ? error.message : 'Failed to set up keys');
    } finally {
      setIsSettingUpKeys(false);
    }
  };

  const handleVerifyAccountPassword = async () => {
    if (!accountPassword) {
      setVerifyError('Please enter your account password');
      return;
    }
    
    setIsVerifying(true);
    setVerifyError('');
    
    try {
      const result = await verifyPassword(accountPassword);
      if (result.data?.verified) {
        setPasswordVerified(true);
        setVerifyError('');
      } else {
        setVerifyError('Incorrect account password');
      }
    } catch (error) {
      setVerifyError('Failed to verify password');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleTestPassphrase = async () => {
    if (!testPassphrase || !user?.id) {
      setVerifyError('Please enter your encryption passphrase');
      return;
    }
    
    setIsVerifying(true);
    setVerifyError('');
    setVerifySuccess('');
    setRevealedPrivateKey(null);
    setRevealedSigningKey(null);
    
    try {
      // Get the private key hex
      const result = await KeyManager.getPrivateKeyHex(String(user.id), testPassphrase);
      
      if (result.success && result.privateKeyHex) {
        setVerifySuccess('✓ Passphrase verified! You can now view your private keys.');
        setRevealedPrivateKey(result.privateKeyHex);
        setRevealedSigningKey(result.signingKeyHex || null);
        setVerifyError('');
      } else {
        setVerifyError(result.error || 'Incorrect passphrase or keys not found');
        setVerifySuccess('');
      }
    } catch (error) {
      setVerifyError('Failed to verify passphrase - it may be incorrect');
      setVerifySuccess('');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClosePassphraseVerify = () => {
    setShowPassphraseVerify(false);
    setAccountPassword('');
    setTestPassphrase('');
    setPasswordVerified(false);
    setVerifyError('');
    setVerifySuccess('');
    setRevealedPrivateKey(null);
    setRevealedSigningKey(null);
    setShowKeys(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
      if (disconnect) disconnect();
      router.push('/auth');
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

  // Use fetched profile data, fallback to auth context
  const displayRole = userProfile?.role || user?.role || 'patient';
  const displayUuid = userProfile?.uuid || user?.uuid;
  const isHospital = displayRole === 'hospital';

  const statsData = [
    { label: 'Records Uploaded', value: stats.records.toString(), icon: '📁', color: 'indigo' },
    { label: 'Access Grants', value: stats.grants.toString(), icon: '🔑', color: 'emerald' },
    { label: 'Active Shares', value: stats.shares.toString(), icon: '👥', color: 'purple' },
    { label: 'Audit Events', value: stats.audits.toString(), icon: '📋', color: 'sky' },
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
              <div className={`w-24 h-24 rounded-2xl ${isHospital ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-indigo-500 to-purple-600'} flex items-center justify-center text-white text-3xl font-bold border-4 border-white shadow-xl`}>
                {isHospital ? '🏥' : user.username?.charAt(0).toUpperCase() || '?'}
              </div>
              
              <div className="flex-1 text-center sm:text-left">
                <h1 className="text-2xl font-bold text-gray-900">{user.username || 'Anonymous User'}</h1>
                <p className="text-gray-500 capitalize flex items-center justify-center sm:justify-start gap-2">
                  <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${isHospital ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                    {isHospital ? '🏥 Hospital' : '👤 Patient'}
                  </span>
                </p>
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
          {statsData.map((stat) => (
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
              {/* UUID/ID - Prominent display for sharing */}
              {displayUuid ? (
                <div className={`border rounded-xl p-4 ${isHospital ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200' : 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200'}`}>
                  <p className={`text-sm font-medium mb-1 ${isHospital ? 'text-emerald-600' : 'text-indigo-600'}`}>
                    {isHospital ? 'Your Hospital ID' : 'Your Patient UUID (Share with Hospitals)'}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className={`text-sm font-mono break-all ${isHospital ? 'text-emerald-800' : 'text-indigo-800'}`}>{displayUuid}</code>
                    <button
                      onClick={() => copyToClipboard(displayUuid, 'uuid')}
                      className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${isHospital ? 'hover:bg-emerald-100' : 'hover:bg-indigo-100'}`}
                      title={isHospital ? "Copy Hospital ID" : "Copy UUID"}
                    >
                      {copied === 'uuid' ? (
                        <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className={`w-5 h-5 ${isHospital ? 'text-emerald-500' : 'text-indigo-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className={`text-xs mt-2 ${isHospital ? 'text-emerald-500' : 'text-indigo-500'}`}>
                    {isHospital 
                      ? 'This is your unique hospital identifier for the system'
                      : 'Share this UUID with hospitals to let them request access to your records'}
                  </p>
                </div>
              ) : isLoadingProfile ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-gray-500 text-sm">Loading UUID...</span>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-amber-600 text-sm">UUID not available. Please contact support.</p>
                </div>
              )}

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
                <span className={`badge-${isHospital ? 'success' : 'info'} capitalize`}>
                  {isHospital ? '🏥 Hospital' : '👤 Patient'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Encryption Keys Setup - For BOTH Patients and Hospitals */}
        {!userProfile?.public_key && (
          <div className="glass-card p-6 mt-6 border-l-4 border-amber-500">
            <div className="flex items-start gap-4">
              <div className="icon-box icon-box-amber flex-shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">
                  {isHospital ? '🔐 Setup Hospital Encryption Keys' : '🔐 Setup Encryption Keys'}
                </h3>
                <p className="text-gray-500 text-sm mb-4">
                  {isHospital 
                    ? 'To decrypt patient files that have been shared with you, you need to set up your hospital encryption keys. Patients will grant you access using your public key, and you\'ll decrypt files with your private key.'
                    : 'To receive encrypted health records from hospitals, you need to set up your encryption keys. Your private key will be stored securely in your browser, encrypted with a passphrase only you know.'
                  }
                </p>
                
                {!showKeySetup ? (
                  <button
                    onClick={() => setShowKeySetup(true)}
                    className="btn-neon"
                  >
                    🔐 Setup Encryption Keys
                  </button>
                ) : (
                  <div className="space-y-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Passphrase</label>
                      <input
                        type="password"
                        value={keyPassphrase}
                        onChange={(e) => setKeyPassphrase(e.target.value)}
                        placeholder="Enter a secure passphrase"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">This passphrase encrypts your private key. Keep it safe!</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Passphrase</label>
                      <input
                        type="password"
                        value={confirmPassphrase}
                        onChange={(e) => setConfirmPassphrase(e.target.value)}
                        placeholder="Confirm your passphrase"
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    {keySetupError && (
                      <p className="text-red-600 text-sm">⚠️ {keySetupError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSetupKeys}
                        disabled={isSettingUpKeys || !keyPassphrase || keyPassphrase !== confirmPassphrase}
                        className="btn-neon disabled:opacity-50"
                      >
                        {isSettingUpKeys ? 'Setting up...' : '✓ Create Keys'}
                      </button>
                      <button
                        onClick={() => {
                          setShowKeySetup(false);
                          setKeyPassphrase('');
                          setConfirmPassphrase('');
                          setKeySetupError('');
                        }}
                        className="btn-ghost"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Keys Already Setup - Show status */}
        {userProfile?.public_key && (
          <div className="glass-card p-6 mt-6 border-l-4 border-emerald-500">
            <div className="flex items-start gap-4">
              <div className="icon-box icon-box-emerald flex-shrink-0">
                <span className="text-white text-xl">🔐</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">Encryption Keys Active</h3>
                <p className="text-gray-500 text-sm mb-3">
                  {isHospital 
                    ? 'Your hospital encryption keys are set up. You can decrypt patient files that have been shared with you using your passphrase.'
                    : 'Your encryption keys are set up. Hospitals can send you encrypted records that only you can decrypt.'
                  }
                </p>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-emerald-600 font-medium mb-1">Public Key (hex)</p>
                  <code className="text-xs text-emerald-800 font-mono break-all">{userProfile.public_key}</code>
                </div>
                
                {/* Verify Passphrase Button */}
                <button
                  onClick={() => setShowPassphraseVerify(true)}
                  className="btn-ghost text-indigo-600 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Verify Passphrase
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Passphrase Verification Modal */}
        {showPassphraseVerify && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">🔐 Verify Encryption Passphrase</h3>
                  <button
                    onClick={handleClosePassphraseVerify}
                    className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  First verify your account password, then test your encryption passphrase.
                </p>
              </div>
              
              <div className="p-6 space-y-4">
                {!passwordVerified ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Account Password
                      </label>
                      <input
                        type="password"
                        value={accountPassword}
                        onChange={(e) => setAccountPassword(e.target.value)}
                        placeholder="Enter your account password"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        onKeyDown={(e) => e.key === 'Enter' && handleVerifyAccountPassword()}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        This is the password you use to log in to your account.
                      </p>
                    </div>
                    
                    {verifyError && (
                      <p className="text-red-600 text-sm bg-red-50 p-2 rounded-lg">⚠️ {verifyError}</p>
                    )}
                    
                    <button
                      onClick={handleVerifyAccountPassword}
                      disabled={isVerifying || !accountPassword}
                      className="w-full btn-neon disabled:opacity-50"
                    >
                      {isVerifying ? 'Verifying...' : '→ Verify Account Password'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
                      <p className="text-emerald-700 text-sm font-medium">✓ Account password verified</p>
                    </div>
                    
                    {!revealedPrivateKey ? (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Encryption Passphrase
                          </label>
                          <input
                            type="password"
                            value={testPassphrase}
                            onChange={(e) => setTestPassphrase(e.target.value)}
                            placeholder="Enter your encryption passphrase"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            onKeyDown={(e) => e.key === 'Enter' && handleTestPassphrase()}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            This is the passphrase you created when setting up encryption keys.
                          </p>
                        </div>
                        
                        {verifyError && (
                          <p className="text-red-600 text-sm bg-red-50 p-2 rounded-lg">⚠️ {verifyError}</p>
                        )}
                        
                        <button
                          onClick={handleTestPassphrase}
                          disabled={isVerifying || !testPassphrase}
                          className="w-full btn-neon disabled:opacity-50"
                        >
                          {isVerifying ? 'Verifying...' : '🔑 Verify & Reveal Keys'}
                        </button>
                      </>
                    ) : (
                      <>
                        {verifySuccess && (
                          <p className="text-emerald-700 text-sm bg-emerald-50 p-3 rounded-lg mb-4">{verifySuccess}</p>
                        )}
                        
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                          <p className="text-red-700 text-sm font-medium">⚠️ Security Warning</p>
                          <p className="text-red-600 text-xs mt-1">
                            Never share your private key with anyone. Anyone with this key can decrypt your files.
                          </p>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-sm font-medium text-gray-700">
                                🔐 Private Encryption Key
                              </label>
                              <button
                                onClick={() => setShowKeys(!showKeys)}
                                className="text-xs text-indigo-600 hover:text-indigo-800"
                              >
                                {showKeys ? 'Hide' : 'Show'}
                              </button>
                            </div>
                            <div className="bg-gray-100 rounded-lg p-3 font-mono text-xs break-all relative">
                              {showKeys ? revealedPrivateKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(revealedPrivateKey || '');
                                  setCopied('privateKey');
                                  setTimeout(() => setCopied(null), 2000);
                                }}
                                className="absolute top-2 right-2 p-1 hover:bg-gray-200 rounded transition-colors"
                                title="Copy to clipboard"
                              >
                                {copied === 'privateKey' ? (
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
                          
                          {revealedSigningKey && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-700">
                                  ✍️ Private Signing Key
                                </label>
                              </div>
                              <div className="bg-gray-100 rounded-lg p-3 font-mono text-xs break-all relative">
                                {showKeys ? revealedSigningKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(revealedSigningKey || '');
                                    setCopied('signingKey');
                                    setTimeout(() => setCopied(null), 2000);
                                  }}
                                  className="absolute top-2 right-2 p-1 hover:bg-gray-200 rounded transition-colors"
                                  title="Copy to clipboard"
                                >
                                  {copied === 'signingKey' ? (
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
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              
              <div className="p-4 bg-gray-50 rounded-b-2xl border-t border-gray-200">
                <button
                  onClick={handleClosePassphraseVerify}
                  className="w-full btn-ghost"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

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
