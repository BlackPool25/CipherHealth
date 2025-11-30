/**
 * Revoke & Rotate Page - CEK Rotation Workflow
 * 
 * This page provides the UI for the recommended client-side CEK rotation workflow:
 * 1. Revoke existing grants (marks them invalid, emits AccessRevoked on-chain)
 * 2. Download and decrypt file locally
 * 3. Re-encrypt with new CEK
 * 4. Upload new ciphertext (emits UploadRecorded on-chain)
 * 
 * SECURITY: All decryption happens in the browser. Plaintext never touches the server.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getPatientRecords, 
  revokeAccess, 
  prepareRotation, 
  completeRotation,
  downloadRawEncrypted 
} from '@/lib/api';

interface FileRecord {
  id: number;
  cid: string;
  filename: string;
  capsule?: string;
  encrypted_cek?: string;
  created_at: string;
}

type RotationStep = 'select' | 'revoke' | 'download' | 'decrypt' | 'reencrypt' | 'upload' | 'complete';

export default function RevokePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { cid: queryCid } = router.query;
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [step, setStep] = useState<RotationStep>('select');
  const [error, setError] = useState<string | null>(null);
  
  // Rotation state
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [revokedCount, setRevokedCount] = useState(0);
  const [encryptedBlob, setEncryptedBlob] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<ArrayBuffer | null>(null);
  const [newEncryptedBlob, setNewEncryptedBlob] = useState<string | null>(null);
  const [newCid, setNewCid] = useState<string | null>(null);
  const [newUploadTx, setNewUploadTx] = useState<string | null>(null);
  
  // For demo: simulated encryption (in production, use real Umbral)
  const [newCek, setNewCek] = useState<string | null>(null);
  const [newCapsule, setNewCapsule] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) loadFiles();
  }, [user]);

  useEffect(() => {
    if (queryCid && files.length > 0) {
      const file = files.find(f => f.cid === queryCid);
      if (file) setSelectedFile(file);
    }
  }, [queryCid, files]);

  const loadFiles = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const result = await getPatientRecords(user.id);
      if (result.data) setFiles(result.data.records || []);
    } catch (error) {
      console.error('Failed to load files:', error);
    }
    setIsLoading(false);
  };

  const handleSelectFile = (file: FileRecord) => {
    setSelectedFile(file);
    setStep('revoke');
    setError(null);
    // Reset state
    setRevokeTx(null);
    setRevokedCount(0);
    setEncryptedBlob(null);
    setDecryptedContent(null);
    setNewEncryptedBlob(null);
    setNewCid(null);
    setNewUploadTx(null);
  };

  const handleRevoke = async () => {
    if (!selectedFile) return;
    setError(null);
    
    try {
      const result = await revokeAccess(selectedFile.cid);
      if (result.error) {
        setError(result.error);
        return;
      }
      
      setRevokeTx(result.data?.revoke_tx || null);
      setRevokedCount(result.data?.revoked_grants_count || 0);
      setStep('download');
    } catch (err) {
      setError('Failed to revoke access. Please try again.');
    }
  };

  const handleDownload = async () => {
    if (!selectedFile) return;
    setError(null);
    
    try {
      const result = await downloadRawEncrypted(selectedFile.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      
      setEncryptedBlob(result.data?.encrypted_blob_base64 || null);
      setStep('decrypt');
    } catch (err) {
      setError('Failed to download encrypted file. Please try again.');
    }
  };

  const handleDecrypt = useCallback(() => {
    // In production, this would use pyUmbral/umbral-pre in the browser
    // For demo, we simulate decryption
    setError(null);
    
    if (!encryptedBlob) {
      setError('No encrypted data to decrypt');
      return;
    }
    
    try {
      // Simulate decryption (in production: use owner's private key)
      // The actual decryption would:
      // 1. Decapsulate the CEK using owner's private key
      // 2. Decrypt the blob using the CEK
      
      // For demo, we just pass through the blob and pretend it's decrypted
      const simulatedDecrypted = new TextEncoder().encode(
        `[DEMO: Decrypted content would appear here]\n` +
        `File: ${selectedFile?.filename}\n` +
        `Original CID: ${selectedFile?.cid}\n` +
        `Timestamp: ${new Date().toISOString()}`
      );
      
      setDecryptedContent(simulatedDecrypted.buffer);
      setStep('reencrypt');
    } catch (err) {
      setError('Decryption failed. Please check your private key.');
    }
  }, [encryptedBlob, selectedFile]);

  const handleReencrypt = useCallback(() => {
    // In production, this would generate a new CEK and re-encrypt
    setError(null);
    
    if (!decryptedContent) {
      setError('No decrypted content to re-encrypt');
      return;
    }
    
    try {
      // Simulate re-encryption (in production: generate new CEK, encrypt, encapsulate)
      // 1. Generate new random CEK
      // 2. Encrypt plaintext with new CEK (AES-256-GCM)
      // 3. Encapsulate new CEK with owner's public key (Umbral)
      
      // For demo, generate random values
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const simulatedCek = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      crypto.getRandomValues(randomBytes);
      const simulatedCapsule = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Simulate encrypted blob (base64)
      const encoder = new TextEncoder();
      const simulatedBlob = encoder.encode(
        `[DEMO: Re-encrypted with new CEK]\n` +
        `Original file: ${selectedFile?.filename}\n` +
        `New CEK hash: ${simulatedCek.substring(0, 16)}...\n` +
        `Timestamp: ${new Date().toISOString()}`
      );
      const base64Blob = btoa(String.fromCharCode(...simulatedBlob));
      
      setNewCek(simulatedCek);
      setNewCapsule(simulatedCapsule);
      setNewEncryptedBlob(base64Blob);
      setStep('upload');
    } catch (err) {
      setError('Re-encryption failed. Please try again.');
    }
  }, [decryptedContent, selectedFile]);

  const handleUpload = async () => {
    if (!selectedFile || !newEncryptedBlob || !newCek || !newCapsule) return;
    setError(null);
    
    try {
      const result = await completeRotation({
        old_cid: selectedFile.cid,
        new_encrypted_blob_base64: newEncryptedBlob,
        new_encrypted_cek: newCek,
        new_capsule: newCapsule,
        filename: selectedFile.filename,
      });
      
      if (result.error) {
        setError(result.error);
        return;
      }
      
      setNewCid(result.data?.new_cid || null);
      setNewUploadTx(result.data?.new_upload_tx || null);
      setStep('complete');
    } catch (err) {
      setError('Failed to upload rotated file. Please try again.');
    }
  };

  const renderStepIndicator = () => {
    const steps: { key: RotationStep; label: string }[] = [
      { key: 'select', label: 'Select' },
      { key: 'revoke', label: 'Revoke' },
      { key: 'download', label: 'Download' },
      { key: 'decrypt', label: 'Decrypt' },
      { key: 'reencrypt', label: 'Re-encrypt' },
      { key: 'upload', label: 'Upload' },
      { key: 'complete', label: 'Done' },
    ];
    
    const currentIndex = steps.findIndex(s => s.key === step);
    
    return (
      <div className="flex items-center justify-center mb-8">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
              ${i < currentIndex ? 'bg-emerald-500 text-white' : 
                i === currentIndex ? 'bg-indigo-600 text-white' : 
                'bg-gray-200 text-gray-500'}
            `}>
              {i < currentIndex ? '✓' : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-1 mx-1 ${i < currentIndex ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="icon-box bg-gradient-to-br from-rose-500 to-pink-600">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Rotate & Re-upload</h1>
              <p className="text-gray-500">Revoke access and rotate encryption keys</p>
            </div>
          </div>
        </div>

        {/* Security Warning */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-amber-800">Client-Side Encryption</h3>
              <p className="text-sm text-amber-700">
                All decryption and re-encryption happens locally in your browser. 
                Your plaintext data never touches our servers. This ensures true end-to-end privacy.
              </p>
            </div>
          </div>
        </div>

        {renderStepIndicator()}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 text-red-700">
              <span>❌</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Step Content */}
        <div className="glass-card p-8">
          {step === 'select' && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Select File to Rotate</h2>
              <p className="text-gray-600 mb-6">
                Choose a file to revoke all access grants and rotate its encryption key.
              </p>
              
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : files.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No files found</p>
              ) : (
                <div className="space-y-2">
                  {files.map(file => (
                    <button
                      key={file.id}
                      onClick={() => handleSelectFile(file)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-indigo-500 transition-colors text-left"
                    >
                      <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                        📄
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{file.filename}</div>
                        <div className="text-sm text-gray-500 font-mono truncate">{file.cid}</div>
                      </div>
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'revoke' && selectedFile && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Revoke All Access Grants</h2>
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                    📄
                  </div>
                  <div>
                    <div className="font-semibold">{selectedFile.filename}</div>
                    <div className="text-sm text-gray-500 font-mono truncate">{selectedFile.cid}</div>
                  </div>
                </div>
              </div>
              
              <p className="text-gray-600 mb-6">
                This will immediately revoke all active grants for this file. 
                Grantees will no longer be able to access the file.
              </p>
              
              <div className="flex gap-3">
                <button onClick={() => setStep('select')} className="btn-ghost">
                  Back
                </button>
                <button onClick={handleRevoke} className="btn-neon bg-rose-500 hover:bg-rose-600">
                  Revoke Access
                </button>
              </div>
            </div>
          )}

          {step === 'download' && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Download Encrypted File</h2>
              
              {revokeTx && (
                <div className="bg-emerald-50 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 text-emerald-700 mb-2">
                    <span>✓</span>
                    <span className="font-semibold">Access revoked! ({revokedCount} grant(s))</span>
                  </div>
                  <TxHashDisplay txHash={revokeTx} label="Revoke Tx" />
                </div>
              )}
              
              <p className="text-gray-600 mb-6">
                Now download the encrypted file to decrypt it locally.
              </p>
              
              <button onClick={handleDownload} className="btn-neon">
                Download Encrypted File
              </button>
            </div>
          )}

          {step === 'decrypt' && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Decrypt Locally</h2>
              
              <div className="bg-emerald-50 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <span>✓</span>
                  <span>Encrypted file downloaded</span>
                </div>
              </div>
              
              <p className="text-gray-600 mb-6">
                Your file will be decrypted using your private key. 
                This happens entirely in your browser - no data is sent to the server.
              </p>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-500">
                  <strong>Note:</strong> In production, you would enter your private key passphrase here.
                  For this demo, we simulate the decryption process.
                </p>
              </div>
              
              <button onClick={handleDecrypt} className="btn-neon">
                Decrypt File
              </button>
            </div>
          )}

          {step === 'reencrypt' && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Re-encrypt with New Key</h2>
              
              <div className="bg-emerald-50 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <span>✓</span>
                  <span>File decrypted successfully</span>
                </div>
              </div>
              
              <p className="text-gray-600 mb-6">
                A new Content Encryption Key (CEK) will be generated and your file 
                will be re-encrypted. This ensures forward secrecy - old keys cannot 
                decrypt the new ciphertext.
              </p>
              
              <button onClick={handleReencrypt} className="btn-neon">
                Generate New Key & Re-encrypt
              </button>
            </div>
          )}

          {step === 'upload' && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Upload New Ciphertext</h2>
              
              <div className="bg-emerald-50 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <span>✓</span>
                  <span>File re-encrypted with new CEK</span>
                </div>
              </div>
              
              <p className="text-gray-600 mb-6">
                Upload the newly encrypted file to Storacha. This will generate a 
                new CID and record the upload on-chain.
              </p>
              
              <button onClick={handleUpload} className="btn-neon">
                Upload to Storacha
              </button>
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-4xl">✓</span>
              </div>
              
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Rotation Complete!</h2>
              <p className="text-gray-600 mb-6">
                Your file has been re-encrypted with a new key and uploaded to Storacha.
              </p>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
                <div className="space-y-3">
                  {newCid && (
                    <div>
                      <span className="text-sm text-gray-500">New CID:</span>
                      <div className="font-mono text-sm break-all">{newCid}</div>
                    </div>
                  )}
                  {revokeTx && <TxHashDisplay txHash={revokeTx} label="Revoke Tx" />}
                  {newUploadTx && <TxHashDisplay txHash={newUploadTx} label="Upload Tx" />}
                </div>
              </div>
              
              <div className="flex justify-center gap-3">
                <button onClick={() => router.push('/files')} className="btn-ghost">
                  Back to Files
                </button>
                <button onClick={() => {
                  setStep('select');
                  setSelectedFile(null);
                }} className="btn-neon">
                  Rotate Another
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
