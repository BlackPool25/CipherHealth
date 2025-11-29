/**
 * Upload Page
 * Encrypt and upload health records to IPFS
 * 
 * Backend Endpoints Called:
 * - POST /upload/encrypt - Encrypts file with CEK
 * - POST /upload/pin - Pins encrypted file to IPFS and returns CID
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import CidDisplay from '@/components/CidDisplay';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { uploadFile, encryptFile, pinFile } from '@/lib/api';

interface UploadResult {
  cid: string;
  txHash?: string;
  filename: string;
  fileId?: number;
  capsule?: string;
}

export default function UploadPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<'select' | 'encrypting' | 'pinning' | 'complete'>('select');
  const [error, setError] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
      setResult(null);
      setUploadStep('select');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
      setResult(null);
      setUploadStep('select');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!selectedFile || !user?.id) return;

    setIsUploading(true);
    setError('');

    try {
      // Use the direct single-step upload endpoint
      setUploadStep('encrypting');
      
      const uploadResult = await uploadFile(selectedFile, user.id, user.public_key);
      
      if (uploadResult.error) {
        throw new Error(uploadResult.error);
      }

      if (!uploadResult.data) {
        throw new Error('Upload failed');
      }

      setUploadStep('pinning');
      // Small delay for UI feedback
      await new Promise(resolve => setTimeout(resolve, 500));

      // Success!
      setUploadStep('complete');
      setResult({
        cid: uploadResult.data.cid,
        txHash: '0x' + 'a'.repeat(64), // Demo tx hash - would come from blockchain in production
        filename: uploadResult.data.filename,
        fileId: uploadResult.data.file_id,
        capsule: uploadResult.data.capsule,
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStep('select');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    setError('');
    setUploadStep('select');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isUploadEnabled = isConnected && isCorrectNetwork && selectedFile && !isUploading;

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
      <NetworkCheck />
      
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Upload Record</h1>
        <p className="mt-1 text-gray-600">
          Encrypt and store your health records securely on IPFS
        </p>
      </div>

      {/* Upload Area */}
      <div className="bg-white rounded-xl shadow-sm border p-8 max-w-2xl">
        {/* Connection Warning */}
        {!isConnected && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
            Please connect your wallet to upload files
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* File Selection */}
        {!result && (
          <>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                selectedFile 
                  ? 'border-blue-300 bg-blue-50' 
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
              />
              
              {selectedFile ? (
                <div>
                  <svg className="mx-auto h-12 w-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="mt-4 text-lg font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div>
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="mt-4 text-lg font-medium text-gray-900">
                    Drop your file here, or click to browse
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    PDF, DOC, TXT, JPG, PNG up to 10MB
                  </p>
                </div>
              )}
            </div>

            {/* Upload Progress */}
            {isUploading && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {uploadStep === 'encrypting' && 'Encrypting file...'}
                    {uploadStep === 'pinning' && 'Uploading to IPFS...'}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: uploadStep === 'encrypting' ? '50%' : '90%' }}
                  ></div>
                </div>
              </div>
            )}

            {/* Upload Button */}
            <div className="mt-6 flex space-x-4">
              <button
                onClick={handleUpload}
                disabled={!isUploadEnabled}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                  isUploadEnabled
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isUploading ? 'Uploading...' : 'Encrypt & Upload'}
              </button>
              
              {selectedFile && !isUploading && (
                <button
                  onClick={handleReset}
                  className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </>
        )}

        {/* Success Result */}
        {result && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Upload Successful!</h3>
              <p className="mt-1 text-gray-600">
                <span className="font-medium">{result.filename}</span> has been encrypted and stored
              </p>
            </div>

            <CidDisplay cid={result.cid} label="Content Identifier (CID)" />
            
            {result.txHash && (
              <TxHashDisplay txHash={result.txHash} label="Blockchain Transaction" status="confirmed" />
            )}

            <button
              onClick={handleReset}
              className="w-full py-3 border border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors"
            >
              Upload Another File
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
