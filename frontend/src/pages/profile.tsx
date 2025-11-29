/**
 * Profile Page
 * 
 * Shows user profile information and encrypted key management.
 * Private key is protected and only shown after password confirmation.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import {
  loadKeys,
  hasStoredKeys,
  exportKeysForBackup,
  clearStoredKeys,
} from '@/lib/umbral';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  
  // Key management state
  const [hasKeys, setHasKeys] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');
  const [secretKeyHex, setSecretKeyHex] = useState<string>('');
  const [signingKeyHex, setSigningKeyHex] = useState<string>('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [keyBackup, setKeyBackup] = useState('');
  
  // The password to reveal private keys (simple protection)
  const REVEAL_PASSWORD = 'show-my-keys';

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (hasStoredKeys()) {
      setHasKeys(true);
      const keys = loadKeys();
      if (keys.publicKeyHex) {
        setPublicKey(keys.publicKeyHex);
      }
      if (keys.secretKeyBytes) {
        setSecretKeyHex(Array.from(keys.secretKeyBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      }
      if (keys.signingKeyBytes) {
        setSigningKeyHex(Array.from(keys.signingKeyBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      }
    }
  }, []);

  const handleRevealPrivateKey = () => {
    if (confirmPassword === REVEAL_PASSWORD) {
      setShowPrivateKey(true);
      setPasswordError('');
    } else {
      setPasswordError('Incorrect password. Type "show-my-keys" to reveal.');
    }
  };

  const handleHidePrivateKey = () => {
    setShowPrivateKey(false);
    setConfirmPassword('');
  };

  const handleExportBackup = () => {
    const backup = exportKeysForBackup();
    if (backup) {
      setKeyBackup(backup);
    }
  };

  const handleClearKeys = () => {
    if (confirm('Are you sure you want to clear your encryption keys? You will not be able to decrypt any files encrypted with these keys unless you have a backup!')) {
      clearStoredKeys();
      setHasKeys(false);
      setPublicKey('');
      setSecretKeyHex('');
      setSigningKeyHex('');
      setShowPrivateKey(false);
      router.push('/access-requests');
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
          <p className="mt-1 text-gray-600">
            Manage your account and encryption keys
          </p>
        </div>

        {/* User Info Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h2>
          
          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-500">Username</label>
              <p className="font-medium text-gray-900">{user?.username}</p>
            </div>
            
            <div>
              <label className="text-sm text-gray-500">Email</label>
              <p className="font-medium text-gray-900">{user?.email || 'Not set'}</p>
            </div>
            
            <div>
              <label className="text-sm text-gray-500">User ID</label>
              <p className="font-medium text-gray-900">{user?.id}</p>
            </div>
            
            <div>
              <label className="text-sm text-gray-500">Role</label>
              <p className="font-medium text-gray-900 capitalize">{(user as any)?.role || 'User'}</p>
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t">
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Encryption Keys Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">🔐 Encryption Keys</h2>
          
          {!hasKeys ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800">
                You don't have encryption keys yet. Go to{' '}
                <a href="/access-requests" className="underline font-medium">Access Management</a>{' '}
                to generate keys.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Public Key (always visible) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Public Key (safe to share)
                </label>
                <div className="flex gap-2">
                  <code className="flex-1 p-3 bg-gray-100 rounded text-xs break-all font-mono">
                    {publicKey}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(publicKey);
                      alert('Public key copied!');
                    }}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Private Key (protected) */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    🔒 Private Keys (KEEP SECRET!)
                  </label>
                  {showPrivateKey && (
                    <button
                      onClick={handleHidePrivateKey}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Hide Keys
                    </button>
                  )}
                </div>
                
                {!showPrivateKey ? (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-800 text-sm mb-3">
                      ⚠️ Your private keys are hidden for security. Only reveal them if you need to:
                    </p>
                    <ul className="text-red-700 text-sm mb-4 list-disc list-inside">
                      <li>Decrypt files on another device</li>
                      <li>Create a manual backup</li>
                      <li>Recover access after browser data loss</li>
                    </ul>
                    
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Type 'show-my-keys' to reveal"
                        className="flex-1 px-3 py-2 border rounded text-sm"
                      />
                      <button
                        onClick={handleRevealPrivateKey}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                      >
                        Reveal
                      </button>
                    </div>
                    {passwordError && (
                      <p className="text-red-600 text-sm mt-2">{passwordError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-red-100 border border-red-300 rounded-lg">
                      <p className="text-red-800 font-medium mb-2">⚠️ SECRET - DO NOT SHARE!</p>
                      
                      <div className="mb-3">
                        <label className="text-sm text-red-700">Secret Key (for decryption):</label>
                        <code className="block p-2 bg-white rounded text-xs break-all font-mono mt-1">
                          {secretKeyHex}
                        </code>
                      </div>
                      
                      <div>
                        <label className="text-sm text-red-700">Signing Key (for kfrag generation):</label>
                        <code className="block p-2 bg-white rounded text-xs break-all font-mono mt-1">
                          {signingKeyHex}
                        </code>
                      </div>
                      
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`Secret Key: ${secretKeyHex}\nSigning Key: ${signingKeyHex}`);
                          alert('Keys copied to clipboard! Store safely and clear clipboard soon.');
                        }}
                        className="mt-3 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Copy Both Keys
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Backup Export */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Key Backup</h3>
                <button
                  onClick={handleExportBackup}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
                >
                  Export Encrypted Backup
                </button>
                
                {keyBackup && (
                  <div className="mt-3">
                    <textarea
                      readOnly
                      value={keyBackup}
                      className="w-full p-2 border rounded text-xs font-mono"
                      rows={3}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(keyBackup);
                        alert('Backup copied! Store in a safe place.');
                      }}
                      className="mt-1 text-sm text-blue-600 hover:underline"
                    >
                      Copy Backup String
                    </button>
                  </div>
                )}
              </div>

              {/* Danger Zone */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-red-700 mb-2">⚠️ Danger Zone</h3>
                <button
                  onClick={handleClearKeys}
                  className="px-4 py-2 bg-red-100 text-red-700 border border-red-300 rounded-lg hover:bg-red-200 text-sm"
                >
                  Clear All Keys
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  This will delete your keys from this browser. Make sure you have a backup!
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
