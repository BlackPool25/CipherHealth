/**
 * FileViewer Component
 * Displays and downloads encrypted files from the backend
 * Handles image preview and file download for various types
 * 
 * Supports two decryption modes:
 * 1. Owner decryption: Patient decrypts their own files using their passphrase
 * 2. PRE decryption: Hospital decrypts patient files using re-encryption (cfrag)
 */

import { useState } from 'react';
import { downloadFile, decryptFileForHospital } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import KeyManager from '@/lib/KeyManager';

interface FileViewerProps {
  fileId: number;
  filename: string;
  cid: string;
  description?: string; // Sensitive - only shown after decryption
  onClose: () => void;
  userPrivateKey?: string; // For owner decryption (deprecated - use passphrase)
  grantId?: number; // For grantee access
  isReencryption?: boolean; // True if hospital viewing patient's file (PRE mode)
  capsule?: string; // Original capsule (for PRE mode)
  encrypted_cek?: string; // Encrypted CEK (for PRE mode)
}

interface FileData {
  filename: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
}

export default function FileViewer({ 
  fileId, 
  filename, 
  cid, 
  description,
  onClose,
  userPrivateKey,
  grantId,
  isReencryption = false,
  capsule,
  encrypted_cek,
}: FileViewerProps) {
  const { user, isHospital } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState(userPrivateKey || '');
  
  // Determine if we need PRE mode (hospital viewing patient file)
  const needsPRE = isReencryption || isHospital;

  const isImageFile = (name: string, type: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
    return imageExtensions.some(ext => name.toLowerCase().endsWith(ext)) || 
           imageTypes.includes(type);
  };

  const isPdfFile = (name: string, type: string) => {
    return name.toLowerCase().endsWith('.pdf') || type === 'application/pdf';
  };

  const isTextFile = (name: string, type: string) => {
    const textExtensions = ['.txt', '.md', '.json', '.xml', '.csv', '.log'];
    const textTypes = ['text/plain', 'text/markdown', 'application/json', 'text/xml', 'text/csv'];
    return textExtensions.some(ext => name.toLowerCase().endsWith(ext)) || 
           textTypes.includes(type);
  };
  
  /**
   * Hospital PRE decryption flow (server-side):
   * 1. Load hospital's private key using passphrase
   * 2. Send secret key to server for full server-side decryption
   * 3. Server re-encrypts capsule → cfrag
   * 4. Server decrypts CEK using cfrag + hospital's key
   * 5. Server decrypts file and returns content
   * 
   * This is necessary because pyumbral (Python) and @nucypher/umbral-pre (WASM)
   * have incompatible serialization formats.
   */
  const handlePREDownload = async () => {
    if (!passphrase || !user?.id) {
      setError('Please enter your passphrase to decrypt the file');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Load hospital's private key using passphrase
      const keyPair = await KeyManager.loadPrivateKey(String(user.id), passphrase);
      
      if (!keyPair) {
        throw new Error('Could not decrypt your keys. Check your passphrase or set up encryption in Profile.');
      }
      
      // Convert secret key to hex for server-side decryption
      const secretKeyHex = Array.from(keyPair.secretKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Zero out key bytes after copying to hex
      keyPair.secretKeyBytes.fill(0);
      if (keyPair.signingKeyBytes) {
        keyPair.signingKeyBytes.fill(0);
      }
      
      // Request full server-side decryption
      const result = await decryptFileForHospital(fileId, secretKeyHex);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (!result.data) {
        throw new Error('Failed to decrypt file');
      }

      setFileData({
        filename: result.data.filename,
        content: result.data.content_base64,
        contentType: result.data.content_type,
        size: result.data.size,
      });

    } catch (err) {
      console.error('PRE decryption error:', err);
      setError(err instanceof Error ? err.message : 'Failed to decrypt file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    // If hospital viewing patient file, use PRE flow
    if (needsPRE) {
      return handlePREDownload();
    }
    
    // Try passphrase-based decryption first (preferred) - for patients viewing their own files
    if (passphrase && user?.id) {
      setIsLoading(true);
      setError(null);
      
      try {
        // Load private key from KeyManager using passphrase
        const keyPair = await KeyManager.loadPrivateKey(String(user.id), passphrase);
        
        if (!keyPair) {
          throw new Error('Could not decrypt keys. Check your passphrase or set up encryption in Profile.');
        }
        
        // Convert secretKeyBytes to hex string for the API
        const privateKeyHex = Array.from(keyPair.secretKeyBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        const result = await downloadFile(fileId, privateKeyHex, grantId);
        
        // Zero out sensitive data
        keyPair.secretKeyBytes.fill(0);
        
        if (result.error) {
          throw new Error(result.error);
        }

        if (!result.data) {
          throw new Error('No data received from server');
        }

        setFileData({
          filename: result.data.filename,
          content: result.data.content_base64,
          contentType: result.data.content_type,
          size: result.data.size,
        });

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to decrypt file');
      } finally {
        setIsLoading(false);
      }
      return;
    }
    
    // Fallback: use raw private key (advanced mode)
    if (!privateKeyInput) {
      setError('Please enter your passphrase to decrypt the file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await downloadFile(fileId, privateKeyInput, grantId);
      
      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.data) {
        throw new Error('No data received from server');
      }

      setFileData({
        filename: result.data.filename,
        content: result.data.content_base64,
        contentType: result.data.content_type,
        size: result.data.size,
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveFile = () => {
    if (!fileData) return;

    // Convert base64 to blob
    const byteCharacters = atob(fileData.content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: fileData.contentType });

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const getDataUrl = () => {
    if (!fileData) return '';
    return `data:${fileData.contentType};base64,${fileData.content}`;
  };

  const renderFilePreview = () => {
    if (!fileData) return null;

    const dataUrl = getDataUrl();

    if (isImageFile(fileData.filename, fileData.contentType)) {
      return (
        <div className="flex justify-center bg-gray-100 rounded-lg p-4">
          <img 
            src={dataUrl} 
            alt={fileData.filename}
            className="max-w-full max-h-96 object-contain rounded shadow"
          />
        </div>
      );
    }

    if (isPdfFile(fileData.filename, fileData.contentType)) {
      return (
        <div className="w-full h-96 bg-gray-100 rounded-lg">
          <iframe 
            src={dataUrl} 
            className="w-full h-full rounded-lg"
            title={fileData.filename}
          />
        </div>
      );
    }

    if (isTextFile(fileData.filename, fileData.contentType)) {
      try {
        const textContent = atob(fileData.content);
        return (
          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
              {textContent}
            </pre>
          </div>
        );
      } catch {
        return (
          <div className="text-gray-500 text-center py-8">
            Unable to display text content
          </div>
        );
      }
    }

    // Default: show file info and download button
    return (
      <div className="text-center py-8 bg-gray-50 rounded-lg">
        <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="mt-4 text-gray-600">
          Preview not available for this file type
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {fileData.contentType} • {(fileData.size / 1024).toFixed(1)} KB
        </p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{filename}</h3>
            <p className="text-xs text-indigo-600 font-mono truncate max-w-md">
              CID: {cid}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {!fileData ? (
            /* Decryption Form */
            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🔐</span>
                  <div>
                    <h4 className="font-medium text-indigo-900">Encrypted File</h4>
                    <p className="text-sm text-indigo-700">
                      Enter your encryption passphrase to decrypt and view this file.
                      Your keys never leave your browser.
                    </p>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Encryption Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your encryption passphrase..."
                  className="input-dark w-full"
                  onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
                />
                <p className="text-xs text-gray-500 mt-1">
                  This is the passphrase you set up in your Profile settings.
                </p>
              </div>

              <button
                onClick={handleDownload}
                disabled={isLoading || !passphrase}
                className={`w-full btn-neon py-3 ${
                  isLoading || !passphrase
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Decrypting...
                  </span>
                ) : (
                  '🔓 Decrypt & View'
                )}
              </button>

              {/* Advanced: Raw Private Key (for debugging/recovery) */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <svg 
                    className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Advanced: Use raw private key
                </button>
                
                {showAdvanced && (
                  <div className="mt-3 space-y-3 p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">
                      For recovery purposes only. Use your raw Umbral private key (hex format).
                    </p>
                    <input
                      type="password"
                      value={privateKeyInput}
                      onChange={(e) => setPrivateKeyInput(e.target.value)}
                      placeholder="Enter raw private key (hex)..."
                      className="input-dark w-full font-mono text-sm"
                    />
                    <button
                      onClick={() => {
                        setPassphrase(''); // Clear passphrase to use raw key
                        handleDownload();
                      }}
                      disabled={isLoading || !privateKeyInput}
                      className="w-full btn-ghost py-2 text-sm"
                    >
                      Decrypt with Raw Key
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* File Preview */
            <div className="space-y-4">
              {renderFilePreview()}
              
              {/* Description/Notes - Only shown after successful decryption */}
              {description && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">📝</span>
                    <div className="flex-1">
                      <h4 className="font-medium text-indigo-900 mb-1">Notes / Description</h4>
                      <p className="text-sm text-indigo-800 whitespace-pre-wrap">{description}</p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* File Info */}
              <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{fileData.filename}</p>
                  <p className="text-xs text-gray-500">
                    {fileData.contentType} • {(fileData.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={handleSaveFile}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Save File
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="btn-ghost"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
