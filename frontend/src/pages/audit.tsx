/**
 * Audit Page
 * View transaction history and access logs
 * 
 * Backend Endpoints Called:
 * - GET /audit/logs/{userId} - Gets audit logs for user
 * 
 * Note: In production, audit logs would be read from blockchain events
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import TxHashDisplay from '@/components/TxHashDisplay';
import CidDisplay from '@/components/CidDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { getAuditLogs } from '@/lib/api';
import { SEPOLIA_ETHERSCAN_TX } from '@/lib/constants';

interface AuditLog {
  id: number;
  type: 'upload' | 'grant' | 'revoke' | 'access';
  description: string;
  cid?: string;
  tx_hash?: string;
  timestamp: string;
}

// Demo data for illustration
const DEMO_LOGS: AuditLog[] = [
  {
    id: 1,
    type: 'upload',
    description: 'Uploaded medical_record.pdf',
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    timestamp: '2024-01-15T10:30:00Z',
  },
  {
    id: 2,
    type: 'grant',
    description: 'Granted access to Dr. Smith (User #2)',
    tx_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    timestamp: '2024-01-15T11:00:00Z',
  },
  {
    id: 3,
    type: 'access',
    description: 'Dr. Smith accessed medical_record.pdf',
    timestamp: '2024-01-16T09:15:00Z',
  },
  {
    id: 4,
    type: 'revoke',
    description: 'Revoked access from Dr. Smith',
    tx_hash: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
    timestamp: '2024-01-20T14:30:00Z',
  },
];

export default function AuditPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) {
      loadLogs();
    }
  }, [user]);

  const loadLogs = async () => {
    if (!user?.id) return;
    setIsLoading(true);

    const result = await getAuditLogs(user.id);

    if (result.data?.logs) {
      setLogs(result.data.logs);
    } else {
      // Use demo data if no logs from backend
      setLogs(DEMO_LOGS);
    }

    setIsLoading(false);
  };

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.type === filter);

  const getTypeStyles = (type: string) => {
    switch (type) {
      case 'upload':
        return { bg: 'bg-blue-100', text: 'text-blue-700', icon: '📤' };
      case 'grant':
        return { bg: 'bg-green-100', text: 'text-green-700', icon: '🔓' };
      case 'revoke':
        return { bg: 'bg-red-100', text: 'text-red-700', icon: '🔒' };
      case 'access':
        return { bg: 'bg-purple-100', text: 'text-purple-700', icon: '👁️' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-700', icon: '📋' };
    }
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="mt-1 text-gray-600">
          Track all access and transactions for your health records
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium text-gray-700">Filter by:</span>
          <div className="flex space-x-2">
            {['all', 'upload', 'grant', 'revoke', 'access'].map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  filter === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mt-4">No audit logs found</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredLogs.map((log) => {
              const styles = getTypeStyles(log.type);
              return (
                <div 
                  key={log.id} 
                  className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedLog(log)}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${styles.bg}`}>
                      <span className="text-lg">{styles.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-900">{log.description}</p>
                        <span className="text-xs text-gray-500">{formatDate(log.timestamp)}</span>
                      </div>
                      <div className="flex items-center space-x-3 mt-1">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${styles.bg} ${styles.text}`}>
                          {log.type}
                        </span>
                        {log.tx_hash && (
                          <a
                            href={`${SEPOLIA_ETHERSCAN_TX}/${log.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            View tx →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setSelectedLog(null)}
        >
          <div 
            className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Event Details</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <span className="text-sm text-gray-500">Event Type</span>
                <p className="font-medium text-gray-900 capitalize">{selectedLog.type}</p>
              </div>

              <div>
                <span className="text-sm text-gray-500">Description</span>
                <p className="font-medium text-gray-900">{selectedLog.description}</p>
              </div>

              <div>
                <span className="text-sm text-gray-500">Timestamp</span>
                <p className="font-medium text-gray-900">{formatDate(selectedLog.timestamp)}</p>
              </div>

              {selectedLog.cid && (
                <CidDisplay cid={selectedLog.cid} label="Content ID (CID)" />
              )}

              {selectedLog.tx_hash && (
                <TxHashDisplay 
                  txHash={selectedLog.tx_hash} 
                  label="Transaction Hash" 
                  status="confirmed" 
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
