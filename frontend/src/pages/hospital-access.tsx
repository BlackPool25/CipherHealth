/**
 * Access Management Page for Patients
 * 
 * This page allows patients to:
 * - View pending access requests from hospitals
 * - Approve or deny hospital access requests (on-chain)
 * - View hospitals that have access to their records
 * - Revoke hospital access (on-chain)
 * - Share files with other patients (patient-to-patient sharing)
 * - View files shared with them by other patients
 * - Monitor access activity and blockchain transactions
 * 
 * PRE Security Flow:
 * - When approving access, patient's secret key is sent to server (over HTTPS)
 * - Server generates pyumbral-compatible kfrags for re-encryption
 * - Hospital/Patient uses their OWN keys to decrypt (never patient's passphrase)
 * - Revocation = delete kfrag = they can no longer decrypt
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import TxHashDisplay from '@/components/TxHashDisplay';
import CidDisplay from '@/components/CidDisplay';
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
  // Patient-to-Patient sharing
  getMySharedFiles,
  getFilesSharedWithMe,
  shareFilesWithPatient,
  revokePatientShare,
  getPatientPublicKey,
  decryptSharedFile,
  PatientGrantEntry,
  PatientAccessEntry,
  getPatientRecords,
  getCurrentUser,
  updatePublicKey,
} from '@/lib/api';
import KeyManager from '@/lib/KeyManager';
import {
  initUmbral,
  generateKeyPair,
  generateSigningKeyPair,
  loadKeys,
  storeKeys,
  hasStoredKeys,
  exportKeysForBackup,
  importKeysFromBackup,
} from '@/lib/umbral';

type TabType = 'pending' | 'active' | 'history' | 'patient-sharing' | 'patient-history' | 'shared-with-me' | 'records' | 'keys';

// Section type for sidebar navigation
type SectionType = 'hospital' | 'patient' | 'records' | 'keys';

// File record for records tab
interface PatientFileRecord {
  id: number;
  cid: string;
  filename: string;
  capsule?: string;
  encrypted_cek?: string;
  tx_hash?: string;
  created_at: string;
  category?: string;
  display_name?: string;
}
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
  const [activeSection, setActiveSection] = useState<SectionType>('hospital');
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
  const [success, setSuccess] = useState('');  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  
  // Expanded card tracking
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  
  // PRE kfrag generation state
  const [showPassphraseModal, setShowPassphraseModal] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState('');
  const [isGeneratingKfrag, setIsGeneratingKfrag] = useState(false);
  const [hospitalPublicKey, setHospitalPublicKey] = useState<string | null>(null);

  // Patient-to-Patient Sharing State
  const [mySharedFiles, setMySharedFiles] = useState<PatientGrantEntry[]>([]);
  const [filesSharedWithMe, setFilesSharedWithMe] = useState<PatientAccessEntry[]>([]);
  const [myFiles, setMyFiles] = useState<Array<{id: number; filename: string; cid: string; category?: string; display_name?: string}>>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePatientUuid, setSharePatientUuid] = useState('');
  const [shareSelectedFiles, setShareSelectedFiles] = useState<number[]>([]);
  const [shareExpiryDays, setShareExpiryDays] = useState<number>(0);
  const [sharePurpose, setSharePurpose] = useState('');
  const [sharePassphrase, setSharePassphrase] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [isRevokingShare, setIsRevokingShare] = useState<number | null>(null);
  const [patientToShare, setPatientToShare] = useState<{uuid: string; name: string | null; hasKey: boolean} | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // View Shared File State
  const [showViewSharedModal, setShowViewSharedModal] = useState(false);
  const [viewingSharedFile, setViewingSharedFile] = useState<PatientAccessEntry | null>(null);
  const [viewPassphrase, setViewPassphrase] = useState('');
  const [viewError, setViewError] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedContent, setDecryptedContent] = useState<{data: string; mimeType: string; filename: string} | null>(null);

  // Records Tab State
  const [patientRecords, setPatientRecords] = useState<PatientFileRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  const [expandedShareId, setExpandedShareId] = useState<number | null>(null);

  // Keys Tab State (Umbral)
  const [umbralReady, setUmbralReady] = useState(false);
  const [hasUmbralKeys, setHasUmbralKeys] = useState(false);
  const [myPublicKey, setMyPublicKey] = useState<string>('');
  const [keyBackup, setKeyBackup] = useState<string>('');
  const [importKeyInput, setImportKeyInput] = useState('');
  const [keyMessage, setKeyMessage] = useState('');

  // Handle query parameters for deep linking
  useEffect(() => {
    if (router.isReady) {
      const { section } = router.query;
      if (section === 'patient') {
        setActiveSection('patient');
        setActiveTab('patient-sharing');
      } else if (section === 'records') {
        setActiveSection('records');
        setActiveTab('records');
      } else if (section === 'keys') {
        setActiveSection('keys');
        setActiveTab('keys');
      }
    }
  }, [router.isReady, router.query]);

  // Initialize Umbral WASM
  useEffect(() => {
    initUmbral().then(() => {
      setUmbralReady(true);
      if (hasStoredKeys()) {
        setHasUmbralKeys(true);
        const keys = loadKeys();
        if (keys.publicKeyHex) {
          setMyPublicKey(keys.publicKeyHex);
        }
      }
    }).catch(err => {
      console.error('Failed to init Umbral:', err);
    });
  }, []);

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

    const [hospitalsResult, historyResult, pendingResult, sharedFilesResult, filesWithMeResult, myFilesResult] = await Promise.all([
      getPatientHospitals(user.id),
      getPatientAccessHistory(user.id),
      getPatientPendingRequests(),
      getMySharedFiles(),
      getFilesSharedWithMe(),
      getPatientRecords(user.id),
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

    // Patient-to-patient sharing data
    if (sharedFilesResult.data) {
      setMySharedFiles(sharedFilesResult.data.grants);
    }

    if (filesWithMeResult.data) {
      setFilesSharedWithMe(filesWithMeResult.data.shared_files);
    }

    if (myFilesResult.data) {
      setMyFiles(myFilesResult.data.records.map(r => ({
        id: r.id,
        filename: r.filename,
        cid: r.cid,
        category: r.category,
        display_name: r.display_name,
      })));
      // Also set patient records for the Records tab (with full data)
      setPatientRecords(myFilesResult.data.records.map(r => ({
        id: r.id,
        cid: r.cid,
        filename: r.filename,
        capsule: r.capsule,
        encrypted_cek: r.encrypted_cek,
        tx_hash: r.tx_hash,
        created_at: r.created_at,
        category: r.category,
        display_name: r.display_name,
      })));
    }

    setIsLoading(false);
  };

  // Filter for active and history patient shares
  const activePatientShares = useMemo(() => 
    mySharedFiles.filter(s => s.status === 'active'), 
    [mySharedFiles]
  );
  
  const historyPatientShares = useMemo(() => 
    mySharedFiles.filter(s => s.status !== 'active'), 
    [mySharedFiles]
  );

  // Group files by category for folder-like display
  const filesByCategory = useMemo(() => {
    const grouped: Record<string, typeof myFiles> = {};
    
    myFiles.forEach(file => {
      // Get category from db or extract from filename like "[Lab Results] blood_test.pdf"
      let category = file.category || 'General';
      if (!file.category) {
        const match = file.filename.match(/^\[([^\]]+)\]\s*(.+)$/);
        if (match) category = match[1];
      }
      
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(file);
    });
    
    return grouped;
  }, [myFiles]);

  // Category icons for visual organization
  const categoryIcons: Record<string, string> = {
    'General': '📁',
    'Lab Results': '🧪',
    'Imaging': '🩻',
    'Prescriptions': '💊',
    'Referrals': '📋',
    'Reports': '📊',
    'Other': '📎',
  };

  // Get display name for file (use display_name if set, else clean filename)
  const getFileDisplayName = (file: typeof myFiles[0]) => {
    if (file.display_name) return file.display_name;
    const match = file.filename.match(/^\[([^\]]+)\]\s*(.+)$/);
    return match ? match[2] : file.filename;
  };

  // Toggle category expansion in share modal
  const toggleCategoryExpansion = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Select/deselect all files in a category
  const toggleCategorySelection = (category: string, files: typeof myFiles) => {
    const fileIds = files.map(f => f.id);
    const allSelected = fileIds.every(id => shareSelectedFiles.includes(id));
    
    if (allSelected) {
      setShareSelectedFiles(prev => prev.filter(id => !fileIds.includes(id)));
    } else {
      setShareSelectedFiles(prev => [...new Set([...prev, ...fileIds])]);
    }
  };

  // Patient sharing functions
  const handleLookupPatient = async () => {
    if (!sharePatientUuid.trim()) {
      setShareError('Please enter a patient UUID');
      return;
    }

    setShareError('');
    const result = await getPatientPublicKey(sharePatientUuid.trim());
    
    if (result.error) {
      setShareError(result.error);
      setPatientToShare(null);
      return;
    }

    if (result.data) {
      setPatientToShare({
        uuid: result.data.patient_uuid,
        name: result.data.patient_name,
        hasKey: result.data.has_public_key,
      });
      if (!result.data.has_public_key) {
        setShareError('This patient has not set up their encryption keys yet. They need to set up keys in their Profile first.');
      }
    }
  };

  const handleShareFiles = async () => {
    if (!user?.id || !patientToShare) return;
    if (!patientToShare.hasKey) {
      setShareError('Cannot share with a patient who has no encryption keys set up.');
      return;
    }
    if (shareSelectedFiles.length === 0) {
      setShareError('Please select at least one file to share.');
      return;
    }
    if (!sharePassphrase) {
      setShareError('Please enter your encryption passphrase.');
      return;
    }

    setIsSharing(true);
    setShareError('');

    try {
      // Load patient's private key using passphrase
      const keyPair = await KeyManager.loadPrivateKey(String(user.id), sharePassphrase);
      if (!keyPair) {
        setShareError('Incorrect passphrase. Please try again.');
        setIsSharing(false);
        return;
      }

      // Convert secret key bytes to hex
      const secretKeyHex = Array.from(keyPair.secretKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      const signingKeyHex = keyPair.signingKeyBytes 
        ? Array.from(keyPair.signingKeyBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        : undefined;
      
      // Zero out sensitive key material
      keyPair.secretKeyBytes.fill(0);
      if (keyPair.signingKeyBytes) {
        keyPair.signingKeyBytes.fill(0);
      }

      const expirySeconds = shareExpiryDays > 0 ? shareExpiryDays * 24 * 60 * 60 : undefined;

      const result = await shareFilesWithPatient(
        {
          grantee_uuid: patientToShare.uuid,
          file_ids: shareSelectedFiles,
          expires_seconds: expirySeconds,
          purpose: sharePurpose || undefined,
        },
        secretKeyHex,
        signingKeyHex
      );

      if (result.error) {
        setShareError(result.error);
        setIsSharing(false);
        return;
      }

      if (result.data) {
        setSuccess(`Successfully shared ${result.data.file_count} file(s) with ${result.data.grantee_name || 'patient'}.` +
          (result.data.tx_hash ? ' Transaction recorded on blockchain.' : ''));
        setLastTxHash(result.data.tx_hash);
        
        // Reset modal
        setShowShareModal(false);
        setSharePatientUuid('');
        setShareSelectedFiles([]);
        setShareExpiryDays(0);
        setSharePurpose('');
        setSharePassphrase('');
        setPatientToShare(null);
        
        // Reload data
        await loadData();
      }
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to share files');
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevokePatientShare = async (grantId: number) => {
    const confirmed = window.confirm(
      'Are you sure you want to revoke this share? The patient will no longer be able to access this file.'
    );
    if (!confirmed) return;

    setIsRevokingShare(grantId);
    setError('');

    const result = await revokePatientShare(grantId);

    if (result.error) {
      setError(result.error);
      setIsRevokingShare(null);
      return;
    }

    if (result.data) {
      setSuccess('File share revoked.' + (result.data.tx_hash ? ' Transaction recorded on blockchain.' : ''));
      setLastTxHash(result.data.tx_hash);
      await loadData();
      // Switch to history tab to show the revoked share
      setActiveTab('patient-history');
    }

    setIsRevokingShare(null);
  };

  // Handle viewing and decrypting shared files
  const handleDecryptSharedFile = async () => {
    if (!viewingSharedFile || !viewPassphrase || !user?.id) return;

    setIsDecrypting(true);
    setViewError('');

    try {
      // Load recipient's private key using passphrase
      const keyPair = await KeyManager.loadPrivateKey(String(user.id), viewPassphrase);
      if (!keyPair) {
        setViewError('Incorrect passphrase. Please try again.');
        setIsDecrypting(false);
        return;
      }

      // Convert secret key to hex for server-side decryption
      const secretKeyHex = Array.from(keyPair.secretKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Zero out key bytes after copying
      keyPair.secretKeyBytes.fill(0);
      if (keyPair.signingKeyBytes) {
        keyPair.signingKeyBytes.fill(0);
      }

      // Call the decrypt endpoint using proper API function
      const result = await decryptSharedFile(viewingSharedFile.file_id, secretKeyHex);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.data) {
        // Set decrypted content
        setDecryptedContent({
          data: result.data.content_base64,
          mimeType: result.data.content_type || 'application/octet-stream',
          filename: result.data.filename || viewingSharedFile.filename || 'decrypted_file',
        });
        
        // Mark as viewed - remove from "new" notifications
        markSharedFileAsViewed(viewingSharedFile.grant_id);
      }
    } catch (err) {
      setViewError(err instanceof Error ? err.message : 'Failed to decrypt file');
    } finally {
      setIsDecrypting(false);
    }
  };

  // Mark shared file as viewed (dismisses notification)
  const markSharedFileAsViewed = (grantId: number) => {
    const viewedKey = 'viewed_shared_files';
    const viewed = JSON.parse(localStorage.getItem(viewedKey) || '[]');
    if (!viewed.includes(grantId)) {
      viewed.push(grantId);
      localStorage.setItem(viewedKey, JSON.stringify(viewed));
    }
  };

  // Check if a shared file has been viewed
  const isSharedFileViewed = (grantId: number): boolean => {
    const viewed = JSON.parse(localStorage.getItem('viewed_shared_files') || '[]');
    return viewed.includes(grantId);
  };

  // Count of unviewed shared files (for notification badge)
  const unviewedSharedFilesCount = useMemo(() => {
    const viewed = JSON.parse(localStorage.getItem('viewed_shared_files') || '[]');
    return filesSharedWithMe.filter(f => f.status === 'active' && !viewed.includes(f.grant_id)).length;
  }, [filesSharedWithMe]);

  const handleCloseViewModal = () => {
    setShowViewSharedModal(false);
    setViewingSharedFile(null);
    setViewPassphrase('');
    setViewError('');
    setDecryptedContent(null);
  };

  // Key management functions
  const handleGenerateKeys = async () => {
    try {
      const keyPair = await generateKeyPair();
      const signingPair = await generateSigningKeyPair();
      storeKeys(keyPair.secretKeyBytes, signingPair.signingKeyBytes, keyPair.publicKeyHex);
      setHasUmbralKeys(true);
      setMyPublicKey(keyPair.publicKeyHex);
      setKeyMessage('Keys generated successfully! Store your backup safely.');
      
      const backup = exportKeysForBackup();
      if (backup) {
        setKeyBackup(backup);
      }
    } catch (err) {
      setKeyMessage('Failed to generate keys: ' + (err as Error).message);
    }
  };
  
  const handleExportKeys = () => {
    const backup = exportKeysForBackup();
    if (backup) {
      setKeyBackup(backup);
      setKeyMessage('Keys exported. Copy and store the backup string safely!');
    } else {
      setKeyMessage('No keys to export');
    }
  };
  
  const handleImportKeys = () => {
    if (!importKeyInput.trim()) {
      setKeyMessage('Please paste your key backup');
      return;
    }
    
    const success = importKeysFromBackup(importKeyInput.trim());
    if (success) {
      setHasUmbralKeys(true);
      const keys = loadKeys();
      if (keys.publicKeyHex) {
        setMyPublicKey(keys.publicKeyHex);
      }
      setKeyMessage('Keys imported successfully!');
      setImportKeyInput('');
    } else {
      setKeyMessage('Failed to import keys. Check your backup string.');
    }
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
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold gradient-text mb-2">Access Management</h1>
          <p className="text-gray-600">
            Manage access to your medical records securely using blockchain-verified encryption.
          </p>
        </div>

        {/* Section Toggle - Modern Pill Switch */}
        <div className="mb-6">
          <div className="inline-flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => {
                setActiveSection('hospital');
                if (!['active', 'pending', 'history'].includes(activeTab)) {
                  setActiveTab('active');
                }
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                activeSection === 'hospital'
                  ? 'bg-white text-indigo-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="text-lg">🏥</span>
              <span>Hospital</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-500 text-white rounded-full">
                  {pendingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveSection('patient');
                if (!['patient-sharing', 'patient-history', 'shared-with-me'].includes(activeTab)) {
                  setActiveTab('patient-sharing');
                }
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                activeSection === 'patient'
                  ? 'bg-white text-purple-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="text-lg">👥</span>
              <span>Patient Sharing</span>
              {unviewedSharedFilesCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-purple-500 text-white rounded-full animate-pulse">
                  {unviewedSharedFilesCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveSection('records');
                setActiveTab('records');
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                activeSection === 'records'
                  ? 'bg-white text-emerald-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="text-lg">📁</span>
              <span>Records</span>
              {patientRecords.length > 0 && (
                <span className="text-xs text-gray-400">({patientRecords.length})</span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveSection('keys');
                setActiveTab('keys');
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                activeSection === 'keys'
                  ? 'bg-white text-cyan-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="text-lg">🔑</span>
              <span>Keys</span>
            </button>
          </div>
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

        {/* Hospital Access Section */}
        {activeSection === 'hospital' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => { setActiveTab('pending'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'pending'
                    ? 'text-amber-600 bg-amber-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  ⏳ Pending Requests
                  {pendingRequests.length > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded-full">
                      {pendingRequests.length}
                    </span>
                  )}
                </span>
                {activeTab === 'pending' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"></div>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('active'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'active'
                    ? 'text-emerald-600 bg-emerald-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  ✓ Active Access
                  {hospitals.length > 0 && (
                    <span className="text-xs text-gray-400">({hospitals.length})</span>
                  )}
                </span>
                {activeTab === 'active' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('history'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'history'
                    ? 'text-gray-700 bg-gray-100'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  📜 History
                </span>
                {activeTab === 'history' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-500"></div>
                )}
              </button>
            </div>

            {/* Content */}
            <div className="p-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : activeTab === 'pending' ? (
                pendingRequests.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="text-4xl">📋</span>
                    <p className="text-gray-500 mt-3">No pending requests</p>
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
                )
              ) : activeTab === 'active' ? (
                hospitals.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="text-4xl">🏥</span>
                    <p className="text-gray-500 mt-3">No active hospital access</p>
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
                )
              ) : activeTab === 'history' ? (
                historyHospitals.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="text-4xl">📜</span>
                    <p className="text-gray-500 mt-3">No access history</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                    {historyHospitals.map((hospital, index) => (
                      <CollapsibleCard
                        key={`history-${hospital.hospital_id}-${index}`}
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
                )
              ) : null}
            </div>
          </div>
        )}

        {/* Patient Sharing Section */}
        {activeSection === 'patient' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => { setActiveTab('patient-sharing'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'patient-sharing'
                    ? 'text-purple-600 bg-purple-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  📤 Active Shares
                  {activePatientShares.length > 0 && (
                    <span className="text-xs text-gray-400">({activePatientShares.length})</span>
                  )}
                </span>
                {activeTab === 'patient-sharing' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500"></div>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('shared-with-me'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'shared-with-me'
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  📥 Shared With Me
                  {unviewedSharedFilesCount > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded-full animate-pulse">
                      {unviewedSharedFilesCount} new
                    </span>
                  )}
                  {unviewedSharedFilesCount === 0 && filesSharedWithMe.filter(f => f.status === 'active').length > 0 && (
                    <span className="text-xs text-gray-400">({filesSharedWithMe.filter(f => f.status === 'active').length})</span>
                  )}
                </span>
                {activeTab === 'shared-with-me' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('patient-history'); setExpandedCard(null); }}
                className={`flex-1 px-4 py-3.5 text-sm font-medium transition-all duration-200 relative ${
                  activeTab === 'patient-history'
                    ? 'text-gray-700 bg-gray-100'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  📜 History
                  {historyPatientShares.length > 0 && (
                    <span className="text-xs text-gray-400">({historyPatientShares.length})</span>
                  )}
                </span>
                {activeTab === 'patient-history' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-500"></div>
                )}
              </button>
            </div>

            {/* Content */}
            <div className="p-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                </div>
              ) : activeTab === 'patient-sharing' ? (
                <div className="space-y-4">
                  {/* Share Button */}
                  <button
                    onClick={() => {
                      setShowShareModal(true);
                      setExpandedCategories(new Set(Object.keys(filesByCategory)));
                    }}
                    className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                  >
                    <span>➕</span> Share Files with Another Patient
                  </button>

                  {activePatientShares.length === 0 ? (
                    <div className="text-center py-8">
                      <span className="text-4xl">📤</span>
                      <p className="text-gray-500 mt-3">No active shares</p>
                      <p className="text-sm text-gray-400">Share your medical records securely with other patients</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activePatientShares.map((share) => {
                        const isExpanded = expandedShareId === share.grant_id;
                        return (
                          <div 
                            key={share.grant_id}
                            className="bg-purple-50 rounded-xl border border-purple-100 overflow-hidden"
                          >
                            {/* Collapsed Header */}
                            <div 
                              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-purple-100/50 transition-colors"
                              onClick={() => setExpandedShareId(isExpanded ? null : share.grant_id)}
                            >
                              <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-bold text-sm">
                                  {share.grantee_name?.charAt(0).toUpperCase() || '?'}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 truncate">{share.grantee_name || 'Unknown Patient'}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-gray-500 truncate">{share.filename}</span>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 flex-shrink-0">
                                Active
                              </span>
                              <svg 
                                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>

                            {/* Expanded Content */}
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-purple-100 bg-white/50">
                                <div className="pt-4 space-y-3">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-500">Shared on</span>
                                    <span className="text-gray-900">{new Date(share.granted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  </div>
                                  {share.expires_at && (
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-gray-500">Expires</span>
                                      <span className="text-gray-900">{new Date(share.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                  )}
                                  {share.tx_hash && (
                                    <div>
                                      <TxHashDisplay txHash={share.tx_hash} label="TX" />
                                    </div>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRevokePatientShare(share.grant_id);
                                    }}
                                    disabled={isRevokingShare === share.grant_id}
                                    className="w-full py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors"
                                  >
                                    {isRevokingShare === share.grant_id ? 'Revoking...' : '↩ Revoke Access'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === 'patient-history' ? (
                historyPatientShares.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="text-4xl">📜</span>
                    <p className="text-gray-500 mt-3">No sharing history</p>
                    <p className="text-sm text-gray-400">Revoked and expired shares will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                    {historyPatientShares.map((share) => {
                      const isExpanded = expandedShareId === share.grant_id;
                      const bgColor = share.status === 'revoked' ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-gray-100';
                      const avatarColor = share.status === 'revoked' ? 'bg-orange-500' : 'bg-gray-400';
                      return (
                        <div 
                          key={share.grant_id}
                          className={`rounded-xl border overflow-hidden ${bgColor}`}
                        >
                          {/* Collapsed Header */}
                          <div 
                            className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/50 transition-colors"
                            onClick={() => setExpandedShareId(isExpanded ? null : share.grant_id)}
                          >
                            <div className={`w-10 h-10 ${avatarColor} rounded-full flex items-center justify-center flex-shrink-0`}>
                              <span className="text-white font-bold text-sm">
                                {share.grantee_name?.charAt(0).toUpperCase() || '?'}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{share.grantee_name || 'Unknown Patient'}</p>
                              <span className="text-xs text-gray-500 truncate">{share.filename}</span>
                            </div>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${
                              share.status === 'revoked' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {share.status === 'revoked' ? '↩ Revoked' : share.status === 'expired' ? '⏱ Expired' : share.status}
                            </span>
                            <svg 
                              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* Expanded Content */}
                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-gray-100 bg-white/50">
                              <div className="pt-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-500">Shared on</span>
                                  <span className="text-gray-900">{new Date(share.granted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                                {share.revoked_at && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-500">Revoked on</span>
                                    <span className="text-orange-600">{new Date(share.revoked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  </div>
                                )}
                                {share.expires_at && !share.revoked_at && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-500">Expired on</span>
                                    <span className="text-gray-600">{new Date(share.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  </div>
                                )}
                                {share.tx_hash && (
                                  <div>
                                    <TxHashDisplay txHash={share.tx_hash} label="TX" />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : activeTab === 'shared-with-me' ? (
                filesSharedWithMe.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="text-4xl">📥</span>
                    <p className="text-gray-500 mt-3">No files shared with you</p>
                    <p className="text-sm text-gray-400">Other patients can share their medical records with you</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filesSharedWithMe.map((share) => {
                      const isExpanded = expandedShareId === share.grant_id;
                      const isNew = share.status === 'active' && !isSharedFileViewed(share.grant_id);
                      return (
                        <div 
                          key={share.grant_id}
                          className={`rounded-xl border overflow-hidden ${isNew ? 'bg-blue-100 border-blue-300 ring-2 ring-blue-400' : 'bg-blue-50 border-blue-100'}`}
                        >
                          {/* Collapsed Header */}
                          <div 
                            className="flex items-center gap-3 p-4 cursor-pointer hover:bg-blue-100/50 transition-colors"
                            onClick={() => setExpandedShareId(isExpanded ? null : share.grant_id)}
                          >
                            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white font-bold text-sm">
                                {share.granter_name?.charAt(0).toUpperCase() || '?'}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{share.granter_name || 'Unknown Patient'}</p>
                              <span className="text-xs text-gray-500 truncate">{share.filename}</span>
                            </div>
                            {isNew && (
                              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-blue-500 text-white animate-pulse flex-shrink-0">
                                NEW
                              </span>
                            )}
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${
                              share.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {share.status === 'active' ? 'Active' : share.status}
                            </span>
                            <svg 
                              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* Expanded Content */}
                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-blue-100 bg-white/50">
                              <div className="pt-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-500">Shared on</span>
                                  <span className="text-gray-900">{new Date(share.granted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                                {share.expires_at && (
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-500">Expires</span>
                                    <span className="text-gray-900">{new Date(share.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  </div>
                                )}
                                {share.status === 'active' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingSharedFile(share);
                                      setShowViewSharedModal(true);
                                    }}
                                    className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                                  >
                                    🔓 View & Decrypt
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : null}
            </div>
          </div>
        )}

        {/* Records Section */}
        {activeSection === 'records' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header matching other sections */}
            <div className="flex border-b border-gray-200">
              <div className="flex-1 px-4 py-3.5 text-sm font-medium text-emerald-600 bg-emerald-50 relative">
                <span className="flex items-center justify-center gap-2">
                  📁 My Records
                  {patientRecords.length > 0 && (
                    <span className="text-xs text-gray-400">({patientRecords.length})</span>
                  )}
                </span>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></div>
              </div>
            </div>

            {/* Content */}
            <div className="p-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
                </div>
              ) : patientRecords.length === 0 ? (
                <div className="text-center py-12">
                  <span className="text-4xl">📁</span>
                  <p className="text-gray-500 mt-3">No records uploaded yet</p>
                  <p className="text-sm text-gray-400">Your health records will appear here after hospitals upload them</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {patientRecords.map((record) => {
                    const isExpanded = expandedRecordId === record.id;
                    return (
                      <div 
                        key={record.id}
                        className="bg-emerald-50 rounded-xl border border-emerald-100 overflow-hidden"
                      >
                        {/* Collapsed Header */}
                        <div 
                          className="flex items-center gap-3 p-4 cursor-pointer hover:bg-emerald-100/50 transition-colors"
                          onClick={() => setExpandedRecordId(isExpanded ? null : record.id)}
                        >
                          <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-sm">📄</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">
                              {record.display_name || record.filename}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {record.category && (
                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                                  {record.category}
                                </span>
                              )}
                              <span className="text-xs text-gray-500">
                                {new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                            🔒 Encrypted
                          </span>
                          <svg 
                            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-emerald-100 bg-white/50">
                            <div className="pt-4 space-y-3">
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Content ID (CID)</p>
                                <CidDisplay cid={record.cid} />
                              </div>
                              
                              {record.tx_hash && (
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Transaction</p>
                                  <TxHashDisplay txHash={record.tx_hash} label="" />
                                </div>
                              )}
                              
                              {record.capsule && (
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Encryption Capsule</p>
                                  <code className="block p-2 bg-gray-100 rounded-lg text-xs font-mono text-gray-600 break-all">
                                    {record.capsule.substring(0, 48)}...
                                  </code>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Keys Section */}
        {activeSection === 'keys' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header matching other sections */}
            <div className="flex border-b border-gray-200">
              <div className="flex-1 px-4 py-3.5 text-sm font-medium text-cyan-600 bg-cyan-50 relative">
                <span className="flex items-center justify-center gap-2">
                  🔑 Encryption Keys
                  {hasUmbralKeys && (
                    <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded-full">Ready</span>
                  )}
                </span>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500"></div>
              </div>
            </div>

            {/* Content */}
            <div className="p-5">
              {!umbralReady ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600"></div>
                  <span className="ml-2 text-gray-500">Loading encryption library...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Key Status Card */}
                  <div className={`rounded-xl p-4 border ${hasUmbralKeys ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        hasUmbralKeys ? 'bg-green-100' : 'bg-amber-100'
                      }`}>
                        <span>{hasUmbralKeys ? '✓' : '⚠️'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">
                          {hasUmbralKeys ? 'Keys Available' : 'No Keys Found'}
                        </p>
                        <p className="text-sm text-gray-500">
                          {hasUmbralKeys 
                            ? 'Your encryption keys are ready for secure file sharing'
                            : 'Generate keys to enable access approvals and file sharing'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Public Key Display */}
                  {hasUmbralKeys && myPublicKey && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-700">Your Public Key</p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(myPublicKey);
                            setKeyMessage('Public key copied to clipboard!');
                          }}
                          className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                        >
                          📋 Copy
                        </button>
                      </div>
                      <code className="block p-3 bg-white rounded-lg border text-xs break-all font-mono text-gray-600">
                        {myPublicKey}
                      </code>
                    </div>
                  )}

                  {/* Generate Keys Button */}
                  {!hasUmbralKeys && (
                    <button
                      onClick={handleGenerateKeys}
                      className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-medium rounded-xl hover:from-cyan-600 hover:to-blue-600 transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      <span>🔑</span> Generate New Keys
                    </button>
                  )}

                  {/* Export Keys */}
                  {hasUmbralKeys && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-700">Backup Keys</p>
                        <button
                          onClick={handleExportKeys}
                          className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
                        >
                          📦 Export
                        </button>
                      </div>
                      {keyBackup && (
                        <div>
                          <textarea
                            readOnly
                            value={keyBackup}
                            className="w-full p-3 border rounded-lg text-xs font-mono bg-white"
                            rows={2}
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(keyBackup);
                              setKeyMessage('Backup copied to clipboard!');
                            }}
                            className="mt-2 text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                          >
                            📋 Copy backup string
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Import Keys */}
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <p className="text-sm font-medium text-gray-700 mb-3">Import Keys from Backup</p>
                    <textarea
                      value={importKeyInput}
                      onChange={(e) => setImportKeyInput(e.target.value)}
                      placeholder="Paste your key backup string here..."
                      className="w-full p-3 border rounded-lg text-xs font-mono bg-white"
                      rows={2}
                    />
                    <button
                      onClick={handleImportKeys}
                      className="mt-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                      📥 Import Keys
                    </button>
                  </div>

                  {/* Messages */}
                  {keyMessage && (
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-sm">
                      {keyMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
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

        {/* Patient Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">📤 Share Files with Patient</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Share your medical files with another patient using their UUID
                </p>
              </div>

              <div className="p-6 space-y-4">
                {shareError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                    {shareError}
                  </div>
                )}

                {/* Patient UUID Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Patient UUID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sharePatientUuid}
                      onChange={(e) => {
                        setSharePatientUuid(e.target.value);
                        setPatientToShare(null);
                      }}
                      placeholder="Enter patient UUID"
                      className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <button
                      onClick={async () => {
                        if (!sharePatientUuid) return;
                        setShareError('');
                        const result = await getPatientPublicKey(sharePatientUuid);
                        if (result.error) {
                          setShareError(result.error);
                          return;
                        }
                        if (result.data) {
                          setPatientToShare({
                            uuid: sharePatientUuid,
                            name: result.data.patient_name,
                            hasKey: result.data.has_public_key
                          });
                        }
                      }}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                      Verify
                    </button>
                  </div>
                  {patientToShare && (
                    <div className={`mt-2 p-3 rounded-lg ${patientToShare.hasKey ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                      <p className="text-sm font-medium">
                        {patientToShare.hasKey ? '✓' : '⚠️'} {patientToShare.name || `Patient (${patientToShare.uuid.slice(0, 8)}...)`}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">UUID: {patientToShare.uuid}</p>
                      {!patientToShare.hasKey && (
                        <p className="text-xs text-amber-700 mt-1">This patient has not set up encryption keys yet.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* File Selection - Folder-based organization */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Files to Share
                  </label>
                  {myFiles.length === 0 ? (
                    <p className="text-sm text-gray-500">No files available to share.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-xl p-2">
                      {Object.entries(filesByCategory).map(([category, files]) => {
                        const categoryFileIds = files.map(f => f.id);
                        const selectedCount = categoryFileIds.filter(id => shareSelectedFiles.includes(id)).length;
                        const allSelected = selectedCount === files.length;
                        const someSelected = selectedCount > 0 && selectedCount < files.length;
                        const isExpanded = expandedCategories.has(category);
                        
                        return (
                          <div key={category} className="border border-gray-100 rounded-lg overflow-hidden">
                            {/* Category Header */}
                            <div 
                              className="flex items-center gap-2 p-2.5 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                              onClick={() => toggleCategoryExpansion(category)}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCategorySelection(category, files);
                                }}
                                className={`w-5 h-5 flex items-center justify-center rounded border-2 transition-colors ${
                                  allSelected ? 'bg-indigo-600 border-indigo-600 text-white' :
                                  someSelected ? 'bg-indigo-100 border-indigo-600' :
                                  'border-gray-300'
                                }`}
                              >
                                {allSelected && <span className="text-xs">✓</span>}
                                {someSelected && <span className="text-indigo-600 text-xs">−</span>}
                              </button>
                              <span className="text-lg">{categoryIcons[category] || '📁'}</span>
                              <span className="font-medium text-gray-900 flex-1">{category}</span>
                              <span className="text-xs text-gray-500">
                                {selectedCount > 0 && <span className="text-indigo-600 font-medium">{selectedCount}/</span>}
                                {files.length} files
                              </span>
                              <svg 
                                className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                            
                            {/* Files in Category */}
                            {isExpanded && (
                              <div className="border-t border-gray-100 bg-white">
                                {files.map((file) => (
                                  <label
                                    key={file.id}
                                    className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={shareSelectedFiles.includes(file.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setShareSelectedFiles([...shareSelectedFiles, file.id]);
                                        } else {
                                          setShareSelectedFiles(shareSelectedFiles.filter(id => id !== file.id));
                                        }
                                      }}
                                      className="w-4 h-4 text-indigo-600 rounded"
                                    />
                                    <span className="text-sm text-gray-700">{getFileDisplayName(file)}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {shareSelectedFiles.length} file(s) selected from {Object.keys(filesByCategory).length} categories
                  </p>
                </div>

                {/* Expiry Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Access Duration (optional)
                  </label>
                  <select
                    value={shareExpiryDays}
                    onChange={(e) => setShareExpiryDays(Number(e.target.value))}
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

                {/* Purpose (optional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Purpose (optional)
                  </label>
                  <input
                    type="text"
                    value={sharePurpose}
                    onChange={(e) => setSharePurpose(e.target.value)}
                    placeholder="e.g., Second opinion, specialist referral"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Passphrase */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Your Encryption Passphrase
                  </label>
                  <input
                    type="password"
                    value={sharePassphrase}
                    onChange={(e) => setSharePassphrase(e.target.value)}
                    placeholder="Enter your passphrase to authorize"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Security Info */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h4 className="font-medium text-blue-900 flex items-center gap-2">
                    <span>🔒</span> Secure Patient Sharing
                  </h4>
                  <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• Share is recorded on the blockchain</li>
                    <li>• You can revoke access at any time</li>
                    <li>• Patient uses their own keys to decrypt</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => {
                    setShowShareModal(false);
                    setSharePatientUuid('');
                    setShareSelectedFiles([]);
                    setShareExpiryDays(0);
                    setSharePurpose('');
                    setSharePassphrase('');
                    setPatientToShare(null);
                    setShareError('');
                    setExpandedCategories(new Set());
                  }}
                  disabled={isSharing}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareFiles}
                  disabled={isSharing || !patientToShare?.hasKey || shareSelectedFiles.length === 0 || !sharePassphrase}
                  className="flex-1 btn-primary disabled:opacity-50"
                >
                  {isSharing ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Sharing...
                    </span>
                  ) : (
                    'Share Files'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View & Decrypt Shared File Modal */}
        {showViewSharedModal && viewingSharedFile && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">🔓 View Shared File</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Decrypt and view the file shared with you
                </p>
              </div>

              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                {/* File Info */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-semibold text-lg">
                        {viewingSharedFile.granter_name?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{viewingSharedFile.granter_name || 'Unknown Patient'}</p>
                      <p className="text-sm text-gray-600">{viewingSharedFile.filename}</p>
                      <p className="text-xs text-gray-400">
                        Shared: {new Date(viewingSharedFile.granted_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>

                {viewError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                    {viewError}
                  </div>
                )}

                {!decryptedContent ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Your Encryption Passphrase
                      </label>
                      <input
                        type="password"
                        value={viewPassphrase}
                        onChange={(e) => setViewPassphrase(e.target.value)}
                        placeholder="Enter your passphrase to decrypt"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && viewPassphrase) {
                            handleDecryptSharedFile();
                          }
                        }}
                      />
                    </div>

                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                      <p className="text-sm text-indigo-700">
                        <span className="font-medium">🔐 End-to-end encrypted:</span> This file was encrypted specifically for you using Proxy Re-Encryption. 
                        Only you can decrypt it with your private key.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <p className="text-sm text-green-700 font-medium">✓ File decrypted successfully</p>
                    </div>

                    {/* Display decrypted content based on mime type */}
                    {decryptedContent.mimeType.startsWith('image/') ? (
                      <div className="flex justify-center">
                        <img 
                          src={`data:${decryptedContent.mimeType};base64,${decryptedContent.data}`}
                          alt={decryptedContent.filename}
                          className="max-w-full max-h-[400px] rounded-lg shadow-md"
                        />
                      </div>
                    ) : decryptedContent.mimeType === 'application/pdf' ? (
                      <div className="border rounded-lg overflow-hidden">
                        <iframe
                          src={`data:application/pdf;base64,${decryptedContent.data}`}
                          className="w-full h-[400px]"
                          title={decryptedContent.filename}
                        />
                      </div>
                    ) : decryptedContent.mimeType.startsWith('text/') ? (
                      <div className="bg-gray-900 text-gray-100 rounded-lg p-4 max-h-[400px] overflow-auto">
                        <pre className="text-sm whitespace-pre-wrap font-mono">
                          {atob(decryptedContent.data)}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-gray-600 mb-4">File decrypted. Click below to download.</p>
                        <a
                          href={`data:${decryptedContent.mimeType};base64,${decryptedContent.data}`}
                          download={decryptedContent.filename}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          <span>📥</span> Download {decryptedContent.filename}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={handleCloseViewModal}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                {!decryptedContent && (
                  <button
                    onClick={handleDecryptSharedFile}
                    disabled={isDecrypting || !viewPassphrase}
                    className="flex-1 btn-primary disabled:opacity-50"
                  >
                    {isDecrypting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Decrypting...
                      </span>
                    ) : (
                      'Decrypt & View'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
