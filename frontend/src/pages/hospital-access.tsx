/**
 * Hospital Access Management Page for Patients
 * 
 * This page allows patients to:
 * - View pending access requests from hospitals
 * - Approve or deny hospital access requests (on-chain)
 * - View hospitals that have access to their records
 * - Revoke hospital access (on-chain)
 * - Monitor access activity and blockchain transactions
 * 
 * PRE Security Flow:
 * - When approving access, patient's secret key is sent to server (over HTTPS)
 * - Server generates pyumbral-compatible kfrags for re-encryption
 * - Hospital uses their OWN keys to decrypt (never patient's passphrase)
 * - Revocation = delete kfrag = hospital can no longer decrypt
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import {
  getPatientHospitals,
  revokeHospitalAccess,
  HospitalAccess,
  getPatientPendingRequests,
  approveHospitalRequest,
  denyHospitalRequest,
  getHospitalPublicKeyForRequest,
  PendingHospitalRequest,
} from '@/lib/api';
import KeyManager from '@/lib/KeyManager';

type TabType = 'pending' | 'active' | 'history';

export default function HospitalAccessPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();

  // State
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [hospitals, setHospitals] = useState<HospitalAccess[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingHospitalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState<number | null>(null);
  const [isDenying, setIsDenying] = useState<number | null>(null);
  const [isRevoking, setIsRevoking] = useState<number | null>(null);
  const [approveExpiryDays, setApproveExpiryDays] = useState<number>(0);
  const [showApproveModal, setShowApproveModal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  
  // PRE kfrag generation state
  const [showPassphraseModal, setShowPassphraseModal] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState('');
  const [isGeneratingKfrag, setIsGeneratingKfrag] = useState(false);
  const [hospitalPublicKey, setHospitalPublicKey] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth');
    }
  }, [authLoading, isAuthenticated, router]);

  // Check user is a patient
  useEffect(() => {
    if (user && user.role !== 'patient') {
      router.push('/dashboard');
    }
  }, [user, router]);

  // Load data
  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setError('');

    const [hospitalsResult, pendingResult] = await Promise.all([
      getPatientHospitals(user.id),
      getPatientPendingRequests(),
    ]);

    if (hospitalsResult.data) {
      setHospitals(hospitalsResult.data.hospitals);
    } else if (hospitalsResult.error) {
      setError(hospitalsResult.error);
    }

    if (pendingResult.data) {
      setPendingRequests(pendingResult.data.requests);
    }

    setIsLoading(false);
  };

  const handleApprove = async (requestId: number) => {
    // First, check if patient has keys set up
    if (!user?.id) return;
    
    const hasKeys = KeyManager.hasKeypair(String(user.id));
    if (!hasKeys) {
      setError('You need to set up your encryption keys first. Go to Profile to set up your keys.');
      return;
    }
    
    // Get the hospital's public key first
    setIsApproving(requestId);
    setError('');
    
    const pubkeyResult = await getHospitalPublicKeyForRequest(requestId);
    if (pubkeyResult.error) {
      setError(pubkeyResult.error);
      setIsApproving(null);
      return;
    }
    
    if (!pubkeyResult.data?.hospital_public_key) {
      setError('Hospital has not set up their encryption keys yet. They need to set up keys in their Profile first.');
      setIsApproving(null);
      return;
    }
    
    // Store hospital public key and show passphrase modal
    setHospitalPublicKey(pubkeyResult.data.hospital_public_key);
    setShowPassphraseModal(requestId);
    setIsApproving(null);
  };
  
  const handleApproveWithPassphrase = async () => {
    if (!showPassphraseModal || !passphrase || !hospitalPublicKey || !user?.id) return;
    
    const requestId = showPassphraseModal;
    setIsGeneratingKfrag(true);
    setPassphraseError('');
    
    try {
      // Load patient's private key using passphrase
      const keyPair = await KeyManager.loadPrivateKey(String(user.id), passphrase);
      if (!keyPair) {
        setPassphraseError('Incorrect passphrase. Please try again.');
        setIsGeneratingKfrag(false);
        return;
      }
      
      // Convert secret key bytes to hex for server-side kfrag generation
      // Server will generate pyumbral-compatible kfrags
      const secretKeyHex = Array.from(keyPair.secretKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Also send signing key if available
      const signingKeyHex = keyPair.signingKeyBytes 
        ? Array.from(keyPair.signingKeyBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        : undefined;
      
      // Zero out sensitive key material in memory
      keyPair.secretKeyBytes.fill(0);
      if (keyPair.signingKeyBytes) {
        keyPair.signingKeyBytes.fill(0);
      }
      
      // Calculate expiry
      const expirySeconds = approveExpiryDays > 0 ? approveExpiryDays * 24 * 60 * 60 : undefined;
      
      // Send approval with secret key for server-side kfrag generation
      // Server uses pyumbral which is compatible with backend re-encryption
      const result = await approveHospitalRequest(
        requestId, 
        expirySeconds,
        undefined,  // No client-side kfrag
        undefined,  // No client-side verifying key
        secretKeyHex,  // Secret key for server-side generation
        signingKeyHex  // Signing key (optional)
      );
      
      if (result.error) {
        setError(result.error);
        setIsGeneratingKfrag(false);
        return;
      }
      
      if (result.data) {
        setSuccess(`Access granted to ${result.data.hospital_username}. Encryption keys configured for secure access.`);
        setLastTxHash(result.data.tx_hash);
        setShowPassphraseModal(null);
        setShowApproveModal(null);
        setApproveExpiryDays(0);
        setPassphrase('');
        setHospitalPublicKey(null);
        await loadData();
      }
      
    } catch (err) {
      setPassphraseError(err instanceof Error ? err.message : 'Failed to generate encryption key');
    } finally {
      setIsGeneratingKfrag(false);
    }
  };

  const handleDeny = async (requestId: number) => {
    const confirmed = window.confirm(
      'Are you sure you want to deny this hospital\'s access request?'
    );
    if (!confirmed) return;

    setIsDenying(requestId);
    setError('');
    setSuccess('');

    const result = await denyHospitalRequest(requestId);

    if (result.error) {
      setError(result.error);
      setIsDenying(null);
      return;
    }

    if (result.data) {
      setSuccess('Access request denied.');
      await loadData();
    }

    setIsDenying(null);
  };

  const handleRevoke = async (hospitalId: number) => {
    if (!user?.id) return;

    const confirmed = window.confirm(
      'Are you sure you want to revoke this hospital\'s access? This will be recorded on the blockchain.'
    );
    if (!confirmed) return;

    setIsRevoking(hospitalId);
    setError('');
    setSuccess('');

    const result = await revokeHospitalAccess(user.id, hospitalId);

    if (result.error) {
      setError(result.error);
      setIsRevoking(null);
      return;
    }

    if (result.data) {
      setSuccess('Access revoked. Transaction recorded on blockchain.');
      setLastTxHash(result.data.tx_hash);
      await loadData();
    }

    setIsRevoking(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
            ✓ Active
          </span>
        );
      case 'revoked':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
            ✗ Revoked
          </span>
        );
      case 'expired':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
            ⏱ Expired
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading || !user) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      </Layout>
    );
  }

  const activeHospitals = hospitals.filter(h => h.access_status === 'active');
  const historyHospitals = hospitals.filter(h => h.access_status !== 'active');

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Hospital Access Control</h1>
          <p className="text-gray-600">
            Manage which hospitals can upload medical records for you. All grants and revocations
            are recorded on the blockchain for transparency and security.
          </p>
        </div>

        {/* Network Check */}
        <NetworkCheck />

        {/* Success/Error Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-emerald-700">{success}</p>
            {lastTxHash && (
              <div className="mt-2">
                <TxHashDisplay txHash={lastTxHash} label="Transaction" />
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('pending')}
              className={`pb-3 px-1 font-medium text-sm relative ${
                activeTab === 'pending'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Pending Requests
              {pendingRequests.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                  {pendingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('active')}
              className={`pb-3 px-1 font-medium text-sm relative ${
                activeTab === 'active'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Active Access
              {activeHospitals.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                  {activeHospitals.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`pb-3 px-1 font-medium text-sm ${
                activeTab === 'history'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              History
            </button>
          </nav>
        </div>

        {/* Pending Requests Tab */}
        {activeTab === 'pending' && (
          <div className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900">Pending Access Requests</h2>
              <p className="text-sm text-gray-500">
                Hospitals requesting permission to upload records for you
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-gray-500">No pending access requests.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Hospitals will appear here when they request access to your records.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {pendingRequests.map((request) => (
                  <div key={request.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                          <span className="text-xl">🏥</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{request.hospital_username}</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            <strong>Purpose:</strong> {request.purpose}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            Requested: {formatDate(request.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowApproveModal(request.id)}
                          disabled={isApproving === request.id || !isConnected || !isCorrectNetwork}
                          className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isApproving === request.id ? (
                            <span className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Approving...
                            </span>
                          ) : (
                            '✓ Approve'
                          )}
                        </button>
                        <button
                          onClick={() => handleDeny(request.id)}
                          disabled={isDenying === request.id}
                          className="px-4 py-2 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isDenying === request.id ? (
                            <span className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                              Denying...
                            </span>
                          ) : (
                            '✗ Deny'
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(!isConnected || !isCorrectNetwork) && pendingRequests.length > 0 && (
              <div className="p-4 bg-amber-50 border-t border-amber-100">
                <p className="text-sm text-amber-600">
                  ⚠️ Connect wallet to Sepolia network to approve requests
                </p>
              </div>
            )}
          </div>
        )}

        {/* Active Access Tab */}
        {activeTab === 'active' && (
          <div className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900">Active Hospital Access</h2>
              <p className="text-sm text-gray-500">
                Hospitals currently authorized to upload records for you
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : activeHospitals.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🏥</span>
                </div>
                <p className="text-gray-500">No hospitals have access to your records yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Approve pending requests to grant hospitals access.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {activeHospitals.map((hospital) => (
                  <div key={hospital.hospital_id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                          <span className="text-xl">🏥</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{hospital.hospital_username}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            {getStatusBadge(hospital.access_status)}
                            {hospital.on_chain_verified && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                ⛓ On-chain
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p className="text-gray-500">Granted: {formatDate(hospital.granted_at)}</p>
                          {hospital.expires_at && (
                            <p className="text-amber-600">Expires: {formatDate(hospital.expires_at)}</p>
                          )}
                          <p className="text-gray-400">{hospital.file_count} files uploaded</p>
                        </div>
                        <button
                          onClick={() => handleRevoke(hospital.hospital_id)}
                          disabled={isRevoking === hospital.hospital_id || !isConnected || !isCorrectNetwork}
                          className="px-4 py-2 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isRevoking === hospital.hospital_id ? (
                            <span className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                              Revoking...
                            </span>
                          ) : (
                            'Revoke Access'
                          )}
                        </button>
                      </div>
                    </div>
                    {hospital.tx_hash && (
                      <div className="mt-2 ml-16">
                        <TxHashDisplay txHash={hospital.tx_hash} label="Grant TX" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900">Access History</h2>
              <p className="text-sm text-gray-500">
                Previous grants that have been revoked or expired
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : historyHospitals.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📜</span>
                </div>
                <p className="text-gray-500">No access history yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {historyHospitals.map((hospital) => (
                  <div key={hospital.hospital_id} className="p-4 opacity-60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                          <span className="text-lg">🏥</span>
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-700">{hospital.hospital_username}</h3>
                          {getStatusBadge(hospital.access_status)}
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <p>Granted: {formatDate(hospital.granted_at)}</p>
                        {hospital.tx_hash && (
                          <TxHashDisplay txHash={hospital.tx_hash} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Approve Modal */}
        {showApproveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">Approve Access Request</h2>
                <p className="text-sm text-gray-500 mt-1">
                  This will be recorded on the blockchain
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* Expiry Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Access Duration (optional)
                  </label>
                  <select
                    value={approveExpiryDays}
                    onChange={(e) => setApproveExpiryDays(Number(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value={0}>No expiry (permanent until revoked)</option>
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h4 className="font-medium text-blue-900 flex items-center gap-2">
                    <span>ℹ️</span> What does this mean?
                  </h4>
                  <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• Hospital can upload medical records on your behalf</li>
                    <li>• You remain the owner of all uploaded files</li>
                    <li>• You can revoke access at any time</li>
                    <li>• Grant is recorded on Sepolia blockchain</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => {
                    setShowApproveModal(null);
                    setApproveExpiryDays(0);
                  }}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleApprove(showApproveModal)}
                  disabled={isApproving === showApproveModal}
                  className="flex-1 btn-primary disabled:opacity-50"
                >
                  {isApproving === showApproveModal ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Checking keys...
                    </span>
                  ) : (
                    'Continue to Approve'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Passphrase Modal for kfrag generation */}
        {showPassphraseModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-xl">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">🔐 Confirm with Passphrase</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Enter your encryption passphrase to authorize access
                </p>
              </div>

              <div className="p-6 space-y-4">
                {passphraseError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                    {passphraseError}
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Your Encryption Passphrase
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter your passphrase"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && passphrase) {
                        handleApproveWithPassphrase();
                      }
                    }}
                  />
                </div>

                {/* Security Info Box */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <h4 className="font-medium text-emerald-900 flex items-center gap-2">
                    <span>🔒</span> Secure Access Grant
                  </h4>
                  <ul className="text-sm text-emerald-700 mt-2 space-y-1">
                    <li>• Your passphrase never leaves your browser</li>
                    <li>• Hospital will use their own keys to decrypt</li>
                    <li>• You can revoke access at any time to stop decryption</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => {
                    setShowPassphraseModal(null);
                    setPassphrase('');
                    setPassphraseError('');
                    setHospitalPublicKey(null);
                  }}
                  disabled={isGeneratingKfrag}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApproveWithPassphrase}
                  disabled={isGeneratingKfrag || !passphrase}
                  className="flex-1 btn-primary disabled:opacity-50"
                >
                  {isGeneratingKfrag ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Authorizing...
                    </span>
                  ) : (
                    'Authorize Access'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
