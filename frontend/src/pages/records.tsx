/**
 * Records Page - Patient Health Records View with Client-Side Decryption
 * 
 * Features:
 * - List patient's encrypted health records from backend
 * - View button prompts for passphrase to unlock local private key
 * - Fetches ciphertext from Storacha and decrypts with capsule
 * - Inline preview for images and PDFs, download for other files
 * - Supports both owner decryption and grantee (re-encrypted) decryption
 * 
 * Backend Endpoints:
 * - GET /access/records/{patient_id} - List patient records
 * - POST /access/redeem - Get re-encrypted capsule (for grantees)
 * 
 * References:
 * - @nucypher/umbral-pre: https://www.npmjs.com/package/@nucypher/umbral-pre
 * - Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import CidDisplay from '@/components/CidDisplay';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { getPatientRecords, redeemAccess } from '@/lib/api';
import KeyManager from '@/lib/KeyManager';
import { 
  initUmbral, 
  decryptOriginal, 
  decryptReencrypted,
  secretKeyFromBytes 
} from '@/lib/umbral';

// ============================================================================
// Types
// ============================================================================

interface FileRecord {
  id: number;
  cid: string;
  filename: string;
  capsule?: string;
  encrypted_cek?: string;
  tx_hash?: string;
  created_at: string;
}

interface DecryptedContent {
  filename: string;
  contentType: string;
  data: Uint8Array;
  size: number;
}

type ViewMode = 'grid' | 'list';

// ============================================================================
// Constants & Utilities
// ============================================================================

const getFileTypeInfo = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  const types: Record<string, { icon: string; color: string; bg: string }> = {
    pdf: { icon: '📄', color: 'text-red-600', bg: 'bg-red-100' },
    doc: { icon: '📝', color: 'text-blue-600', bg: 'bg-blue-100' },
    docx: { icon: '📝', color: 'text-blue-600', bg: 'bg-blue-100' },
    txt: { icon: '📃', color: 'text-gray-600', bg: 'bg-gray-100' },
    jpg: { icon: '🖼️', color: 'text-green-600', bg: 'bg-green-100' },
    jpeg: { icon: '🖼️', color: 'text-green-600', bg: 'bg-green-100' },
    png: { icon: '🖼️', color: 'text-green-600', bg: 'bg-green-100' },
    gif: { icon: '🖼️', color: 'text-purple-600', bg: 'bg-purple-100' },
    mp4: { icon: '🎬', color: 'text-pink-600', bg: 'bg-pink-100' },
    mp3: { icon: '🎵', color: 'text-indigo-600', bg: 'bg-indigo-100' },
    zip: { icon: '📦', color: 'text-yellow-600', bg: 'bg-yellow-100' },
    dicom: { icon: '🔬', color: 'text-cyan-600', bg: 'bg-cyan-100' },
  };
  
  return types[ext] || { icon: '📁', color: 'text-gray-500', bg: 'bg-gray-100' };
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
};

const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
};

const isPdfFile = (filename: string): boolean => {
  return filename.toLowerCase().endsWith('.pdf');
};

const isTextFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['txt', 'md', 'json', 'xml', 'csv', 'log', 'html', 'css', 'js'].includes(ext);
};

// ============================================================================
// Components
// ============================================================================

interface PassphraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => void;
  isLoading: boolean;
  error?: string;
}

function PassphraseModal({ isOpen, onClose, onSubmit, isLoading, error }: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.trim()) {
      onSubmit(passphrase);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Unlock Your Records</h3>
            <p className="text-sm text-gray-500">Enter your passphrase to decrypt</p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="relative mb-4">
            <input
              type={showPassphrase ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter your passphrase"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all pr-12"
              autoFocus
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassphrase ? '🙈' : '👁️'}
            </button>
          </div>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 font-medium transition-all"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!passphrase.trim() || isLoading}
              className="flex-1 btn-neon py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Decrypting...
                </>
              ) : (
                <>
                  <span>🔓</span>
                  Unlock & View
                </>
              )}
            </button>
          </div>
        </form>
        
        <p className="mt-4 text-xs text-gray-400 text-center">
          Your passphrase never leaves your browser. Keys are decrypted locally.
        </p>
      </div>
    </div>
  );
}

interface FilePreviewModalProps {
  content: DecryptedContent | null;
  onClose: () => void;
  onDownload: () => void;
}

function FilePreviewModal({ content, onClose, onDownload }: FilePreviewModalProps) {
  if (!content) return null;

  const objectUrl = URL.createObjectURL(new Blob([content.data.buffer as ArrayBuffer], { type: content.contentType }));

  const renderPreview = () => {
    if (isImageFile(content.filename)) {
      return (
        <div className="flex justify-center bg-gray-100 rounded-xl p-4 max-h-[60vh] overflow-auto">
          <img 
            src={objectUrl} 
            alt={content.filename}
            className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
          />
        </div>
      );
    }

    if (isPdfFile(content.filename)) {
      return (
        <div className="w-full h-[60vh] bg-gray-100 rounded-xl overflow-hidden">
          <iframe 
            src={objectUrl} 
            className="w-full h-full"
            title={content.filename}
          />
        </div>
      );
    }

    if (isTextFile(content.filename)) {
      const textContent = new TextDecoder().decode(content.data);
      return (
        <div className="bg-gray-50 rounded-xl p-6 max-h-[60vh] overflow-auto">
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
            {textContent}
          </pre>
        </div>
      );
    }

    // Default: show file info
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl">
        <div className="text-6xl mb-4">{getFileTypeInfo(content.filename).icon}</div>
        <p className="text-gray-600 mb-2">Preview not available for this file type</p>
        <p className="text-sm text-gray-400">
          {content.contentType} • {(content.size / 1024).toFixed(1)} KB
        </p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-green-50 to-emerald-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg">✓</span>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                {content.filename}
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Decrypted</span>
              </h3>
              <p className="text-xs text-gray-500">
                {content.contentType} • {(content.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {renderPreview()}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <span>🔒</span>
            End-to-end encrypted • Decrypted locally in your browser
          </p>
          <button
            onClick={onDownload}
            className="btn-neon flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download File
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function RecordsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Decryption state
  const [selectedRecord, setSelectedRecord] = useState<FileRecord | null>(null);
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | undefined>();
  const [decryptedContent, setDecryptedContent] = useState<DecryptedContent | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth');
    }
  }, [authLoading, isAuthenticated, router]);

  // Load records
  useEffect(() => {
    if (user?.id) {
      loadRecords();
    }
  }, [user]);

  const loadRecords = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    
    try {
      const result = await getPatientRecords(user.id);
      if (result.data) {
        setRecords(result.data.records || []);
      }
    } catch (error) {
      console.error('Failed to load records:', error);
    }
    
    setIsLoading(false);
  };

  // Filter records
  const filteredRecords = records.filter(r => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return r.filename.toLowerCase().includes(query) || r.cid.toLowerCase().includes(query);
  });

  const handleViewRecord = (record: FileRecord) => {
    setSelectedRecord(record);
    setDecryptError(undefined);
    setShowPassphraseModal(true);
  };

  const handleDecrypt = useCallback(async (passphrase: string) => {
    if (!selectedRecord || !user) return;
    
    setIsDecrypting(true);
    setDecryptError(undefined);
    
    try {
      // Initialize Umbral
      await initUmbral();
      
      // Load private key from local storage
      const keyPair = await KeyManager.loadPrivateKey(user.id.toString(), passphrase);
      
      if (!keyPair) {
        throw new Error('Failed to unlock private key. Check your passphrase.');
      }
      
      // Check if this is owner's file (has capsule directly) or need to redeem
      let decryptedData: Uint8Array;
      
      // Helper to convert hex to bytes
      const hexToBytes = (hex: string): Uint8Array => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
      };
      
      if (selectedRecord.capsule && selectedRecord.encrypted_cek) {
        // Owner decryption flow:
        // 1. Decrypt the encrypted_cek using Umbral to get raw CEK
        // 2. Use CEK with AES-GCM to decrypt the file blob
        
        // Fetch the encrypted blob from Storacha
        const blobUrl = `https://${selectedRecord.cid}.ipfs.w3s.link`;
        
        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch encrypted file from Storacha');
        }
        
        const encryptedBlob = new Uint8Array(await response.arrayBuffer());
        console.log('Downloaded blob size:', encryptedBlob.length);
        
        // Step 1: Decrypt CEK using Umbral decryptOriginal
        const encryptedCekBytes = hexToBytes(selectedRecord.encrypted_cek);
        console.log('Encrypted CEK size:', encryptedCekBytes.length);
        
        const decryptedCek = await decryptOriginal(
          keyPair.secretKeyBytes,
          selectedRecord.capsule,
          encryptedCekBytes
        );
        console.log('Decrypted CEK size:', decryptedCek.length);
        
        // Step 2: Use CEK to decrypt file with AES-GCM
        // Blob format: 12-byte nonce + ciphertext (includes 16-byte GCM tag)
        const nonce = encryptedBlob.slice(0, 12);
        const ciphertext = encryptedBlob.slice(12);
        
        // Create proper ArrayBuffer copy
        const cekBuffer = new Uint8Array(decryptedCek).buffer;
        
        const key = await crypto.subtle.importKey(
          'raw',
          cekBuffer,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );
        
        const decryptedContent = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonce },
          key,
          ciphertext
        );
        
        decryptedData = new Uint8Array(decryptedContent);
        console.log('Decrypted file size:', decryptedData.length);
        
      } else {
        // Grantee flow - need to redeem access first
        const redeemResult = await redeemAccess({ cid: selectedRecord.cid });
        
        if (redeemResult.error || !redeemResult.data) {
          throw new Error(redeemResult.error || 'Failed to redeem access');
        }
        
        const { reenc_capsule, blob_url, capsule, encrypted_cek, owner_pubkey } = redeemResult.data;
        
        // Fetch encrypted blob
        const response = await fetch(blob_url);
        if (!response.ok) {
          throw new Error('Failed to fetch encrypted file');
        }
        
        const encryptedBlob = new Uint8Array(await response.arrayBuffer());
        console.log('Downloaded blob size:', encryptedBlob.length);
        
        // Decode re-encrypted capsule (cfrag) from base64
        const cfragBytes = Uint8Array.from(atob(reenc_capsule), c => c.charCodeAt(0));
        const cfragHex = Array.from(cfragBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Step 1: Decrypt CEK using re-encrypted capsule
        const encryptedCekBytes = hexToBytes(encrypted_cek);
        console.log('Encrypted CEK size:', encryptedCekBytes.length);
        
        const decryptedCek = await decryptReencrypted(
          keyPair.secretKeyBytes,
          owner_pubkey,
          capsule,
          [cfragHex],
          encryptedCekBytes
        );
        console.log('Decrypted CEK size:', decryptedCek.length);
        
        // Step 2: Use CEK to decrypt file with AES-GCM
        const nonce = encryptedBlob.slice(0, 12);
        const ciphertext = encryptedBlob.slice(12);
        
        // Create proper ArrayBuffer copy
        const cekBuffer = new Uint8Array(decryptedCek).buffer;
        
        const key = await crypto.subtle.importKey(
          'raw',
          cekBuffer,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );
        
        const decryptedContent = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonce },
          key,
          ciphertext
        );
        
        decryptedData = new Uint8Array(decryptedContent);
        console.log('Decrypted file size:', decryptedData.length);
      }
      
      // Zero out sensitive key data
      keyPair.secretKeyBytes.fill(0);
      keyPair.signingKeyBytes.fill(0);
      
      // Set decrypted content for preview
      setDecryptedContent({
        filename: selectedRecord.filename,
        contentType: getMimeType(selectedRecord.filename),
        data: decryptedData,
        size: decryptedData.length,
      });
      
      setShowPassphraseModal(false);
      
    } catch (error) {
      console.error('Decryption failed:', error);
      setDecryptError(
        error instanceof Error 
          ? error.message 
          : 'Decryption failed — check passphrase or access rights'
      );
    } finally {
      setIsDecrypting(false);
    }
  }, [selectedRecord, user]);

  const handleDownload = () => {
    if (!decryptedContent) return;
    
    const blob = new Blob([decryptedContent.data.buffer as ArrayBuffer], { type: decryptedContent.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = decryptedContent.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClosePreview = () => {
    setDecryptedContent(null);
    setSelectedRecord(null);
  };

  // Loading state
  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-gray-500">Loading...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="icon-box icon-box-indigo">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  My Health Records
                </h1>
                <p className="text-gray-500 flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                  {records.length} encrypted record{records.length !== 1 ? 's' : ''} • End-to-end encrypted
                </p>
              </div>
            </div>
            <button
              onClick={() => router.push('/upload')}
              className="btn-neon flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload Record
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="glass-card p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md w-full">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
              <input
                type="text"
                placeholder="Search records by name or CID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
            
            {/* View Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 mr-2">View:</span>
              <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'grid' 
                      ? 'bg-white shadow-md text-indigo-600' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Grid view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'list' 
                      ? 'bg-white shadow-md text-indigo-600' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="List view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Records */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute top-0 left-0 w-12 h-12 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
              </div>
              <p className="text-gray-500">Loading your records...</p>
            </div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="glass-card p-12 text-center">
            {records.length === 0 ? (
              <>
                <div className="mx-auto w-24 h-24 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mb-6">
                  <svg className="w-12 h-12 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No Health Records Yet</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  Your health records are protected with end-to-end encryption. 
                  Upload your first record to get started.
                </p>
                <button
                  onClick={() => router.push('/upload')}
                  className="btn-neon"
                >
                  Upload Your First Record
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Matching Records</h3>
                <p className="text-gray-500">Try a different search term.</p>
              </>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredRecords.map((record) => {
              const typeInfo = getFileTypeInfo(record.filename);
              return (
                <div
                  key={record.id}
                  className="glass-card hover:shadow-lg transition-all cursor-pointer group overflow-hidden card-lift"
                  onClick={() => handleViewRecord(record)}
                >
                  {/* File Icon */}
                  <div className={`${typeInfo.bg} p-8 flex items-center justify-center relative`}>
                    <span className="text-5xl group-hover:scale-110 transition-transform">{typeInfo.icon}</span>
                    <div className="absolute top-3 right-3">
                      <span className="px-2 py-1 bg-white/80 backdrop-blur-sm rounded-full text-xs font-medium text-gray-600">
                        🔒 Encrypted
                      </span>
                    </div>
                  </div>
                  
                  {/* File Info */}
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 truncate mb-1" title={record.filename}>
                      {record.filename}
                    </h3>
                    <p className="text-sm text-gray-500 mb-3">
                      {formatDate(record.created_at)}
                    </p>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleViewRecord(record); }}
                        className="flex-1 btn-neon text-sm py-2"
                      >
                        🔓 View & Decrypt
                      </button>
                    </div>
                    
                    {/* CID snippet */}
                    <div className="mt-3 pt-3 border-t">
                      <CidDisplay cid={record.cid} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Record
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    CID
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecords.map((record) => {
                  const typeInfo = getFileTypeInfo(record.filename);
                  return (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`${typeInfo.bg} w-10 h-10 rounded-xl flex items-center justify-center`}>
                            <span className="text-lg">{typeInfo.icon}</span>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 max-w-xs truncate">
                              {record.filename}
                            </div>
                            <div className="text-xs text-gray-500">
                              {record.filename.split('.').pop()?.toUpperCase()}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <CidDisplay cid={record.cid} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(record.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                          <span>🔒</span> Encrypted
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleViewRecord(record)}
                          className="btn-neon inline-flex items-center gap-2 text-sm"
                        >
                          🔓 View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Key not found notice */}
        {user && !KeyManager.hasKeypair(user.id.toString()) && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-4">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <h4 className="font-semibold text-amber-900">No Encryption Keys Found</h4>
              <p className="text-sm text-amber-700 mt-1">
                You need to set up your encryption keys before you can view encrypted records. 
                Go to your Profile to create or import your keys.
              </p>
              <button
                onClick={() => router.push('/profile')}
                className="mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
              >
                Set Up Keys →
              </button>
            </div>
          </div>
        )}

        {/* Passphrase Modal */}
        <PassphraseModal
          isOpen={showPassphraseModal}
          onClose={() => {
            setShowPassphraseModal(false);
            setSelectedRecord(null);
            setDecryptError(undefined);
          }}
          onSubmit={handleDecrypt}
          isLoading={isDecrypting}
          error={decryptError}
        />

        {/* File Preview Modal */}
        <FilePreviewModal
          content={decryptedContent}
          onClose={handleClosePreview}
          onDownload={handleDownload}
        />
      </div>
    </Layout>
  );
}
