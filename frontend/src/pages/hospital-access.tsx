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
  getPatientAccessHistory,
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

// Collapsible Card Component for cleaner UI
interface CollapsibleCardProps {
  hospital: HospitalAccess | PendingHospitalRequest;
  type: 'active' | 'pending' | 'history';
  isExpanded: boolean;
  onToggle: () => void;
  onAction?: (action: string) => void;
  isLoading?: boolean;
  isConnected?: boolean;
  isCorrectNetwork?: boolean;
}

function CollapsibleCard({ 
  hospital, 
  type, 
  isExpanded, 
  onToggle, 
  onAction,
  isLoading,
  isConnected,
  isCorrectNetwork
}: CollapsibleCardProps) {
  const isPending = type === 'pending';
  const isActive = type === 'active';
  const isHistory = type === 'history';
  const h = hospital as HospitalAccess;
  const p = hospital as PendingHospitalRequest;

  const getStatusColor = (status: string, isWithdrawnByHospital?: boolean | number | null) => {
    if (isWithdrawnByHospital) return 'bg-blue-500';
    switch (status) {
      case 'active': return 'bg-emerald-500';
      case 'revoked': return 'bg-orange-500';
      case 'withdrawn': return 'bg-blue-500';
      case 'expired': return 'bg-gray-400';
      case 'denied': return 'bg-red-500';
      case 'pending': return 'bg-amber-500';
      case 'approved': return 'bg-blue-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusBgLight = (status: string, isWithdrawnByHospital?: boolean | number | null) => {
    if (isWithdrawnByHospital) return 'bg-blue-50 border-blue-200';
    switch (status) {
      case 'active': return 'bg-emerald-50 border-emerald-200';
      case 'revoked': return 'bg-orange-50 border-orange-200';
      case 'withdrawn': return 'bg-blue-50 border-blue-200';
      case 'expired': return 'bg-gray-50 border-gray-200';
      case 'denied': return 'bg-red-50 border-red-200';
      case 'pending': return 'bg-amber-50 border-amber-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const formatDateShort = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateFull = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const status = isPending ? 'pending' : h.access_status;
  const hospitalName = isPending 
    ? p.hospital_username 
    : (h.hospital_name || h.hospital_username);
  const branchInfo = !isPending && h.branch_name ? h.branch_name : null;
  const locationInfo = !isPending && h.location ? h.location : null;

  // Determine event type badge for history
  // Check if this was a hospital-initiated withdrawal
  const isWithdrawn = !isPending && h.withdrawn_by_hospital;
  // Check revoked_at field as fallback since status might not always be accurate
  const isRevoked = !isPending && !isWithdrawn && (status === 'revoked' || (h.revoked_at && status !== 'denied'));
  
  const getEventBadge = () => {
    if (!isHistory) return null;
    
    // Hospital withdrew access
    if (isWithdrawn) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
          🏥 Withdrawn by Hospital
        </span>
      );
    }
    
    // For grants: check if revoked first (revoked_at exists and not denied)
    if (isRevoked) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
          ↩ Revoked
        </span>
      );
    }
    
    // Denied requests
    if (status === 'denied') {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
          ✗ Denied
        </span>
      );
    }
    
    // Active grants
    if (status === 'active' || (h.granted_at && !h.revoked_at)) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
          ✓ Approved
        </span>
      );
    }
    
    // Pending requests
    if (status === 'pending') {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
          ⏳ Pending
        </span>
      );
    }
    
    // Expired
    if (status === 'expired') {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
          ⏱ Expired
        </span>
      );
    }
    
    return null;
  };

  return (
    <div 
      className={`border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer ${getStatusBgLight(status, h.withdrawn_by_hospital)}`}
      onClick={onToggle}
    >
      {/* Main Card - Always visible with more info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left - Hospital info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Status indicator */}
            <div className={`w-10 h-10 rounded-lg ${getStatusColor(status, h.withdrawn_by_hospital)} flex items-center justify-center flex-shrink-0 text-white font-bold`}>
              {hospitalName.charAt(0).toUpperCase()}
            </div>
            
            {/* Hospital details */}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 truncate">{hospitalName}</h3>
              
              {/* Show branch/location in collapsed view for recognition */}
              {(branchInfo || locationInfo) && (
                <p className="text-sm text-gray-500 truncate">
                  {branchInfo && <span>{branchInfo}</span>}
                  {branchInfo && locationInfo && <span> • </span>}
                  {locationInfo && <span>📍{locationInfo}</span>}
                </p>
              )}
              
              {/* Quick stats/info */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {/* Event type badge for history (Approved/Revoked/Denied) */}
                {getEventBadge()}
                
                {/* Status badge for non-history */}
                {!isHistory && (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                    status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    status === 'revoked' ? 'bg-orange-100 text-orange-700' :
                    status === 'denied' ? 'bg-red-100 text-red-700' :
                    status === 'expired' ? 'bg-gray-100 text-gray-600' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {status}
                  </span>
                )}
                
                {/* Files count for active/history */}
                {!isPending && h.file_count > 0 && (
                  <span className="text-xs text-indigo-600">📁 {h.file_count} files</span>
                )}
                
                {/* Date info */}
                {isPending && (
                  <span className="text-xs text-gray-400">Requested {formatDateShort(p.created_at)}</span>
                )}
                {isActive && h.granted_at && (
                  <span className="text-xs text-gray-400">Since {formatDateShort(h.granted_at)}</span>
                )}
                {isHistory && h.revoked_at && status === 'revoked' && (
                  <span className="text-xs text-gray-400">{formatDateShort(h.revoked_at)}</span>
                )}
                {isHistory && h.revoked_at && status === 'denied' && (
                  <span className="text-xs text-gray-400">{formatDateShort(h.revoked_at)}</span>
                )}
                {isHistory && h.granted_at && status === 'active' && (
                  <span className="text-xs text-gray-400">{formatDateShort(h.granted_at)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Right - Action buttons (always visible) + expand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Quick action buttons - visible even when collapsed */}
            {onAction && isPending && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onAction('approve'); }}
                  disabled={isLoading || !isConnected || !isCorrectNetwork}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoading ? '...' : '✓ Approve'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onAction('deny'); }}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  ✗ Deny
                </button>
              </>
            )}
            
            {onAction && isActive && (
              <button
                onClick={(e) => { e.stopPropagation(); onAction('revoke'); }}
                disabled={isLoading || !isConnected || !isCorrectNetwork}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center gap-1">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-600" />
                    ...
                  </span>
                ) : '↩ Revoke'}
              </button>
            )}
            
            {/* Expand/collapse indicator */}
            <div className="p-2">
              <svg 
                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
        
        {/* Network warning inline */}
        {onAction && (!isConnected || !isCorrectNetwork) && (isPending || isActive) && (
          <p className="text-xs text-amber-600 mt-2">
            ⚠️ Connect wallet to Sepolia to perform actions
          </p>
        )}
      </div>

      {/* Expanded Details - Smooth animation */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-gray-200 bg-white p-4" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {/* Details column */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Details</h4>
              
              {!isPending && h.hospital_name && (
                <p><span className="text-gray-400">Username:</span> @{h.hospital_username}</p>
              )}
              {branchInfo && (
                <p><span className="text-gray-400">Branch:</span> {branchInfo}</p>
              )}
              {locationInfo && (
                <p><span className="text-gray-400">Location:</span> {locationInfo}</p>
              )}
              {!isPending && h.specializations && (
                <p><span className="text-gray-400">Specializations:</span> {h.specializations}</p>
              )}
              {(isPending ? p.purpose : h.purpose) && (
                <p><span className="text-gray-400">Purpose:</span> {isPending ? p.purpose : h.purpose}</p>
              )}
            </div>

            {/* Timeline column */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Timeline</h4>
              
              {isPending && (
                <p><span className="text-gray-400">Requested:</span> {formatDateFull(p.created_at)}</p>
              )}
              {!isPending && h.requested_at && (
                <p><span className="text-gray-400">Requested:</span> {formatDateFull(h.requested_at)}</p>
              )}
              {!isPending && h.granted_at && (
                <p><span className="text-emerald-600">Granted:</span> {formatDateFull(h.granted_at)}</p>
              )}
              {!isPending && h.expires_at && (
                <p>
                  <span className={status === 'expired' ? 'text-amber-600' : 'text-gray-400'}>
                    {status === 'expired' ? 'Expired:' : 'Expires:'}
                  </span> {formatDateFull(h.expires_at)}
                </p>
              )}
              {!isPending && h.revoked_at && (
                <p>
                  <span className={status === 'denied' ? 'text-red-600' : 'text-orange-600'}>
                    {status === 'denied' ? 'Denied:' : 'Revoked:'}
                  </span> {formatDateFull(h.revoked_at)}
                </p>
              )}
            </div>
          </div>

          {/* Transaction info */}
          {!isPending && h.tx_hash && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <TxHashDisplay txHash={h.tx_hash} label="Transaction" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HospitalAccessPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();

  // State - Default to 'active' tab as most commonly used
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [hospitals, setHospitals] = useState<HospitalAccess[]>([]);
  const [historyHospitals, setHistoryHospitals] = useState<HospitalAccess[]>([]);
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
  
  // Expanded card tracking
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  
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

    const [hospitalsResult, historyResult, pendingResult] = await Promise.all([
      getPatientHospitals(user.id),
      getPatientAccessHistory(user.id),
      getPatientPendingRequests(),
    ]);

    if (hospitalsResult.data) {
      // Filter to only active hospitals
      setHospitals(hospitalsResult.data.hospitals.filter(h => h.access_status === 'active'));
    } else if (hospitalsResult.error) {
      setError(hospitalsResult.error);
    }

    if (historyResult.data) {
      setHistoryHospitals(historyResult.data.hospitals);
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
    // Used only in modals now
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '✓ Active' },
      revoked: { bg: 'bg-orange-100', text: 'text-orange-700', label: '↩ Revoked' },
      expired: { bg: 'bg-gray-100', text: 'text-gray-700', label: '⏱ Expired' },
      denied: { bg: 'bg-red-100', text: 'text-red-700', label: '✗ Denied' },
      pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: '⏳ Pending' },
      approved: { bg: 'bg-blue-100', text: 'text-blue-700', label: '✓ Approved' },
    };
    const badge = badges[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
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

  // hospitals state already contains only active hospitals
  // historyHospitals state contains revoked, expired, and denied

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

        {/* Tabs - Clean pill-style buttons */}
        <div className="mb-6">
          <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
            <button
              onClick={() => { setActiveTab('active'); setExpandedCard(null); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'active'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Active {hospitals.length > 0 && <span className="ml-1 text-xs">({hospitals.length})</span>}
            </button>
            <button
              onClick={() => { setActiveTab('pending'); setExpandedCard(null); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'pending'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Pending {pendingRequests.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500 text-white rounded-full">
                  {pendingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('history'); setExpandedCard(null); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'history'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              History {historyHospitals.length > 0 && <span className="ml-1 text-xs">({historyHospitals.length})</span>}
            </button>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="text-gray-500 ml-3">Loading...</p>
          </div>
        )}

        {/* Active Tab - Collapsible Cards */}
        {!isLoading && activeTab === 'active' && (
          <div>
            <p className="text-sm text-gray-500 mb-4">
              Hospitals currently authorized to upload records for you
            </p>
            
            {hospitals.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <span className="text-4xl">🏥</span>
                <p className="text-gray-500 mt-4">No hospitals have access yet</p>
                <p className="text-sm text-gray-400">Approve pending requests to grant access</p>
              </div>
            ) : (
              <div className="space-y-3">
                {hospitals.map((hospital) => (
                  <CollapsibleCard
                    key={`active-${hospital.hospital_id}`}
                    hospital={hospital}
                    type="active"
                    isExpanded={expandedCard === `active-${hospital.hospital_id}`}
                    onToggle={() => setExpandedCard(
                      expandedCard === `active-${hospital.hospital_id}` ? null : `active-${hospital.hospital_id}`
                    )}
                    onAction={(action) => {
                      if (action === 'revoke') handleRevoke(hospital.hospital_id);
                    }}
                    isLoading={isRevoking === hospital.hospital_id}
                    isConnected={isConnected}
                    isCorrectNetwork={isCorrectNetwork}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pending Tab - Collapsible Cards */}
        {!isLoading && activeTab === 'pending' && (
          <div>
            <p className="text-sm text-gray-500 mb-4">
              Hospitals requesting permission to upload records for you
            </p>
            
            {pendingRequests.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <span className="text-4xl">📋</span>
                <p className="text-gray-500 mt-4">No pending requests</p>
                <p className="text-sm text-gray-400">Hospitals will appear here when they request access</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((request) => (
                  <CollapsibleCard
                    key={`pending-${request.id}`}
                    hospital={request}
                    type="pending"
                    isExpanded={expandedCard === `pending-${request.id}`}
                    onToggle={() => setExpandedCard(
                      expandedCard === `pending-${request.id}` ? null : `pending-${request.id}`
                    )}
                    onAction={(action) => {
                      if (action === 'approve') setShowApproveModal(request.id);
                      if (action === 'deny') handleDeny(request.id);
                    }}
                    isLoading={isApproving === request.id || isDenying === request.id}
                    isConnected={isConnected}
                    isCorrectNetwork={isCorrectNetwork}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* History Tab - Collapsible Cards with scroll */}
        {!isLoading && activeTab === 'history' && (
          <div>
            <p className="text-sm text-gray-500 mb-4">
              Full timeline of all access requests, grants, revocations, and denials
            </p>
            
            {historyHospitals.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <span className="text-4xl">📜</span>
                <p className="text-gray-500 mt-4">No access history yet</p>
                <p className="text-sm text-gray-400">All access events will appear here</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-2">
                {historyHospitals.map((hospital, index) => (
                  <CollapsibleCard
                    key={`history-${hospital.hospital_id}-${hospital.event_type || 'grant'}-${index}`}
                    hospital={hospital}
                    type="history"
                    isExpanded={expandedCard === `history-${hospital.hospital_id}-${index}`}
                    onToggle={() => setExpandedCard(
                      expandedCard === `history-${hospital.hospital_id}-${index}` 
                        ? null 
                        : `history-${hospital.hospital_id}-${index}`
                    )}
                  />
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
