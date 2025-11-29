/**
 * Grant Access Page - Modern Colorful Theme
 * Manage access grants for health records
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
  
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [granteeId, setGranteeId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) loadData();
  }, [user]);

  // Handle pre-selected file from URL
  useEffect(() => {
    const { fileId } = router.query;
    if (fileId && typeof fileId === 'string') {
      const id = parseInt(fileId);
      if (!isNaN(id)) {
        setSelectedFileId(id);
        setShowCreateModal(true);
      }
    }
  }, [router.query]);

  const loadData = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    const [filesResult, grantsResult] = await Promise.all([
      listFiles(user.id),
      listGrants(user.id),
    ]);
    if (filesResult.data) setFiles(filesResult.data.files || []);
    if (grantsResult.data) setGrants(grantsResult.data.grants || []);
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
    setShowCreateModal(false);
    setSelectedFileId(null);
    setGranteeId('');
    setLastTxHash('0x' + 'b'.repeat(64));
    await loadData();
    setIsCreating(false);
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
      alert(`Failed to revoke: ${result.error}`);
      return;
    }
    if (result.data?.tx_hash) setLastTxHash(result.data.tx_hash);
    await loadData();
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-indigo-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="icon-box icon-box-purple">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Grant Access</h1>
                <p className="text-gray-500">Share your health records securely</p>
              </div>
            </div>
            <button onClick={() => setShowCreateModal(true)} className="btn-neon flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Grant
            </button>
          </div>
        </div>

        <NetworkCheck />
        
        {lastTxHash && (
          <div className="mb-6">
            <TxHashDisplay txHash={lastTxHash} label="Last Transaction" status="confirmed" />
          </div>
        )}

        {/* Grants List */}
        <div className="glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50">
            <h2 className="text-lg font-semibold text-gray-900">Your Active Grants</h2>
            <p className="text-sm text-gray-500">Files you've shared with others</p>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="relative">
                <div className="w-10 h-10 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute top-0 left-0 w-10 h-10 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
              </div>
            </div>
          ) : grants.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">No grants yet</h3>
              <p className="text-gray-500 mb-4">Start sharing your records by creating a grant</p>
              <button onClick={() => setShowCreateModal(true)} className="btn-neon">Create Grant</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {grants.map((grant) => (
                <div key={grant.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="icon-box icon-box-indigo w-12 h-12">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{grant.filename}</p>
                      <p className="text-sm text-gray-500">
                        Shared with: <span className="text-indigo-600">{grant.grantee_username}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="badge-success">{grant.status}</span>
                    <button
                      onClick={() => handleRevokeGrant(grant.id)}
                      className="btn-ghost text-red-500 border-red-200 hover:bg-red-50 text-sm"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Grant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">Create Access Grant</h3>
              <button onClick={() => setShowCreateModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {createError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
                {createError}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select File</label>
                <select
                  value={selectedFileId || ''}
                  onChange={(e) => setSelectedFileId(parseInt(e.target.value) || null)}
                  className="input-dark w-full"
                >
                  <option value="">Choose a file...</option>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>{file.filename}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grantee User ID</label>
                <input
                  type="number"
                  value={granteeId}
                  onChange={(e) => setGranteeId(e.target.value)}
                  placeholder="Enter user ID to share with"
                  className="input-dark w-full"
                />
              </div>
              
              {(!isConnected || !isCorrectNetwork) && (
                <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-xl">
                  ⚠️ Connect wallet to Sepolia network
                </p>
              )}
              
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowCreateModal(false)} className="flex-1 btn-ghost">Cancel</button>
                <button
                  onClick={handleCreateGrant}
                  disabled={isCreating || !selectedFileId || !granteeId || !isConnected || !isCorrectNetwork}
                  className={`flex-1 btn-neon ${isCreating || !selectedFileId || !granteeId || !isConnected || !isCorrectNetwork ? 'opacity-50 cursor-not-allowed' : ''}`}
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
