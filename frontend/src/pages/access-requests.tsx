/**
 * Access Management Page
 * 
 * Unified page for all access-related operations:
 * - Grant Access: Create new access grants for your files
 * - My Grants: View who has access to your files with expiry countdown
 * - Pending Requests: View and approve/deny incoming requests
 * - Request Access: Request access to others' files
 * - Redeem Access: Download files you've been granted access to
 * - Keys: Manage your encryption keys
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import TxHashDisplay from '@/components/TxHashDisplay';
import CidDisplay from '@/components/CidDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import {
  getPendingRequests,
  approveAccess,
  denyAccess,
  requestAccess,
  redeemAccess,
  getPatientRecords,
  downloadRawEncrypted,
  getMyGrants,
  listFiles,
  listGrants,
  createGrant,
  revokeGrant,
} from '@/lib/api';
import {
  initUmbral,
  generateKeyPair,
  generateSigningKeyPair,
  generateKFrags,
  decryptReencrypted,
  loadKeys,
  storeKeys,
  hasStoredKeys,
  exportKeysForBackup,
  importKeysFromBackup,
} from '@/lib/umbral';

interface AccessRequest {
  id: number;
  cid: string;
  requester_pubkey: string;
  purpose: string;
  status: string;
  created_at: string;
  tx_hash?: string;
}

interface PatientRecord {
  cid: string;
  filename: string;
  capsule?: string;
  tx_hash?: string;
  created_at: string;
}

interface ApprovedGrant {
  id: number;
  cid: string;
  requester_pubkey: string;
  purpose: string;
  status: string;
  expires_at: string | null;
  tx_hash: string | null;
  created_at: string;
  time_remaining: string | null;
  is_expired: boolean;
}

type TabType = 'grant' | 'mygrants' | 'pending' | 'request' | 'redeem' | 'records' | 'keys';

interface FileRecord {
  id: number;
  filename: string;
  cid: string;
}

interface Grant {
  id: number;
  file_id: number;
  filename: string;
  grantee_id: number;
  grantee_username: string;
  status: string;
  created_at: string;
}

export default function AccessRequestsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const [activeTab, setActiveTab] = useState<TabType>('grant');
  const [pendingRequests, setPendingRequests] = useState<AccessRequest[]>([]);
  const [myRecords, setMyRecords] = useState<PatientRecord[]>([]);
  const [myGrants, setMyGrants] = useState<ApprovedGrant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Grant Access state
  const [myFiles, setMyFiles] = useState<FileRecord[]>([]);
  const [existingGrants, setExistingGrants] = useState<Grant[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [granteeId, setGranteeId] = useState('');
  const [isCreatingGrant, setIsCreatingGrant] = useState(false);
  const [grantError, setGrantError] = useState('');
  const [grantSuccess, setGrantSuccess] = useState('');
  
  // Umbral key state
  const [umbralReady, setUmbralReady] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);
  const [myPublicKey, setMyPublicKey] = useState<string>('');
  const [keyBackup, setKeyBackup] = useState<string>('');
  const [importKeyInput, setImportKeyInput] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  
  // Request access form
  const [requestCid, setRequestCid] = useState('');
  const [requestPurpose, setRequestPurpose] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  
  // Redeem form
  const [redeemCid, setRedeemCid] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{
    reenc_capsule: string;
    blob_url: string;
    capsule: string;
    encrypted_cek: string;
    owner_pubkey: string;
    filename: string;
  } | null>(null);
  const [redeemError, setRedeemError] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  
  // Transaction tracking
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  
  // Decrypted file state
  const [decryptedFile, setDecryptedFile] = useState<{
    content: Uint8Array;
    filename: string;
    contentType: string;
  } | null>(null);

  // Initialize Umbral WASM
  useEffect(() => {
    initUmbral().then(() => {
      setUmbralReady(true);
      // Check if keys exist
      if (hasStoredKeys()) {
        setHasKeys(true);
        const keys = loadKeys();
        if (keys.publicKeyHex) {
          setMyPublicKey(keys.publicKeyHex);
        }
      }
    }).catch(err => {
      console.error('Failed to init Umbral:', err);
    });
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user, activeTab]);

  const loadData = async () => {
    if (!user?.id) return;
    setIsLoading(true);

    try {
      if (activeTab === 'grant') {
        const [filesResult, grantsResult] = await Promise.all([
          listFiles(user.id),
          listGrants(user.id),
        ]);
        if (filesResult.data) {
          setMyFiles(filesResult.data.files || []);
        }
        if (grantsResult.data) {
          setExistingGrants(grantsResult.data.grants || []);
        }
      } else if (activeTab === 'pending') {
        const result = await getPendingRequests();
        if (result.data) {
          setPendingRequests(result.data.requests || []);
        }
      } else if (activeTab === 'mygrants') {
        const result = await getMyGrants();
        if (result.data) {
          setMyGrants(result.data.grants || []);
        }
      } else if (activeTab === 'records') {
        const result = await getPatientRecords(user.id);
        if (result.data) {
          setMyRecords(result.data.records || []);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }

    setIsLoading(false);
  };
  
  // Grant management functions
  const handleCreateGrant = async () => {
    if (!selectedFileId || !granteeId || !user?.id) {
      setGrantError('Please fill in all fields');
      return;
    }

    setIsCreatingGrant(true);
    setGrantError('');
    setGrantSuccess('');

    const result = await createGrant({
      granter_id: user.id,
      grantee_id: parseInt(granteeId),
      file_id: selectedFileId,
    });

    if (result.error) {
      setGrantError(result.error);
      setIsCreatingGrant(false);
      return;
    }

    setGrantSuccess('Access grant created successfully!');
    setSelectedFileId(null);
    setGranteeId('');
    await loadData();
    setIsCreatingGrant(false);
  };

  const handleRevokeGrant = async (grantId: number) => {
    if (!user?.id) return;
    if (!confirm('Are you sure you want to revoke this access grant?')) return;

    const result = await revokeGrant({
      grant_id: grantId,
      granter_id: user.id,
      emit_onchain: true,
    });

    if (result.error) {
      alert(`Failed to revoke grant: ${result.error}`);
      return;
    }

    await loadData();
  };
  
  // Key management functions
  const handleGenerateKeys = async () => {
    try {
      const keyPair = await generateKeyPair();
      const signingPair = await generateSigningKeyPair();
      storeKeys(keyPair.secretKeyBytes, signingPair.signingKeyBytes, keyPair.publicKeyHex);
      setHasKeys(true);
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
      setHasKeys(true);
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

  const handleApprove = async (requestId: number, requesterPubkey: string) => {
    setProcessingId(requestId);
    
    try {
      // Load owner's keys from localStorage
      const keys = loadKeys();
      if (!keys.secretKeyBytes || !keys.signingKeyBytes) {
        alert('You need to generate or import your Umbral keys first. Go to the Keys tab.');
        setProcessingId(null);
        return;
      }
      
      // Generate kfrags client-side for the requester
      console.log('Generating kfrags for requester:', requesterPubkey);
      const { kfragsHex, verifyingKeyHex } = await generateKFrags(
        keys.secretKeyBytes,
        keys.signingKeyBytes,
        requesterPubkey,
        1, // threshold
        1  // shares
      );
      
      console.log('Generated kfrag:', kfragsHex[0].substring(0, 32) + '...');
      console.log('Verifying key:', verifyingKeyHex.substring(0, 32) + '...');
      
      // Send to server with the kfrag
      const result = await approveAccess({
        request_id: requestId,
        expiry_seconds: 86400, // 24 hours
        kfrag_hex: kfragsHex[0], // Send the first (and only) kfrag
        verifying_key_hex: verifyingKeyHex,
      });

      if (result.error) {
        alert(`Failed to approve: ${result.error}`);
      } else if (result.data) {
        setLastTxHash(result.data.tx_hash || null);
        await loadData();
        alert('Access approved! Transaction hash: ' + (result.data.tx_hash || 'pending'));
      }
    } catch (error) {
      console.error('Approve error:', error);
      alert('Failed to approve request: ' + (error as Error).message);
    }
    
    setProcessingId(null);
  };

  const handleDeny = async (requestId: number) => {
    if (!confirm('Are you sure you want to deny this access request?')) {
      return;
    }

    setProcessingId(requestId);
    
    try {
      const result = await denyAccess(requestId);
      if (result.error) {
        alert(`Failed to deny: ${result.error}`);
      } else {
        await loadData();
      }
    } catch (error) {
      alert('Failed to deny request');
    }
    
    setProcessingId(null);
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!requestCid.trim() || !requestPurpose.trim()) {
      setRequestError('Please fill in all fields');
      return;
    }

    // Use Umbral public key from localStorage, fallback to user's profile public key
    const keys = loadKeys();
    const pubkeyToUse = keys.publicKeyHex || user?.public_key;
    
    if (!pubkeyToUse) {
      setRequestError('You need to generate encryption keys first. Go to the Keys tab.');
      return;
    }

    setIsRequesting(true);
    setRequestError('');
    setRequestSuccess('');

    try {
      const result = await requestAccess({
        cid: requestCid.trim(),
        requester_pubkey: pubkeyToUse,
        purpose: requestPurpose.trim(),
      });

      if (result.error) {
        setRequestError(result.error);
      } else if (result.data) {
        setRequestSuccess(`Access request created! Request ID: ${result.data.request_id}. Your public key: ${pubkeyToUse.substring(0, 20)}...`);
        setRequestCid('');
        setRequestPurpose('');
      }
    } catch (error) {
      setRequestError('Failed to submit request');
    }

    setIsRequesting(false);
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!redeemCid.trim()) {
      setRedeemError('Please enter a CID');
      return;
    }
    
    // Check if keys exist
    const keys = loadKeys();
    if (!keys.secretKeyBytes) {
      setRedeemError('You need to generate or import your Umbral keys first. Go to the Keys tab.');
      return;
    }

    setIsRedeeming(true);
    setRedeemError('');
    setRedeemResult(null);
    setDecryptedFile(null);

    try {
      const result = await redeemAccess({ cid: redeemCid.trim() });

      if (result.error) {
        setRedeemError(result.error);
      } else if (result.data) {
        setRedeemResult(result.data);
        // Automatically start decryption
        await handleDecrypt(result.data, keys.secretKeyBytes);
      }
    } catch (error) {
      setRedeemError('Failed to redeem access: ' + (error as Error).message);
    }

    setIsRedeeming(false);
  };
  
  // Helper function to decrypt the file after redeem
  const handleDecrypt = async (redeemData: {
    reenc_capsule: string;
    blob_url: string;
    capsule: string;
    encrypted_cek: string;
    owner_pubkey: string;
    filename: string;
  }, secretKeyBytes: Uint8Array) => {
    setIsDecrypting(true);
    
    try {
      // 1. Download the encrypted blob from blob_url
      console.log('Downloading encrypted blob from:', redeemData.blob_url);
      const blobResponse = await fetch(redeemData.blob_url);
      if (!blobResponse.ok) {
        throw new Error('Failed to download encrypted file');
      }
      const encryptedBlob = new Uint8Array(await blobResponse.arrayBuffer());
      console.log('Downloaded blob size:', encryptedBlob.length);
      
      // 2. Decode the cfrag from base64
      const cfragBytes = Uint8Array.from(atob(redeemData.reenc_capsule), c => c.charCodeAt(0));
      const cfragHex = Array.from(cfragBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('cfrag hex:', cfragHex.substring(0, 32) + '...');
      
      // 3. Decode the encrypted CEK (hex string)
      const encryptedCekBytes = hexToBytes(redeemData.encrypted_cek);
      console.log('Encrypted CEK size:', encryptedCekBytes.length);
      
      // 4. Use Umbral to decrypt the CEK
      console.log('Decrypting CEK with owner pubkey:', redeemData.owner_pubkey.substring(0, 20) + '...');
      const decryptedCek = await decryptReencrypted(
        secretKeyBytes,
        redeemData.owner_pubkey,
        redeemData.capsule,
        [cfragHex],  // Array of cfrag hex strings
        encryptedCekBytes
      );
      console.log('Decrypted CEK size:', decryptedCek.length);
      
      // 5. Use the CEK to decrypt the file with AES-GCM
      // The encrypted blob format: 12-byte nonce + ciphertext + 16-byte auth tag
      const nonce = encryptedBlob.slice(0, 12);
      const ciphertext = encryptedBlob.slice(12);
      
      const key = await crypto.subtle.importKey(
        'raw',
        decryptedCek.buffer as ArrayBuffer,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      
      const decryptedContent = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        ciphertext
      );
      
      const decryptedBytes = new Uint8Array(decryptedContent);
      console.log('Decrypted file size:', decryptedBytes.length);
      
      // Determine content type from filename
      const ext = redeemData.filename.split('.').pop()?.toLowerCase() || '';
      const contentTypes: Record<string, string> = {
        'txt': 'text/plain',
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'json': 'application/json',
        'html': 'text/html',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      
      setDecryptedFile({
        content: decryptedBytes,
        filename: redeemData.filename,
        contentType,
      });
      
    } catch (error) {
      console.error('Decryption error:', error);
      setRedeemError('Failed to decrypt file: ' + (error as Error).message);
    }
    
    setIsDecrypting(false);
  };
  
  // Helper function to convert hex to bytes
  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  };
  
  // Helper function to download decrypted file
  const downloadDecryptedFile = () => {
    if (!decryptedFile) return;
    
    const blob = new Blob([decryptedFile.content.buffer as ArrayBuffer], { type: decryptedFile.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = decryptedFile.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Access Management</h1>
        <p className="mt-1 text-gray-600">
          Manage access requests for encrypted health records
        </p>
      </div>

      {/* Last Transaction */}
      {lastTxHash && (
        <div className="mb-6">
          <TxHashDisplay txHash={lastTxHash} label="Last Transaction" status="confirmed" />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          <button
            onClick={() => setActiveTab('grant')}
            className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'grant'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Grant Access
          </button>
          <button
            onClick={() => setActiveTab('mygrants')}
            className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'mygrants'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            My Grants
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'pending'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Pending Requests
          </button>
          <button
            onClick={() => setActiveTab('request')}
            className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'request'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Request Access
          </button>
          <button
            onClick={() => setActiveTab('redeem')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'redeem'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Redeem Access
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'records'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            My Records
          </button>
          <button
            onClick={() => setActiveTab('keys')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'keys'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            🔑 Keys {!hasKeys && <span className="text-red-500">!</span>}
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl shadow-sm border">
        {/* Grant Access Tab */}
        {activeTab === 'grant' && (
          <div>
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">
                Grant Access
              </h2>
              <p className="text-sm text-gray-600">
                Share your health records with healthcare providers
              </p>
            </div>

            <div className="p-6">
              {/* Create Grant Form */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <h3 className="text-md font-semibold text-gray-900 mb-4">Create New Grant</h3>
                
                {grantError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
                    {grantError}
                  </div>
                )}
                {grantSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">
                    {grantSuccess}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Select File
                    </label>
                    <select
                      value={selectedFileId || ''}
                      onChange={(e) => setSelectedFileId(parseInt(e.target.value) || null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Choose a file...</option>
                      {myFiles.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.filename}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Grantee User ID
                    </label>
                    <input
                      type="number"
                      value={granteeId}
                      onChange={(e) => setGranteeId(e.target.value)}
                      placeholder="User ID to share with"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div className="flex items-end">
                    <button
                      onClick={handleCreateGrant}
                      disabled={isCreatingGrant || !selectedFileId || !granteeId || !isConnected || !isCorrectNetwork}
                      className={`w-full px-4 py-2 rounded-md font-medium transition-colors ${
                        isCreatingGrant || !selectedFileId || !granteeId || !isConnected || !isCorrectNetwork
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isCreatingGrant ? 'Creating...' : 'Create Grant'}
                    </button>
                  </div>
                </div>
                
                {(!isConnected || !isCorrectNetwork) && (
                  <p className="mt-2 text-sm text-yellow-600">
                    ⚠️ Connect wallet to Sepolia network to create grants
                  </p>
                )}
              </div>
              
              {/* Existing Grants List */}
              <h3 className="text-md font-semibold text-gray-900 mb-4">Your Active Grants</h3>
              
              {isLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : existingGrants.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No active grants. Create one above to share your files.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {existingGrants.map((grant) => (
                    <div key={grant.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {grant.grantee_username || `User #${grant.grantee_id}`}
                          </p>
                          <p className="text-sm text-gray-500">
                            File: {grant.filename || `File #${grant.file_id}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className={`px-3 py-1 text-sm rounded-full ${
                          grant.status === 'active' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {grant.status}
                        </span>
                        {grant.status === 'active' && (
                          <button
                            onClick={() => handleRevokeGrant(grant.id)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending Requests Tab (for file owners) */}
        {activeTab === 'pending' && (
          <div>
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">
                Pending Access Requests
              </h2>
              <p className="text-sm text-gray-600">
                Requests from others to access your files
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-4">No pending access requests</p>
              </div>
            ) : (
              <div className="divide-y">
                {pendingRequests.map((request) => (
                  <div key={request.id} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                            {request.status}
                          </span>
                          <span className="text-sm text-gray-500">
                            Request #{request.id}
                          </span>
                        </div>
                        
                        <div className="mb-2">
                          <CidDisplay cid={request.cid} />
                        </div>
                        
                        <p className="text-gray-600 mb-2">
                          <strong>Purpose:</strong> {request.purpose}
                        </p>
                        
                        <p className="text-sm text-gray-500 mb-2">
                          <strong>Requester Key:</strong>{' '}
                          <code className="bg-gray-100 px-1 rounded text-xs">
                            {request.requester_pubkey.substring(0, 20)}...
                          </code>
                        </p>
                        
                        <p className="text-xs text-gray-400">
                          Requested: {new Date(request.created_at).toLocaleString()}
                        </p>
                      </div>
                      
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleApprove(request.id, request.requester_pubkey)}
                          disabled={processingId === request.id || !hasKeys}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={!hasKeys ? 'Generate keys first in Keys tab' : 'Approve access request'}
                        >
                          {processingId === request.id ? 'Processing...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleDeny(request.id)}
                          disabled={processingId === request.id}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Grants Tab - Shows who you've given access to */}
        {activeTab === 'mygrants' && (
          <div>
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">
                My Grants
              </h2>
              <p className="text-sm text-gray-600">
                People you've granted access to your files
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : myGrants.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
                <p className="mt-4">You haven't granted access to anyone yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {myGrants.map((grant) => (
                  <div key={grant.id} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            grant.is_expired 
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {grant.is_expired ? 'Expired' : 'Active'}
                          </span>
                          <span className="text-sm text-gray-500">
                            Grant #{grant.id}
                          </span>
                        </div>
                        
                        <div className="mb-2">
                          <CidDisplay cid={grant.cid} />
                        </div>
                        
                        <p className="text-gray-600 mb-2">
                          <strong>Purpose:</strong> {grant.purpose}
                        </p>
                        
                        <p className="text-sm text-gray-500 mb-2">
                          <strong>Grantee Key:</strong>{' '}
                          <code className="bg-gray-100 px-1 rounded text-xs">
                            {grant.requester_pubkey.substring(0, 20)}...
                          </code>
                        </p>
                        
                        {grant.tx_hash && (
                          <div className="mb-2">
                            <TxHashDisplay txHash={grant.tx_hash} label="TX" />
                          </div>
                        )}
                        
                        <p className="text-xs text-gray-400">
                          Granted: {new Date(grant.created_at).toLocaleString()}
                        </p>
                      </div>
                      
                      <div className="ml-4 text-right">
                        {grant.time_remaining && (
                          <div className={`text-sm font-medium ${
                            grant.is_expired ? 'text-red-600' : 'text-green-600'
                          }`}>
                            ⏱️ {grant.time_remaining}
                          </div>
                        )}
                        {grant.expires_at && (
                          <div className="text-xs text-gray-400 mt-1">
                            Expires: {new Date(grant.expires_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Request Access Tab (for doctors/providers) */}
        {activeTab === 'request' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Request Access to Patient Records
            </h2>
            <p className="text-gray-600 mb-6">
              Enter the CID of the file you need access to and explain why you need it.
            </p>

            <form onSubmit={handleRequestAccess} className="space-y-4 max-w-lg">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File CID
                </label>
                <input
                  type="text"
                  value={requestCid}
                  onChange={(e) => setRequestCid(e.target.value)}
                  placeholder="bafybeig..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purpose / Reason
                </label>
                <textarea
                  value={requestPurpose}
                  onChange={(e) => setRequestPurpose(e.target.value)}
                  placeholder="Explain why you need access to this file..."
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {requestError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {requestError}
                </div>
              )}

              {requestSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                  {requestSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={isRequesting}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRequesting ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>

            {!hasKeys && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-800 text-sm">
                  <strong>⚠️ No encryption keys found.</strong> You need to generate keys in the{' '}
                  <button 
                    onClick={() => setActiveTab('keys')}
                    className="underline font-medium"
                  >
                    Keys tab
                  </button>{' '}
                  before requesting access.
                </p>
              </div>
            )}
            
            {hasKeys && myPublicKey && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-blue-800 text-sm">
                  <strong>Your Public Key:</strong>
                </p>
                <code className="block mt-1 p-2 bg-white rounded text-xs break-all">
                  {myPublicKey}
                </code>
                <p className="text-gray-500 text-xs mt-1">
                  This key will be used when you request access.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Redeem Access Tab */}
        {activeTab === 'redeem' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Redeem Approved Access
            </h2>
            <p className="text-gray-600 mb-6">
              After your access request is approved, enter the CID to get the re-encrypted data.
            </p>

            <form onSubmit={handleRedeem} className="space-y-4 max-w-lg">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File CID
                </label>
                <input
                  type="text"
                  value={redeemCid}
                  onChange={(e) => setRedeemCid(e.target.value)}
                  placeholder="bafybeig..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {redeemError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {redeemError}
                </div>
              )}

              <button
                type="submit"
                disabled={isRedeeming || !hasKeys}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!hasKeys ? 'Generate keys first in Keys tab' : 'Redeem access and decrypt'}
              >
                {isRedeeming ? 'Redeeming...' : isDecrypting ? 'Decrypting...' : 'Redeem & Decrypt'}
              </button>
            </form>
            
            {!hasKeys && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                You need to generate or import your encryption keys first. Go to the <strong>Keys</strong> tab.
              </div>
            )}

            {redeemResult && (
              <div className="mt-6 space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h3 className="font-semibold text-green-800 mb-2">✅ Access Redeemed!</h3>
                  <p className="text-sm text-gray-600">
                    File: <strong>{redeemResult.filename}</strong>
                  </p>
                </div>
                
                {isDecrypting && (
                  <div className="flex items-center gap-2 text-blue-600">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <span>Decrypting file...</span>
                  </div>
                )}
                
                {decryptedFile && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="font-semibold text-blue-800 mb-2">🔓 File Decrypted!</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      <strong>Filename:</strong> {decryptedFile.filename}<br/>
                      <strong>Size:</strong> {(decryptedFile.content.length / 1024).toFixed(2)} KB<br/>
                      <strong>Type:</strong> {decryptedFile.contentType}
                    </p>
                    
                    <button
                      onClick={downloadDecryptedFile}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      📥 Download Decrypted File
                    </button>
                    
                    {/* Preview for text files */}
                    {decryptedFile.contentType === 'text/plain' && (
                      <div className="mt-4">
                        <h4 className="font-medium text-gray-700 mb-2">Preview:</h4>
                        <pre className="p-3 bg-white border rounded text-xs overflow-auto max-h-64">
                          {new TextDecoder().decode(decryptedFile.content)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Technical details (collapsible) */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                    Technical Details
                  </summary>
                  <div className="mt-2 p-3 bg-gray-50 rounded space-y-2">
                    <p>
                      <strong>Blob URL:</strong>{' '}
                      <a 
                        href={redeemResult.blob_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View on IPFS
                      </a>
                    </p>
                    <p><strong>Owner Public Key:</strong></p>
                    <code className="block p-2 bg-white rounded text-xs break-all">
                      {redeemResult.owner_pubkey}
                    </code>
                    <p><strong>Re-encrypted Capsule (cfrag):</strong></p>
                    <code className="block p-2 bg-white rounded text-xs overflow-x-auto">
                      {redeemResult.reenc_capsule.substring(0, 64)}...
                    </code>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* My Records Tab */}
        {activeTab === 'records' && (
          <div>
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">My Records</h2>
              <p className="text-sm text-gray-600">
                Your uploaded health records with encryption metadata
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : myRecords.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="mt-4">No records uploaded yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {myRecords.map((record, idx) => (
                  <div key={idx} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 mb-2">
                          {record.filename}
                        </h3>
                        
                        <div className="mb-2">
                          <CidDisplay cid={record.cid} />
                        </div>
                        
                        {record.tx_hash && (
                          <div className="mb-2">
                            <TxHashDisplay txHash={record.tx_hash} label="Upload TX" />
                          </div>
                        )}
                        
                        {record.capsule && (
                          <p className="text-sm text-gray-500 mb-1">
                            <strong>Capsule:</strong>{' '}
                            <code className="bg-gray-100 px-1 rounded text-xs">
                              {record.capsule.substring(0, 32)}...
                            </code>
                          </p>
                        )}
                        
                        <p className="text-xs text-gray-400">
                          Uploaded: {new Date(record.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Keys Tab */}
        {activeTab === 'keys' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              🔐 Umbral Encryption Keys
            </h2>
            <p className="text-gray-600 mb-6">
              Your encryption keys are used for Proxy Re-Encryption. They allow you to securely share 
              encrypted files without revealing your private key.
            </p>

            {!umbralReady ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-2 text-gray-500">Loading encryption library...</span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Key Status */}
                <div className={`p-4 rounded-lg border ${hasKeys ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <h3 className="font-medium mb-2">
                    {hasKeys ? '✅ Keys Available' : '⚠️ No Keys Found'}
                  </h3>
                  {hasKeys ? (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">Your public key (share this with others):</p>
                      <code className="block p-2 bg-white rounded border text-xs break-all">
                        {myPublicKey}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(myPublicKey);
                          setKeyMessage('Public key copied to clipboard!');
                        }}
                        className="mt-2 text-sm text-blue-600 hover:underline"
                      >
                        Copy to clipboard
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-yellow-800">
                      You need to generate encryption keys to approve access requests or request access to files.
                    </p>
                  )}
                </div>

                {/* Generate Keys */}
                {!hasKeys && (
                  <div className="space-y-2">
                    <button
                      onClick={handleGenerateKeys}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                    >
                      Generate New Keys
                    </button>
                    <p className="text-sm text-gray-500">
                      This will generate a new encryption keypair stored in your browser.
                    </p>
                  </div>
                )}

                {/* Export Keys */}
                {hasKeys && (
                  <div className="space-y-2">
                    <button
                      onClick={handleExportKeys}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      Export Keys (Backup)
                    </button>
                    {keyBackup && (
                      <div className="mt-2">
                        <p className="text-sm text-gray-600 mb-1">Backup string (store securely!):</p>
                        <textarea
                          readOnly
                          value={keyBackup}
                          className="w-full p-2 border rounded text-xs font-mono"
                          rows={3}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(keyBackup);
                            setKeyMessage('Backup copied to clipboard!');
                          }}
                          className="mt-1 text-sm text-blue-600 hover:underline"
                        >
                          Copy backup
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Import Keys */}
                <div className="border-t pt-4">
                  <h3 className="font-medium mb-2">Import Keys from Backup</h3>
                  <textarea
                    value={importKeyInput}
                    onChange={(e) => setImportKeyInput(e.target.value)}
                    placeholder="Paste your key backup string here..."
                    className="w-full p-2 border rounded text-xs font-mono"
                    rows={3}
                  />
                  <button
                    onClick={handleImportKeys}
                    className="mt-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Import Keys
                  </button>
                </div>

                {/* Messages */}
                {keyMessage && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                    {keyMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
