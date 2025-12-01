/**
 * Dashboard Page - Modern Colorful Theme
 * User's main landing page showing records and navigation
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import FileViewer from '@/components/FileViewer';
import HospitalInviteTokens from '@/components/HospitalInviteTokens';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { listFiles, listGrants, getHospitalPatients, HospitalPatient, getCurrentUser } from '@/lib/api';
import KeyManager from '@/lib/KeyManager';

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

interface SelectedFile {
  id: number;
  filename: string;
  cid: string;
}

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function FileRow({ file, isExpanded, onToggle, onView, onShare }: {
  file: FileRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onShare: () => void;
}) {
  const typeInfo = getFileTypeInfo(file.filename);
  
  return (
    <div className="overflow-hidden">
      <div 
        className={`flex items-center gap-4 p-4 cursor-pointer transition-all duration-200 hover:bg-indigo-50/50 ${isExpanded ? 'bg-indigo-50/50' : ''}`}
        onClick={onToggle}
      >
        <div className={`${typeInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100`}>
          <span className="text-xl">{typeInfo.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 truncate">{file.filename}</h4>
          <p className="text-sm text-gray-500">{formatDate(file.created_at)}</p>
        </div>
        <span className="badge-success hidden sm:inline-flex items-center gap-1">
          🔒 Encrypted
        </span>
        <svg 
          className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-2 ml-16 border-t border-gray-100">
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1 font-medium">Content ID (CID)</p>
            <code className="text-xs text-gray-600 font-mono bg-gray-50 px-2 py-1 rounded">{file.cid.slice(0, 24)}...{file.cid.slice(-8)}</code>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onView(); }}
              className="btn-neon text-sm py-2 px-4"
            >
              View & Decrypt
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onShare(); }}
              className="btn-ghost text-sm py-2 px-4"
            >
              Share
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, isHospital } = useAuth();
  const { isConnected, isCorrectNetwork } = useWalletContext();
  
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [hospitalPatients, setHospitalPatients] = useState<HospitalPatient[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingGrants, setIsLoadingGrants] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [hasEncryptionKeys, setHasEncryptionKeys] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth');
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

    const [filesResult, grantsResult, userResult] = await Promise.all([
      listFiles(user.id),
      listGrants(user.id),
      getCurrentUser(),
    ]);

    if (filesResult.data) setFiles(filesResult.data.files || []);
    if (grantsResult.data) setGrants(grantsResult.data.grants || []);
    
    // Check if user has encryption keys set up
    if (userResult.data) {
      const hasServerKey = !!userResult.data.public_key;
      const hasLocalKey = KeyManager.hasKeypair(String(user.id));
      setHasEncryptionKeys(hasServerKey && hasLocalKey);
    }

    // Load hospital patients if user is a hospital
    if (isHospital) {
      const patientsResult = await getHospitalPatients();
      if (patientsResult.data) {
        const activePatients = patientsResult.data.patients.filter(p => p.status === 'active');
        setHospitalPatients(activePatients);
      }
    }

    setIsLoadingFiles(false);
    setIsLoadingGrants(false);
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
      <NetworkCheck />
      
      {/* Encryption Keys Warning Banner */}
      {hasEncryptionKeys === false && (
        <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚠️</span>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-800 mb-1">
                {isHospital ? 'Set Up Hospital Encryption Keys' : 'Set Up Encryption Keys'}
              </h3>
              <p className="text-amber-700 text-sm mb-3">
                {isHospital 
                  ? 'You need to set up encryption keys before you can decrypt patient files shared with you. Without keys, you cannot access any patient records.'
                  : 'You need to set up encryption keys to securely receive and decrypt your health records.'
                }
              </p>
              <Link 
                href="/profile"
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors"
              >
                <span>🔐</span>
                <span>Set Up Keys Now</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-1 shadow-lg shadow-indigo-500/25">
            <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
              <span className="text-3xl">👋</span>
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, <span className="gradient-text">{user?.username}</span>!
            </h1>
            <p className="text-gray-600">
              Manage your health records securely on the blockchain
            </p>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-5">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-indigo">
              <span className="text-white">📁</span>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{files.length}</p>
              <p className="text-sm text-gray-500 font-medium">Total Files</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-emerald">
              <span className="text-white">🔗</span>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{grants.length}</p>
              <p className="text-sm text-gray-500 font-medium">Active Grants</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-pink">
              <span className="text-white">🔒</span>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">100%</p>
              <p className="text-sm text-gray-500 font-medium">Encrypted</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-sky">
              <span className="text-white">⛓️</span>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{isCorrectNetwork ? 'Live' : '—'}</p>
              <p className="text-sm text-gray-500 font-medium">On Sepolia</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions - Role Based */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Upload - Only for Hospitals */}
        {isHospital ? (
          <Link 
            href="/upload"
            className="glass-card p-6 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 group card-lift"
          >
            <div className="flex items-center gap-4">
              <div className="icon-box icon-box-indigo group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-lg text-gray-900 group-hover:text-indigo-600 transition-colors">Upload Record</h3>
                <p className="text-sm text-gray-500">Upload for patients</p>
              </div>
            </div>
          </Link>
        ) : (
          <Link 
            href="/hospital-access"
            className="glass-card p-6 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 group card-lift"
          >
            <div className="flex items-center gap-4">
              <div className="icon-box icon-box-indigo group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-lg text-gray-900 group-hover:text-indigo-600 transition-colors">Hospital Access</h3>
                <p className="text-sm text-gray-500">Manage who can upload</p>
              </div>
            </div>
          </Link>
        )}
        
        <Link 
          href={isHospital ? "/my-patients" : "/access-requests?tab=grant"}
          className="glass-card p-6 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 group card-lift"
        >
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-emerald group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-lg text-gray-900 group-hover:text-emerald-600 transition-colors">
                {isHospital ? 'My Patients' : 'Grant Access'}
              </h3>
              <p className="text-sm text-gray-500">
                {isHospital ? 'View & request patients' : 'Share with providers'}
              </p>
            </div>
          </div>
        </Link>
        
        <Link 
          href="/audit"
          className="glass-card p-6 hover:shadow-xl hover:shadow-purple-500/10 transition-all duration-300 group card-lift"
        >
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-pink group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-lg text-gray-900 group-hover:text-purple-600 transition-colors">View Audit Log</h3>
              <p className="text-sm text-gray-500">Track all activity</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Files - Different view for hospitals vs patients */}
        <div className="lg:col-span-2">
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="icon-box icon-box-indigo">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {isHospital ? 'Patient Records' : 'Your Records'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {isHospital 
                      ? 'Manage files for your patients' 
                      : `${files.length} encrypted file${files.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
              {isHospital && (
                <Link href="/upload" className="btn-neon text-sm py-2 px-4">
                  + Upload
                </Link>
              )}
            </div>

            {isHospital ? (
              /* Hospital View - Show patients list */
              <div className="p-4">
                {hospitalPatients.length === 0 ? (
                  <div className="text-center py-6">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">👥</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Patients Yet</h3>
                    <p className="text-gray-500 mb-4 max-w-sm mx-auto text-sm">
                      Request access from patients to view and manage their health records
                    </p>
                    <Link href="/my-patients" className="btn-neon text-sm">
                      Request Patient Access
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900">Your Patients ({hospitalPatients.length})</h3>
                      <Link href="/my-patients" className="text-indigo-600 text-sm hover:underline">
                        View All →
                      </Link>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {hospitalPatients.slice(0, 5).map((patient) => (
                        <Link
                          key={patient.patient_uuid}
                          href={`/patient-files?patientUuid=${patient.patient_uuid}`}
                          className="flex items-center gap-3 p-3 rounded-xl hover:bg-indigo-50 transition-all group"
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
                            {(patient.patient_name || 'P').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate group-hover:text-indigo-600">
                              {patient.patient_name || 'Patient (Profile incomplete)'}
                            </p>
                            <p className="text-xs text-gray-400 font-mono truncate">
                              {patient.patient_uuid}
                            </p>
                            <p className="text-xs text-gray-500">
                              {patient.profile_completed && patient.age ? `${patient.age} yrs` : ''} 
                              {patient.profile_completed && patient.gender ? ` • ${patient.gender}` : ''}
                              {patient.profile_completed && patient.blood_group ? ` • ${patient.blood_group}` : ''}
                            </p>
                            <p className="text-xs text-gray-400">
                              {patient.file_count} files • Access {patient.expires_at ? 'expires ' + formatDate(patient.expires_at) : 'permanent'}
                            </p>
                          </div>
                          <svg className="w-5 h-5 text-gray-400 group-hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      ))}
                    </div>
                    {hospitalPatients.length > 5 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 text-center">
                        <Link href="/patient-files" className="text-indigo-600 text-sm hover:underline">
                          View all {hospitalPatients.length} patients →
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : isLoadingFiles ? (
              <div className="flex items-center justify-center h-32">
                <div className="relative">
                  <div className="w-8 h-8 border-3 border-indigo-100 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-8 h-8 border-3 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-12 px-6">
                <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">No records yet</h3>
                <p className="text-gray-500 mb-4">
                  {isHospital 
                    ? 'Upload health records for your patients' 
                    : 'Your health records are protected with end-to-end encryption'}
                </p>
                {isHospital ? (
                  <Link href="/upload" className="btn-neon">Upload a record</Link>
                ) : (
                  <Link href="/hospital-access" className="btn-neon">Manage Hospital Access</Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {(showAllFiles ? files : files.slice(0, 5)).map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isExpanded={expandedFileId === file.id}
                    onToggle={() => setExpandedFileId(expandedFileId === file.id ? null : file.id)}
                    onView={() => setSelectedFile({ id: file.id, filename: file.filename, cid: file.cid })}
                    onShare={() => router.push(`/access-requests?tab=grant&fileId=${file.id}`)}
                  />
                ))}
                
                {files.length > 5 && (
                  <div className="p-4">
                    <button
                      onClick={() => setShowAllFiles(!showAllFiles)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors"
                    >
                      {showAllFiles ? 'Show Less' : `Show ${files.length - 5} More Records`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Active Grants */}
        <div className="lg:col-span-1">
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="icon-box icon-box-emerald">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Active Grants</h2>
                  <p className="text-sm text-gray-500">Shared access</p>
                </div>
              </div>
            </div>

            {isLoadingGrants ? (
              <div className="flex items-center justify-center h-32">
                <div className="relative">
                  <div className="w-8 h-8 border-3 border-emerald-100 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-8 h-8 border-3 border-transparent border-t-emerald-500 rounded-full animate-spin"></div>
                </div>
              </div>
            ) : grants.length === 0 ? (
              <div className="text-center py-8 px-6">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">🔗</span>
                </div>
                <p className="text-gray-500 text-sm mb-3">No active grants</p>
                <Link href="/access-requests?tab=grant" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                  Share a record →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {grants.slice(0, 5).map((grant) => (
                  <div key={grant.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-md">
                        <span className="text-white font-bold text-sm">
                          {grant.grantee_username?.charAt(0).toUpperCase() || '?'}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{grant.grantee_username}</p>
                        <p className="text-xs text-gray-500">Has access</p>
                      </div>
                    </div>
                    <span className={`badge-${grant.status === 'active' ? 'success' : 'info'}`}>
                      {grant.status}
                    </span>
                  </div>
                ))}
                
                {grants.length > 5 && (
                  <div className="p-4">
                    <Link href="/access-requests?tab=mygrants" className="text-sm text-gray-500 hover:text-indigo-600 font-medium">
                      View all grants →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedFile && (
        <FileViewer
          fileId={selectedFile.id}
          filename={selectedFile.filename}
          cid={selectedFile.cid}
          onClose={() => setSelectedFile(null)}
        />
      )}

      {/* Hospital Invite Tokens Section - Only for Hospital Users */}
      {isHospital && (
        <div className="mt-8">
          <HospitalInviteTokens />
        </div>
      )}
    </Layout>
  );
}
