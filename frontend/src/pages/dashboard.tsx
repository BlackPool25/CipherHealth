/**
 * Dashboard Page
 * User's main landing page showing records and navigation
 * 
 * Backend Endpoints Called:
 * - GET /upload/files/{userId} - Lists user's uploaded files
 * - GET /grant/list/{userId} - Lists grants created by user
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import CidDisplay from '@/components/CidDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { listFiles, listGrants } from '@/lib/api';

interface FileRecord {
  id: number;
  filename: string;
  cid: string;
  created_at: string;
}

interface Grant {
  id: number;
  file_id: number;
  grantee_username: string;
  status: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingGrants, setIsLoadingGrants] = useState(false);

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

    setIsLoadingFiles(true);
    setIsLoadingGrants(true);

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

    setIsLoadingFiles(false);
    setIsLoadingGrants(false);
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
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {user?.username}!
        </h1>
        <p className="mt-1 text-gray-600">
          Manage your health records securely on the blockchain
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link 
          href="/upload"
          className="bg-blue-600 text-white p-6 rounded-xl hover:bg-blue-700 transition-colors"
        >
          <h3 className="font-semibold text-lg">Upload Record</h3>
          <p className="text-blue-100 text-sm mt-1">
            Encrypt and store a new health record
          </p>
        </Link>
        
        <Link 
          href="/grant-access"
          className="bg-green-600 text-white p-6 rounded-xl hover:bg-green-700 transition-colors"
        >
          <h3 className="font-semibold text-lg">Grant Access</h3>
          <p className="text-green-100 text-sm mt-1">
            Share records with healthcare providers
          </p>
        </Link>
        
        <Link 
          href="/audit"
          className="bg-purple-600 text-white p-6 rounded-xl hover:bg-purple-700 transition-colors"
        >
          <h3 className="font-semibold text-lg">View Audit Log</h3>
          <p className="text-purple-100 text-sm mt-1">
            Track all access and transactions
          </p>
        </Link>
      </div>

      {/* Recent Files */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Your Records</h2>
          <Link 
            href="/upload" 
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Upload New →
          </Link>
        </div>

        {isLoadingFiles ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No records uploaded yet</p>
            <Link 
              href="/upload" 
              className="text-blue-600 hover:underline mt-2 inline-block"
            >
              Upload your first record
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {files.slice(0, 3).map((file) => (
              <div key={file.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{file.filename}</span>
                  <span className="text-xs text-gray-500">{file.created_at}</span>
                </div>
                <CidDisplay cid={file.cid} showGatewayLink={false} />
              </div>
            ))}
            {files.length > 3 && (
              <p className="text-sm text-gray-500 text-center">
                And {files.length - 3} more records...
              </p>
            )}
          </div>
        )}
      </div>

      {/* Active Grants */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Active Grants</h2>
          <Link 
            href="/grant-access" 
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Manage →
          </Link>
        </div>

        {isLoadingGrants ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : grants.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No active grants</p>
            <Link 
              href="/grant-access" 
              className="text-blue-600 hover:underline mt-2 inline-block"
            >
              Share a record
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {grants.slice(0, 5).map((grant) => (
              <div 
                key={grant.id} 
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <span className="text-gray-700">
                  Shared with <span className="font-medium">{grant.grantee_username}</span>
                </span>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  grant.status === 'active' 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {grant.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
