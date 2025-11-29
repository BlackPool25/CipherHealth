/**
 * Files Page - Modern File Manager
 * 
 * A clean, modern file browser for viewing uploaded health records.
 * Features:
 * - Grid/List view toggle
 * - File type icons
 * - Search and filter
 * - Quick actions (view, download, share)
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import CidDisplay from '@/components/CidDisplay';
import TxHashDisplay from '@/components/TxHashDisplay';
import FileViewer from '@/components/FileViewer';
import { useAuth } from '@/contexts/AuthContext';
import { getPatientRecords } from '@/lib/api';

interface FileRecord {
  id: number;
  cid: string;
  filename: string;
  capsule?: string;
  encrypted_cek?: string;
  tx_hash?: string;
  created_at: string;
}

type ViewMode = 'grid' | 'list';
type SortBy = 'name' | 'date' | 'type';

// File type icons and colors
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
    json: { icon: '{ }', color: 'text-orange-600', bg: 'bg-orange-100' },
    csv: { icon: '📊', color: 'text-emerald-600', bg: 'bg-emerald-100' },
    xls: { icon: '📊', color: 'text-emerald-600', bg: 'bg-emerald-100' },
    xlsx: { icon: '📊', color: 'text-emerald-600', bg: 'bg-emerald-100' },
  };
  
  return types[ext] || { icon: '📁', color: 'text-gray-500', bg: 'bg-gray-100' };
};

// Format file size (placeholder - would need actual size from API)
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  
  return date.toLocaleDateString();
};

export default function FilesPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) {
      loadFiles();
    }
  }, [user]);

  const loadFiles = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    
    try {
      const result = await getPatientRecords(user.id);
      if (result.data) {
        setFiles(result.data.records || []);
      }
    } catch (error) {
      console.error('Failed to load files:', error);
    }
    
    setIsLoading(false);
  };

  // Filter and sort files
  const filteredFiles = useMemo(() => {
    let result = [...files];
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(f => 
        f.filename.toLowerCase().includes(query) ||
        f.cid.toLowerCase().includes(query)
      );
    }
    
    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.filename.localeCompare(b.filename);
        case 'date':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'type':
          const extA = a.filename.split('.').pop() || '';
          const extB = b.filename.split('.').pop() || '';
          return extA.localeCompare(extB);
        default:
          return 0;
      }
    });
    
    return result;
  }, [files, searchQuery, sortBy]);

  const handleViewFile = (file: FileRecord) => {
    setSelectedFile(file);
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
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">My Files</h1>
              <p className="mt-1 text-gray-500">
                {files.length} encrypted health record{files.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => router.push('/upload')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload File
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="flex items-center gap-4">
              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
                <option value="type">Sort by Type</option>
              </select>
              
              {/* View Toggle */}
              <div className="flex border rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  title="Grid view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
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

        {/* Files */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            {files.length === 0 ? (
              <>
                <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No files yet</h3>
                <p className="text-gray-500 mb-6">Upload your first encrypted health record to get started.</p>
                <button
                  onClick={() => router.push('/upload')}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Upload Your First File
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No matching files</h3>
                <p className="text-gray-500">Try a different search term.</p>
              </>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredFiles.map((file, idx) => {
              const typeInfo = getFileTypeInfo(file.filename);
              return (
                <div
                  key={idx}
                  className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow cursor-pointer group"
                  onClick={() => handleViewFile(file)}
                >
                  {/* File Icon Area */}
                  <div className={`${typeInfo.bg} p-8 rounded-t-xl flex items-center justify-center`}>
                    <span className="text-5xl">{typeInfo.icon}</span>
                  </div>
                  
                  {/* File Info */}
                  <div className="p-4">
                    <h3 className="font-medium text-gray-900 truncate mb-1" title={file.filename}>
                      {file.filename}
                    </h3>
                    <p className="text-sm text-gray-500 mb-3">
                      {formatDate(file.created_at)}
                    </p>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleViewFile(file); }}
                        className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                      >
                        View & Decrypt
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/grant-access`); }}
                        className="px-3 py-1.5 border text-sm rounded-lg hover:bg-gray-50"
                        title="Share file"
                      >
                        🔗
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredFiles.map((file, idx) => {
                  const typeInfo = getFileTypeInfo(file.filename);
                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`${typeInfo.bg} w-10 h-10 rounded-lg flex items-center justify-center mr-3`}>
                            <span className="text-xl">{typeInfo.icon}</span>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900 max-w-xs truncate">
                              {file.filename}
                            </div>
                            <div className="text-sm text-gray-500">
                              {file.filename.split('.').pop()?.toUpperCase()}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <CidDisplay cid={file.cid} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(file.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          🔒 Encrypted
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleViewFile(file)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          View & Decrypt
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(file.cid);
                          }}
                          className="text-gray-600 hover:text-gray-900"
                          title="Copy CID"
                        >
                          📋
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* File Viewer Modal - Uses FileViewer component for decryption with private key */}
        {selectedFile && (
          <FileViewer
            fileId={selectedFile.id}
            filename={selectedFile.filename}
            cid={selectedFile.cid}
            onClose={() => setSelectedFile(null)}
          />
        )}
      </div>
    </Layout>
  );
}
