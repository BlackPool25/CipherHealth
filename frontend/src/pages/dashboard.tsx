/**
 * Dashboard Page - Neo-Brutalist Design
 * User's main landing page showing records and navigation
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import NetworkCheck from '@/components/NetworkCheck';
import FileViewer from '@/components/FileViewer';
import HospitalInviteTokens from '@/components/HospitalInviteTokens';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { listFiles, listGrants, getHospitalPatients, HospitalPatient, getCurrentUser, getMySharedFiles, PatientGrantEntry, getPatientHospitals, HospitalAccess } from '@/lib/api';
import KeyManager from '@/lib/KeyManager';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FolderOpen,
  Upload,
  Users,
  ClipboardList,
  Shield,
  Eye,
  Share2,
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  ArrowRight,
  Building2,
  Key,
  Zap
} from 'lucide-react';

interface CombinedGrant {
  id: number;
  type: 'hospital' | 'patient';
  name: string;
  filename?: string;
  status: string;
  granted_at: string;
}

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
  const types: Record<string, { icon: string; bg: string }> = {
    pdf: { icon: '📄', bg: 'bg-[#FEF2F2]' },
    doc: { icon: '📝', bg: 'bg-[#EFF6FF]' },
    docx: { icon: '📝', bg: 'bg-[#EFF6FF]' },
    txt: { icon: '📃', bg: 'bg-gray-100' },
    jpg: { icon: '🖼️', bg: 'bg-[#ECFDF5]' },
    jpeg: { icon: '🖼️', bg: 'bg-[#ECFDF5]' },
    png: { icon: '🖼️', bg: 'bg-[#ECFDF5]' },
  };
  return types[ext] || { icon: '📁', bg: 'bg-gray-100' };
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
        className={`flex items-center gap-4 p-4 cursor-pointer transition-all duration-200 hover:bg-gray-50 ${isExpanded ? 'bg-gray-50' : ''}`}
        onClick={onToggle}
      >
        <div className={`${typeInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border-2 border-black`}>
          <span className="text-xl">{typeInfo.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-gray-900 truncate">{file.filename}</h4>
          <p className="text-sm text-gray-500 font-medium">{formatDate(file.created_at)}</p>
        </div>
        <Badge variant="success" className="hidden sm:flex">
          <Lock className="w-3 h-3" />
          Encrypted
        </Badge>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </div>

      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-2 ml-16 border-t-2 border-gray-100">
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1 font-bold">Content ID (CID)</p>
            <code className="text-xs text-gray-600 font-mono bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 block truncate">
              {file.cid.slice(0, 24)}...{file.cid.slice(-8)}
            </code>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={(e) => { e.stopPropagation(); onView(); }}
              size="sm"
              variant="teal"
            >
              <Eye className="w-4 h-4" />
              View & Decrypt
            </Button>
            <Button
              onClick={(e) => { e.stopPropagation(); onShare(); }}
              size="sm"
              variant="outline"
            >
              <Share2 className="w-4 h-4" />
              Share
            </Button>
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
  const [patientShares, setPatientShares] = useState<PatientGrantEntry[]>([]);
  const [activeHospitalAccess, setActiveHospitalAccess] = useState<HospitalAccess[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingGrants, setIsLoadingGrants] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [hasEncryptionKeys, setHasEncryptionKeys] = useState<boolean | null>(null);

  // Combine active hospital access (for patients) and patient shares
  const combinedGrants = useMemo<CombinedGrant[]>(() => {
    const hospitalAccessEntries: CombinedGrant[] = activeHospitalAccess
      .filter(h => h.status === 'active')
      .map(h => ({
        id: h.hospital_id,
        type: 'hospital' as const,
        name: h.hospital_name || 'Unknown Hospital',
        status: 'active',
        granted_at: h.granted_at || '',
      }));

    const patientGrantEntries: CombinedGrant[] = patientShares.map(p => ({
      id: p.grant_id,
      type: 'patient' as const,
      name: p.grantee_name || p.grantee_uuid.slice(0, 8) + '...',
      filename: p.filename,
      status: p.status,
      granted_at: p.granted_at,
    }));

    const all = [...hospitalAccessEntries, ...patientGrantEntries];
    return all.sort((a, b) => {
      if (!a.granted_at && !b.granted_at) return 0;
      if (!a.granted_at) return 1;
      if (!b.granted_at) return -1;
      return new Date(b.granted_at).getTime() - new Date(a.granted_at).getTime();
    });
  }, [activeHospitalAccess, patientShares]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id && !authLoading) {
      loadData();
    }
  }, [user, isHospital, authLoading]);

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

    if (userResult.data) {
      const hasServerKey = !!userResult.data.public_key;
      const hasLocalKey = KeyManager.hasKeypair(String(user.id));
      setHasEncryptionKeys(hasServerKey && hasLocalKey);
    }

    if (isHospital) {
      const patientsResult = await getHospitalPatients();
      if (patientsResult.data) {
        const activePatients = patientsResult.data.patients.filter(p => p.status === 'active');
        setHospitalPatients(activePatients);
      }
    } else {
      const [hospitalsResult, sharesResult] = await Promise.all([
        getPatientHospitals(),
        getMySharedFiles(),
      ]);

      if (hospitalsResult.data) {
        const activeAccess = hospitalsResult.data.hospitals.filter((h: HospitalAccess) => h.status === 'active');
        setActiveHospitalAccess(activeAccess);
      }

      if (sharesResult.data) {
        const activeShares = sharesResult.data.grants.filter(g => g.status === 'active');
        setPatientShares(activeShares);
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
            <div className="w-16 h-16 border-4 border-gray-200 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-[#14B8A6] rounded-full animate-spin"></div>
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
        <div className="mb-6 p-4 bg-[#FFFBEB] border-[3px] border-[#F59E0B] rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-[#FFC224] rounded-xl border-2 border-black flex items-center justify-center">
              <Key className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-[#B45309] mb-1">
                {isHospital ? 'Set Up Hospital Encryption Keys' : 'Set Up Encryption Keys'}
              </h3>
              <p className="text-[#92400E] text-sm mb-3 font-medium">
                {isHospital
                  ? 'You need encryption keys to decrypt patient files shared with you.'
                  : 'Set up encryption keys to securely receive and decrypt your health records.'}
              </p>
              <Link href="/profile">
                <Button variant="yellow" size="sm">
                  <Key className="w-4 h-4" />
                  Set Up Keys
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-16 h-16 rounded-2xl bg-[#14B8A6] border-[4px] border-black flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <span className="text-3xl">👋</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, <span className="highlight-teal px-2">{user?.username}</span>!
            </h1>
            <p className="text-gray-600 font-medium">
              Manage your health records securely on the blockchain
            </p>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card hoverable={true} className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#2F81F7] border-2 border-black flex items-center justify-center">
              <FolderOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{files.length}</p>
              <p className="text-sm text-gray-500 font-bold">Total Files</p>
            </div>
          </div>
        </Card>
        <Card hoverable={true} className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#10B981] border-2 border-black flex items-center justify-center">
              <Share2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{combinedGrants.length}</p>
              <p className="text-sm text-gray-500 font-bold">Active Grants</p>
            </div>
          </div>
        </Card>
        <Card hoverable={true} className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#FF6B7A] border-2 border-black flex items-center justify-center">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">100%</p>
              <p className="text-sm text-gray-500 font-bold">Encrypted</p>
            </div>
          </div>
        </Card>
        <Card hoverable={true} className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#8B5CF6] border-2 border-black flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{isCorrectNetwork ? 'Live' : '—'}</p>
              <p className="text-sm text-gray-500 font-bold">On Sepolia</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Quick Actions - Role Based */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {isHospital ? (
          <Link href="/upload">
            <Card hoverable={true} className="p-6 group cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-[#2F81F7] border-2 border-black flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900">Upload Record</h3>
                  <p className="text-sm text-gray-500 font-medium">Upload for patients</p>
                </div>
              </div>
            </Card>
          </Link>
        ) : (
          <Link href="/hospital-access">
            <Card hoverable={true} className="p-6 group cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-[#2F81F7] border-2 border-black flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Building2 className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900">Hospital Access</h3>
                  <p className="text-sm text-gray-500 font-medium">Manage who can upload</p>
                </div>
              </div>
            </Card>
          </Link>
        )}

        <Link href={isHospital ? "/my-patients" : "/hospital-access"}>
          <Card hoverable={true} className="p-6 group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-[#10B981] border-2 border-black flex items-center justify-center group-hover:scale-110 transition-transform">
                {isHospital ? <Users className="w-7 h-7 text-white" /> : <Shield className="w-7 h-7 text-white" />}
              </div>
              <div>
                <h3 className="font-bold text-lg text-gray-900">
                  {isHospital ? 'My Patients' : 'Grant Access'}
                </h3>
                <p className="text-sm text-gray-500 font-medium">
                  {isHospital ? 'View & request patients' : 'Share with providers'}
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href="/audit">
          <Card hoverable={true} className="p-6 group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-[#FF6B7A] border-2 border-black flex items-center justify-center group-hover:scale-110 transition-transform">
                <ClipboardList className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-gray-900">View Audit Log</h3>
                <p className="text-sm text-gray-500 font-medium">Track all activity</p>
              </div>
            </div>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Files */}
        <div className="lg:col-span-2">
          <Card hoverable={false} className="overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b-2 border-black">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#2F81F7] border-2 border-black flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {isHospital ? 'Patient Records' : 'Your Records'}
                  </h2>
                  <p className="text-sm text-gray-500 font-medium">
                    {isHospital
                      ? 'Manage files for your patients'
                      : `${files.length} encrypted file${files.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
              {isHospital && (
                <Link href="/upload">
                  <Button size="sm" variant="blue">
                    <Upload className="w-4 h-4" />
                    Upload
                  </Button>
                </Link>
              )}
            </div>

            {isHospital ? (
              /* Hospital View - Show patients list */
              <div className="p-4">
                {hospitalPatients.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-2xl bg-[#2F81F7] border-[3px] border-black flex items-center justify-center mx-auto mb-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <Users className="w-8 h-8 text-white" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">No Patients Yet</h3>
                    <p className="text-gray-500 mb-4 max-w-sm mx-auto text-sm font-medium">
                      Request access from patients to view and manage their health records
                    </p>
                    <Link href="/my-patients">
                      <Button variant="blue">Request Patient Access</Button>
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-gray-900">Your Patients ({hospitalPatients.length})</h3>
                      <Link href="/my-patients" className="text-[#2F81F7] text-sm font-bold hover:underline">
                        View All →
                      </Link>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {hospitalPatients.slice(0, 5).map((patient) => (
                        <Link
                          key={patient.patient_uuid}
                          href={`/patient-files?patientUuid=${patient.patient_uuid}`}
                          className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-black hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all group"
                        >
                          <div className="w-10 h-10 rounded-full bg-[#14B8A6] border-2 border-black flex items-center justify-center text-white font-bold">
                            {(patient.patient_name || 'P').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 truncate">
                              {patient.patient_name || 'Patient (Profile incomplete)'}
                            </p>
                            <p className="text-xs text-gray-500 font-medium">
                              {patient.file_count} files • Access {patient.expires_at ? 'expires ' + formatDate(patient.expires_at) : 'permanent'}
                            </p>
                          </div>
                          <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-black" />
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : isLoadingFiles ? (
              <div className="flex items-center justify-center h-32">
                <div className="relative">
                  <div className="w-10 h-10 border-3 border-gray-200 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-10 h-10 border-3 border-transparent border-t-[#14B8A6] rounded-full animate-spin"></div>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-12 px-6">
                <div className="w-20 h-20 rounded-2xl bg-gray-100 border-[3px] border-black flex items-center justify-center mx-auto mb-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <FileText className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">No records yet</h3>
                <p className="text-gray-500 mb-4 font-medium">
                  {isHospital
                    ? 'Upload health records for your patients'
                    : 'Your health records are protected with end-to-end encryption'}
                </p>
                {isHospital ? (
                  <Link href="/upload"><Button variant="teal">Upload a record</Button></Link>
                ) : (
                  <Link href="/hospital-access"><Button variant="teal">Manage Hospital Access</Button></Link>
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
                    onShare={() => router.push(`/hospital-access?section=patient`)}
                  />
                ))}

                {files.length > 5 && (
                  <div className="p-4">
                    <button
                      onClick={() => setShowAllFiles(!showAllFiles)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm font-bold text-gray-500 hover:text-black transition-colors"
                    >
                      {showAllFiles ? (
                        <><ChevronUp className="w-4 h-4" /> Show Less</>
                      ) : (
                        <><ChevronDown className="w-4 h-4" /> Show {files.length - 5} More Records</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Active Grants */}
        <div className="lg:col-span-1">
          <Card hoverable={false} className="overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b-2 border-black">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#10B981] border-2 border-black flex items-center justify-center">
                  <Share2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Active Grants</h2>
                  <p className="text-sm text-gray-500 font-medium">Hospital & patient shares</p>
                </div>
              </div>
            </div>

            {isLoadingGrants ? (
              <div className="flex items-center justify-center h-32">
                <div className="relative">
                  <div className="w-10 h-10 border-3 border-gray-200 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-10 h-10 border-3 border-transparent border-t-[#10B981] rounded-full animate-spin"></div>
                </div>
              </div>
            ) : combinedGrants.length === 0 ? (
              <div className="text-center py-8 px-6">
                <div className="w-16 h-16 rounded-2xl bg-[#ECFDF5] border-[3px] border-[#10B981] flex items-center justify-center mx-auto mb-3">
                  <Share2 className="w-8 h-8 text-[#10B981]" />
                </div>
                <p className="text-gray-500 text-sm font-medium mb-3">No active grants</p>
                <Link href="/hospital-access" className="text-sm text-[#10B981] hover:underline font-bold">
                  Share a record →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {combinedGrants.slice(0, 6).map((grant) => (
                  <div key={`${grant.type}-${grant.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full border-2 border-black flex items-center justify-center ${grant.type === 'hospital'
                          ? 'bg-[#2F81F7]'
                          : 'bg-[#14B8A6]'
                        }`}>
                        <span className="text-white text-sm">
                          {grant.type === 'hospital' ? '🏥' : grant.name?.charAt(0).toUpperCase() || '?'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 text-sm truncate">{grant.name}</p>
                        <p className="text-xs text-gray-500 font-medium">
                          {grant.type === 'hospital' ? 'Hospital Access' : 'Patient Share'}
                        </p>
                        {grant.granted_at && (
                          <p className="text-xs text-gray-400">{formatDate(grant.granted_at)}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="success" className="flex-shrink-0">
                      {grant.status}
                    </Badge>
                  </div>
                ))}

                {combinedGrants.length > 6 && (
                  <div className="p-4">
                    <Link href="/hospital-access" className="text-sm text-gray-500 hover:text-black font-bold">
                      View all grants →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Card>
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

      {/* Hospital Invite Tokens Section */}
      {isHospital && (
        <div className="mt-8">
          <HospitalInviteTokens />
        </div>
      )}
    </Layout>
  );
}
