/**
 * Files Page - Modern Colorful File Manager
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
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

const getFileTypeInfo = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, { icon: string; bg: string; text: string }> = {
    pdf: { icon: '📄', bg: 'bg-red-50', text: 'text-red-600' },
    doc: { icon: '📝', bg: 'bg-blue-50', text: 'text-blue-600' },
    docx: { icon: '📝', bg: 'bg-blue-50', text: 'text-blue-600' },
    txt: { icon: '📃', bg: 'bg-gray-50', text: 'text-gray-600' },
    jpg: { icon: '🖼️', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    jpeg: { icon: '🖼️', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    png: { icon: '🖼️', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  };
  return types[ext] || { icon: '📁', bg: 'bg-gray-50', text: 'text-gray-600' };
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
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
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) loadFiles();
  }, [user]);

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

  const filteredFiles = useMemo(() => {
    let result = [...files];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(f => 
        f.filename.toLowerCase().includes(query) ||
        f.cid.toLowerCase().includes(query)
      );
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.filename.localeCompare(b.filename);
        case 'date': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'type':
          const extA = a.filename.split('.').pop() || '';
          const extB = b.filename.split('.').pop() || '';
          return extA.localeCompare(extB);
        default: return 0;
      }
    });
    return result;
  }, [files, searchQuery, sortBy]);

  const handleViewFile = (file: FileRecord) => setSelectedFile(file);
  const handleShareFile = (file: FileRecord) => {
    router.push(`/access-requests?tab=grant&fileId=${file.id}`);
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
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="icon-box icon-box-emerald">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">My Files</h1>
                <p className="text-gray-500">{files.length} encrypted health record{files.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button onClick={() => router.push('/upload')} className="btn-neon flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload File
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="glass-card p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-md w-full">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
            
            <div className="flex items-center gap-3">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="input-dark text-sm"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
                <option value="type">Sort by Type</option>
              </select>
              
              <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-500 hover:text-gray-700'}`}
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
            <div className="relative">
              <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
              <div className="absolute top-0 left-0 w-12 h-12 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
            </div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {searchQuery ? 'No files found' : 'No files yet'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery ? 'Try a different search term' : 'Upload your first health record'}
            </p>
            {!searchQuery && (
              <button onClick={() => router.push('/upload')} className="btn-neon">
                Upload File
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredFiles.map((file) => {
              const typeInfo = getFileTypeInfo(file.filename);
              return (
                <div key={file.id} className="glass-card p-5 group card-lift">
                  <div className={`${typeInfo.bg} w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border border-gray-100`}>
                    <span className="text-2xl">{typeInfo.icon}</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 truncate mb-1">{file.filename}</h3>
                  <p className="text-sm text-gray-500 mb-3">{formatDate(file.created_at)}</p>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleViewFile(file)}
                      className="flex-1 btn-neon text-sm py-2"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleShareFile(file)}
                      className="btn-ghost text-sm py-2 px-3"
                    >
                      Share
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-gray-100">
              {filteredFiles.map((file) => {
                const typeInfo = getFileTypeInfo(file.filename);
                return (
                  <div key={file.id} className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors">
                    <div className={`${typeInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100`}>
                      <span className="text-xl">{typeInfo.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{file.filename}</h3>
                      <p className="text-sm text-gray-500">{formatDate(file.created_at)}</p>
                    </div>
                    <span className="badge-success hidden sm:inline-flex">🔒 Encrypted</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleViewFile(file)} className="btn-neon text-sm py-2 px-4">
                        View
                      </button>
                      <button onClick={() => handleShareFile(file)} className="btn-ghost text-sm py-2 px-3">
                        Share
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedFile && (
        <FileViewer
          fileId={selectedFile.id}
          filename={selectedFile.filename}
          cid={selectedFile.cid}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </Layout>
  );
}
