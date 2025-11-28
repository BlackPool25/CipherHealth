/**
 * Grant Access Page
 * Manage access grants for health records
 * 
 * Backend Endpoints Called:
 * - GET /upload/files/{userId} - Lists user's files
 * - GET /grant/list/{userId} - Lists grants created by user
 * - POST /grant/create - Creates a new access grant
 * - POST /grant/revoke - Revokes an existing grant
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { listFiles, listGrants, createGrant, revokeGrant } from '@/lib/api';

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

export default function GrantAccessPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Create grant form state
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [granteeId, setGranteeId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    if (!user?.id) return;
    setIsLoading(true);

    const [filesResult, grantsResult] = await Promise.all([
      listFiles(user.id),
      listGrants(user.id),
    ]);

    if (filesResult.data) {
      setFiles(filesResult.data.files || []);
    }
    if (grantsResult.data) {
      setGrants(grantsResult.data.grants || []);
    }

    setIsLoading(false);
  };

  const handleCreateGrant = async () => {
    if (!selectedFileId || !granteeId || !user?.id) {
      setCreateError('Please fill in all fields');
      return;
    }

    setIsCreating(true);
    setCreateError('');

    const result = await createGrant({
      granter_id: user.id,
      grantee_id: parseInt(granteeId),
      file_id: selectedFileId,
    });

    if (result.error) {
      setCreateError(result.error);
      setIsCreating(false);
      return;
    }

    // Success - close modal and refresh
    setShowCreateModal(false);
    setSelectedFileId(null);
    setGranteeId('');
    setLastTxHash('0x' + 'b'.repeat(64)); // Demo tx hash
    await loadData();
    setIsCreating(false);
  };

  const handleRevokeGrant = async (grantId: number) => {
    if (!user?.id) return;

    if (!confirm('Are you sure you want to revoke this access grant?')) {
      return;
    }

    const result = await revokeGrant({
      grant_id: grantId,
      granter_id: user.id,
      emit_onchain: true,
    });

    if (result.error) {
      alert(`Failed to revoke grant: ${result.error}`);
      return;
    }

    if (result.data?.tx_hash) {
      setLastTxHash(result.data.tx_hash);
    }

    await loadData();
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
      <NetworkCheck />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Grant Access</h1>
          <p className="mt-1 text-gray-600">
            Share your health records with healthcare providers
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={!isConnected || !isCorrectNetwork || files.length === 0}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            isConnected && isCorrectNetwork && files.length > 0
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Create Grant
        </button>
      </div>

      {/* Last Transaction */}
      {lastTxHash && (
        <div className="mb-6">
          <TxHashDisplay txHash={lastTxHash} label="Last Transaction" status="confirmed" />
        </div>
      )}

      {/* Active Grants */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Your Access Grants</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : grants.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="mt-4">No access grants created yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={files.length === 0}
              className="mt-4 text-blue-600 hover:underline"
            >
              {files.length > 0 ? 'Create your first grant' : 'Upload a file first'}
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {grants.map((grant) => (
              <div key={grant.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {grant.grantee_username || `User #${grant.grantee_id}`}
                      </p>
                      <p className="text-sm text-gray-500">
                        Access to: {grant.filename || `File #${grant.file_id}`}
                      </p>
                    </div>
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

      {/* Create Grant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Create Access Grant</h3>
            </div>

            <div className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
                  {createError}
                </div>
              )}

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
                  {files.map((file) => (
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
                  placeholder="Enter user ID to share with"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  In production, this would be a user search/lookup
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedFileId(null);
                    setGranteeId('');
                    setCreateError('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGrant}
                  disabled={isCreating}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create Grant'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
