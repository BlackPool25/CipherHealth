/**
 * Files Page - Google Drive-like File Manager with Folder Organization
 * 
 * For Patients: Shows their health records organized by category/folder
 * For Hospitals: Redirects to patient-files page for proper patient-centric view
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import FileViewer from '@/components/FileViewer';
import { useAuth } from '@/contexts/AuthContext';
import { getPatientRecords, renameFile } from '@/lib/api';
import { SEPOLIA_ETHERSCAN_TX } from '@/lib/constants';

interface FileRecord {
  id: number;
  cid: string;
  filename: string;
  display_name?: string;

  capsule?: string;
  encrypted_cek?: string;
  tx_hash?: string;
  created_at: string;
  category?: string;  // Category from database
  description?: string;  // Description/notes from hospital
}

type ViewMode = 'grid' | 'list';

// ============================================================================
// Compact CID/TxHash Display Helpers
// ============================================================================

/** Truncate a string to first N and last M characters with ellipsis */
const truncateMiddle = (str: string, startChars: number = 6, endChars: number = 4): string => {
  if (!str || str.length <= startChars + endChars + 3) return str || '';
  return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
};

/** Copy text to clipboard with feedback */
const copyToClipboard = async (text: string, onSuccess?: () => void) => {
  try {
    await navigator.clipboard.writeText(text);
    onSuccess?.();
  } catch (err) {
    console.error('Failed to copy:', err);
  }
};

// ============================================================================
// File Details Popup Component
// ============================================================================

interface FileDetailsPopupProps {
  file: FileRecord;
  onClose: () => void;
  onRename: (file: FileRecord) => void;
  onShare: (file: FileRecord) => void;
  onRevoke: (file: FileRecord) => void;
}

function FileDetailsPopup({ file, onClose, onRename, onShare, onRevoke }: FileDetailsPopupProps) {
  const [copiedField, setCopiedField] = useState<'cid' | 'tx' | null>(null);
  
  const handleCopy = (text: string, field: 'cid' | 'tx') => {
    copyToClipboard(text, () => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  const gatewayUrl = `https://w3s.link/ipfs/${file.cid}`;
  const etherscanUrl = file.tx_hash ? `${SEPOLIA_ETHERSCAN_TX}/${file.tx_hash}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="glass-card p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">File Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        
        <div className="space-y-4">
          {/* File Name */}
          <div>
            <label className="text-sm font-medium text-gray-500">File Name</label>
            <p className="text-gray-900 font-medium">{file.display_name || file.filename}</p>
          </div>
          
          {/* CID */}
          <div>
            <label className="text-sm font-medium text-gray-500">Content ID (CID)</label>
            <div className="flex items-start gap-2 mt-1">
              <code className="flex-1 text-sm font-mono bg-gray-100 p-3 rounded-lg break-all text-gray-800">
                {file.cid}
              </code>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleCopy(file.cid, 'cid')}
                  className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  title="Copy CID"
                >
                  {copiedField === 'cid' ? '✓' : '📋'}
                </button>
                <a
                  href={gatewayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition-colors text-center"
                  title="View on IPFS Gateway"
                >
                  🔗
                </a>
              </div>
            </div>
          </div>
          
          {/* Transaction Hash */}
          <div>
            <label className="text-sm font-medium text-gray-500">Transaction Hash</label>
            {file.tx_hash ? (
              <div className="flex items-start gap-2 mt-1">
                <code className="flex-1 text-sm font-mono bg-gray-100 p-3 rounded-lg break-all text-gray-800">
                  {file.tx_hash}
                </code>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleCopy(file.tx_hash!, 'tx')}
                    className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    title="Copy Transaction Hash"
                  >
                    {copiedField === 'tx' ? '✓' : '📋'}
                  </button>
                  <a
                    href={etherscanUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-green-100 hover:bg-green-200 rounded-lg transition-colors text-center"
                    title="View on Etherscan"
                  >
                    ⛓️
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 italic mt-1">Not recorded on-chain</p>
            )}
          </div>
          
          {/* Created At */}
          <div>
            <label className="text-sm font-medium text-gray-500">Uploaded</label>
            <p className="text-gray-900">{new Date(file.created_at).toLocaleString()}</p>
          </div>
          
          {/* Category */}
          {file.category && (
            <div>
              <label className="text-sm font-medium text-gray-500">Category</label>
              <p className="text-gray-900">{file.category}</p>
            </div>
          )}
          
          {/* Description */}
          {file.description && (
            <div>
              <label className="text-sm font-medium text-gray-500">Description / Notes</label>
              <p className="text-gray-900 bg-gray-50 p-2 rounded-lg mt-1">{file.description}</p>
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => onRename(file)} className="flex-1 btn-ghost py-2">
            ✏️ Rename
          </button>
          <button onClick={() => onShare(file)} className="flex-1 btn-ghost py-2">
            📤 Share
          </button>
          <button onClick={() => onRevoke(file)} className="flex-1 btn-ghost py-2 text-rose-600">
            🔄 Revoke
          </button>
        </div>
      </div>
    </div>
  );
}



// ============================================================================
// File Category Helpers
// ============================================================================

// Get category - prefer database category, fallback to extracting from filename
// If display_name is set, use that as the clean name
const getFileCategory = (file: FileRecord): { category: string; cleanName: string } => {
  // If display_name is set, use it (user renamed the file)
  if (file.display_name) {
    const category = file.category || 'General';
    return { category, cleanName: file.display_name };
  }
  
  // If we have a category from the database, use it
  if (file.category) {
    // Clean filename by removing category prefix if present
    const match = file.filename.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (match) {
      return { category: file.category, cleanName: match[2] };
    }
    return { category: file.category, cleanName: file.filename };
  }
  
  // Fallback: extract category from filename like "[Lab Results] blood_test.pdf"
  const match = file.filename.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return { category: match[1], cleanName: match[2] };
  }
  return { category: 'General', cleanName: file.filename };
};

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

const categoryIcons: Record<string, string> = {
  'General': '📁',
  'Lab Results': '🧪',
  'Imaging': '🩻',
  'Prescriptions': '💊',
  'Referrals': '📋',
  'Reports': '📊',
  'Other': '📎',
};

const categoryColors: Record<string, string> = {
  'General': 'bg-gray-50 border-gray-200',
  'Lab Results': 'bg-blue-50 border-blue-200',
  'Imaging': 'bg-purple-50 border-purple-200',
  'Prescriptions': 'bg-green-50 border-green-200',
  'Referrals': 'bg-amber-50 border-amber-200',
  'Reports': 'bg-indigo-50 border-indigo-200',
  'Other': 'bg-slate-50 border-slate-200',
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
  const { user, isAuthenticated, isLoading: authLoading, isHospital, isPatient } = useAuth();
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  
  // File details popup state
  const [detailsFile, setDetailsFile] = useState<FileRecord | null>(null);
  
  // Rename modal state
  const [renameModalFile, setRenameModalFile] = useState<FileRecord | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  // Hospitals should use patient-files page
  useEffect(() => {
    if (!authLoading && isAuthenticated && isHospital) {
      router.push('/patient-files');
    }
  }, [authLoading, isAuthenticated, isHospital, router]);

  useEffect(() => {
    if (user?.id && isPatient) loadFiles();
  }, [user, isPatient]);

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

  // Group files by category
  const filesByCategory = useMemo(() => {
    const grouped: Record<string, FileRecord[]> = {};
    
    files.forEach(file => {
      const { category } = getFileCategory(file);
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(file);
    });
    
    return grouped;
  }, [files]);

  const categories = Object.keys(filesByCategory);

  const displayedFiles = useMemo(() => {
    let result = selectedCategory 
      ? filesByCategory[selectedCategory] || []
      : files;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(f => 
        f.filename.toLowerCase().includes(query) ||
        f.cid.toLowerCase().includes(query)
      );
    }
    
    return result.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [files, filesByCategory, selectedCategory, searchQuery]);

  const handleViewFile = (file: FileRecord) => setSelectedFile(file);
  const handleShareFile = (file: FileRecord) => {
    router.push(`/access-requests?tab=grant&fileId=${file.id}`);
  };
  const handleRevokeFile = (file: FileRecord) => {
    router.push(`/revoke?cid=${file.cid}`);
  };
  
  const handleRenameClick = (file: FileRecord) => {
    const { cleanName } = getFileCategory(file);
    setRenameModalFile(file);
    setNewFileName(file.display_name || cleanName);
    setRenameError('');
  };
  
  const handleRenameSubmit = async () => {
    if (!renameModalFile || !user?.id || !newFileName.trim()) return;
    
    setIsRenaming(true);
    setRenameError('');
    
    try {
      const result = await renameFile(user.id, renameModalFile.id, newFileName.trim());
      if (result.error) {
        setRenameError(result.error);
      } else {
        // Update the file in local state
        setFiles(prev => prev.map(f => 
          f.id === renameModalFile.id 
            ? { ...f, display_name: newFileName.trim() } 
            : f
        ));
        setRenameModalFile(null);
      }
    } catch (error) {
      setRenameError('Failed to rename file');
    } finally {
      setIsRenaming(false);
    }
  };

  if (authLoading || isLoading) {
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

  if (!isAuthenticated || isHospital) return null;

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
                <h1 className="text-3xl font-bold text-gray-900">My Health Records</h1>
                <p className="text-gray-500">{files.length} encrypted record{files.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <button 
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1 rounded-lg transition-colors ${
                !selectedCategory 
                  ? 'bg-indigo-100 text-indigo-700 font-medium' 
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
            >
              📂 All Files
            </button>
            {selectedCategory && (
              <>
                <span className="text-gray-400">/</span>
                <span className="px-3 py-1 bg-indigo-100 text-indigo-700 font-medium rounded-lg">
                  {categoryIcons[selectedCategory] || '📁'} {selectedCategory}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Category Folders - Google Drive Style */}
        {!selectedCategory && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Folders</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {categories.length === 0 && !isLoading && (
                <div className="col-span-full text-center py-8 text-gray-500">
                  No folders yet. Records will be organized into folders when uploaded.
                </div>
              )}
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`glass-card p-4 text-center card-lift hover:shadow-lg transition-all group ${categoryColors[category] || 'bg-gray-50'}`}
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 bg-white shadow-sm group-hover:scale-110 transition-transform">
                    <span className="text-3xl">{categoryIcons[category] || '📁'}</span>
                  </div>
                  <p className="font-medium text-gray-900 truncate">{category}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {filesByCategory[category]?.length || 0} file{(filesByCategory[category]?.length || 0) !== 1 ? 's' : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search & View Toggle */}
        <div className="glass-card p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-md w-full">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
              <input
                type="text"
                placeholder={selectedCategory ? `Search in ${selectedCategory}...` : "Search all files..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
            
            <div className="flex items-center gap-3">
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

        {/* Section Title */}
        {selectedCategory && displayedFiles.length > 0 && (
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {categoryIcons[selectedCategory] || '📁'} {selectedCategory}
            <span className="text-gray-400 font-normal ml-2">
              ({displayedFiles.length} file{displayedFiles.length !== 1 ? 's' : ''})
            </span>
          </h2>
        )}

        {/* Files */}
        {displayedFiles.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {searchQuery ? 'No files found' : selectedCategory ? 'Empty folder' : 'No health records yet'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery 
                ? 'Try a different search term'
                : 'Your health records will appear here when hospitals upload them for you'}
            </p>
            {!searchQuery && !selectedCategory && (
              <button onClick={() => router.push('/hospital-access')} className="btn-neon">
                Manage Hospital Access
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {displayedFiles.map((file) => {
              const typeInfo = getFileTypeInfo(file.filename);
              const { cleanName, category } = getFileCategory(file);
              return (
                <div 
                  key={file.id} 
                  className="group bg-white hover:bg-gray-50 border border-gray-200 hover:border-indigo-300 rounded-xl p-4 cursor-pointer transition-all hover:shadow-md"
                  onClick={() => handleViewFile(file)}
                >
                  {/* File icon - larger, centered */}
                  <div className={`${typeInfo.bg} w-full aspect-square rounded-xl flex items-center justify-center mb-3 border border-gray-100`}>
                    <span className="text-4xl">{typeInfo.icon}</span>
                  </div>
                  
                  {/* File name */}
                  <h3 className="font-medium text-gray-900 text-sm truncate mb-0.5" title={cleanName}>
                    {cleanName}
                  </h3>
                  
                  {/* Category & date */}
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    {!selectedCategory ? (
                      <span className="truncate">{categoryIcons[category] || '📁'} {category}</span>
                    ) : (
                      <span>{formatDate(file.created_at)}</span>
                    )}
                  </div>
                  
                  {/* Hover actions - appear on hover */}
                  <div className="flex items-center justify-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDetailsFile(file); }}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                      title="Details"
                    >
                      ℹ️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRenameClick(file); }}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                      title="Rename"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleShareFile(file); }}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                      title="Share"
                    >
                      📤
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRevokeFile(file); }}
                      className="w-8 h-8 flex items-center justify-center bg-rose-100 hover:bg-rose-200 rounded-lg text-sm"
                      title="Revoke"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-gray-100">
              {displayedFiles.map((file) => {
                const typeInfo = getFileTypeInfo(file.filename);
                const { cleanName, category } = getFileCategory(file);
                return (
                  <div key={file.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`${typeInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100`}>
                        <span className="text-xl">{typeInfo.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{cleanName}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          {!selectedCategory && (
                            <span className="text-indigo-600">
                              {categoryIcons[category] || '📁'} {category}
                            </span>
                          )}
                          <span>•</span>
                          <span>{formatDate(file.created_at)}</span>
                        </div>
                      </div>
                      <span className="badge-success hidden sm:inline-flex">🔒 Encrypted</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleViewFile(file)} className="btn-neon text-sm py-2 px-4">
                          View
                        </button>
                        <button
                          onClick={() => setDetailsFile(file)}
                          className="btn-ghost text-sm py-2 px-3"
                          title="Show CID & TxHash"
                        >
                          ℹ️
                        </button>
                        <button
                          onClick={() => handleRenameClick(file)}
                          className="btn-ghost text-sm py-2 px-3"
                          title="Rename file"
                        >
                          ✏️
                        </button>
                        <button onClick={() => handleShareFile(file)} className="btn-ghost text-sm py-2 px-3">
                          Share
                        </button>
                        <button 
                          onClick={() => handleRevokeFile(file)} 
                          className="btn-ghost text-sm py-2 px-3 text-rose-600 hover:text-rose-700"
                          title="Revoke access and rotate encryption key"
                        >
                          🔄
                        </button>
                      </div>
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
      
      {/* File Details Popup */}
      {detailsFile && (
        <FileDetailsPopup
          file={detailsFile}
          onClose={() => setDetailsFile(null)}
          onRename={(file) => {
            setDetailsFile(null);
            handleRenameClick(file);
          }}
          onShare={(file) => {
            setDetailsFile(null);
            handleShareFile(file);
          }}
          onRevoke={(file) => {
            setDetailsFile(null);
            handleRevokeFile(file);
          }}
        />
      )}
      
      {/* Rename Modal */}
      {renameModalFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="glass-card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Rename File</h2>
            <p className="text-sm text-gray-500 mb-4">
              This changes the display name only. The CID and encryption remain unchanged.
            </p>
            
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-900 mb-4"
              placeholder="New file name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
            />
            
            {renameError && (
              <p className="text-sm text-red-600 mb-4">{renameError}</p>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={() => setRenameModalFile(null)}
                className="flex-1 btn-ghost py-3"
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                onClick={handleRenameSubmit}
                className="flex-1 btn-neon py-3"
                disabled={isRenaming || !newFileName.trim()}
              >
                {isRenaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
