/**
 * Hospital Invite Tokens Component
 * 
 * Allows hospitals to generate single-use invite tokens for patient registration.
 * Features:
 * - Generate new invite tokens with custom expiry
 * - View list of all generated tokens
 * - Copy tokens to clipboard
 * - See token status (used, expired)
 */

import React, { useState, useEffect } from 'react';
import { generateHospitalInvite, listHospitalInviteTokens } from '../lib/api';

interface InviteToken {
  token: string;
  created_at: string;
  expires_at: string | null;
  used: boolean;
  used_at: string | null;
  expired: boolean;
}

export default function HospitalInviteTokens() {
  const [tokens, setTokens] = useState<InviteToken[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState(1);

  // Fetch tokens on mount
  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    setIsLoading(true);
    setError(null);
    
    const result = await listHospitalInviteTokens();
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setTokens(result.data.tokens);
    }
    
    setIsLoading(false);
  };

  const handleGenerateToken = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);
    
    const expiresSeconds = expiryHours * 3600;
    const result = await generateHospitalInvite(expiresSeconds);
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setSuccessMessage(`Token generated! Expires at: ${new Date(result.data.expires_at).toLocaleString()}`);
      // Refresh token list
      fetchTokens();
    }
    
    setIsGenerating(false);
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      setError('Failed to copy token to clipboard');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString();
  };

  const getTokenStatus = (token: InviteToken) => {
    if (token.used) {
      return { label: 'Used', color: 'bg-gray-500' };
    }
    if (token.expired) {
      return { label: 'Expired', color: 'bg-red-500' };
    }
    return { label: 'Active', color: 'bg-green-500' };
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        Patient Invite Tokens
      </h2>
      
      <p className="text-gray-600 mb-6">
        Generate single-use invite tokens for patient registration. Each token can only be used once.
      </p>

      {/* Generate Token Section */}
      <div className="bg-blue-50 rounded-lg p-4 mb-6">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">
          Generate New Invite Token
        </h3>
        
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Token Expiry (hours)
            </label>
            <input
              type="number"
              min="1"
              max="168"
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <button
            onClick={handleGenerateToken}
            disabled={isGenerating}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? 'Generating...' : 'Generate Token'}
          </button>
        </div>
        
        {successMessage && (
          <div className="mt-3 p-2 bg-green-100 text-green-700 rounded">
            {successMessage}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Tokens List */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold text-gray-800">
            Generated Tokens
          </h3>
          <button
            onClick={fetchTokens}
            disabled={isLoading}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {isLoading && tokens.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Loading tokens...
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No tokens generated yet. Create your first invite token above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Token</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Status</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Created</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Expires</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const status = getTokenStatus(token);
                  return (
                    <tr key={token.token} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-2">
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                          {token.token.substring(0, 16)}...
                        </code>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`inline-block px-2 py-1 text-xs text-white rounded ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-sm text-gray-600">
                        {formatDate(token.created_at)}
                      </td>
                      <td className="py-3 px-2 text-sm text-gray-600">
                        {formatDate(token.expires_at)}
                      </td>
                      <td className="py-3 px-2">
                        {!token.used && !token.expired && (
                          <button
                            onClick={() => handleCopyToken(token.token)}
                            className={`text-sm px-3 py-1 rounded ${
                              copiedToken === token.token
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            } transition-colors`}
                          >
                            {copiedToken === token.token ? '✓ Copied!' : 'Copy'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Usage Instructions */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-medium text-gray-800 mb-2">How to use invite tokens:</h4>
        <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
          <li>Generate a new invite token with your desired expiry time</li>
          <li>Copy the token and share it with the patient</li>
          <li>The patient uses this token during registration</li>
          <li>Each token can only be used once</li>
        </ol>
      </div>
    </div>
  );
}
