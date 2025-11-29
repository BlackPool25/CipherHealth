/**
 * FileViewer Component
 * Displays and downloads encrypted files from the backend
 * Handles image preview and file download for various types
 */

import { useState } from 'react';
import { downloadFile } from '@/lib/api';

interface FileViewerProps {
  fileId: number;
  filename: string;
  cid: string;
  onClose: () => void;
  userPrivateKey?: string; // For owner decryption
  grantId?: number; // For grantee access
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
  onClose,
  userPrivateKey,
  grantId 
}: FileViewerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [privateKeyInput, setPrivateKeyInput] = useState(userPrivateKey || '');

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

  const handleDownload = async () => {
    if (!privateKeyInput) {
      setError('Please enter your private key to decrypt the file');
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
              <p className="text-gray-600 text-sm">
                Enter your private key to decrypt and view this file.
                Your key never leaves your browser.
              </p>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Private Key (hex)
                </label>
                <input
                  type="password"
                  value={privateKeyInput}
                  onChange={(e) => setPrivateKeyInput(e.target.value)}
                  placeholder="Enter your Umbral private key..."
                  className="input-dark w-full font-mono text-sm"
                />
              </div>

              <button
                onClick={handleDownload}
                disabled={isLoading || !privateKeyInput}
                className={`w-full btn-neon py-3 ${
                  isLoading || !privateKeyInput
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
                  'Decrypt & View'
                )}
              </button>
            </div>
          ) : (
            /* File Preview */
            <div className="space-y-4">
              {renderFilePreview()}
              
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
