/**
 * Patient Files Page - Hospital view of patient's files
 * 
 * This page is for hospitals to browse files of patients they have access to.
 * Files are organized by patient and category/folder.
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import FileViewer from '@/components/FileViewer';
import { useAuth } from '@/contexts/AuthContext';
import { getHospitalPatients, getHospitalPatientFiles, HospitalPatient } from '@/lib/api';
import KeyManager from '@/lib/KeyManager';

interface FileRecord {
  id: number;
  cid: string;
  filename: string;
  capsule?: string;
  encrypted_cek?: string;
  tx_hash?: string;
  created_at: string;
  category?: string;
}

interface PatientWithFiles extends HospitalPatient {
  files: FileRecord[];
}

// Get category - prefer database category, fallback to extracting from filename
const getFileCategory = (file: FileRecord): { category: string; cleanName: string } => {
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
  const types: Record<string, { icon: string; bg: string }> = {
    pdf: { icon: '📄', bg: 'bg-red-50' },
    doc: { icon: '📝', bg: 'bg-blue-50' },
    docx: { icon: '📝', bg: 'bg-blue-50' },
    txt: { icon: '📃', bg: 'bg-gray-50' },
    jpg: { icon: '🖼️', bg: 'bg-emerald-50' },
    jpeg: { icon: '🖼️', bg: 'bg-emerald-50' },
    png: { icon: '🖼️', bg: 'bg-emerald-50' },
  };
  return types[ext] || { icon: '📁', bg: 'bg-gray-50' };
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

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

export default function PatientFilesPage() {
  const router = useRouter();
  const { patientUuid } = router.query;
  const { user, isAuthenticated, isLoading: authLoading, isHospital } = useAuth();
  
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<HospitalPatient | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [patientSearchQuery, setPatientSearchQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  // Redirect non-hospitals
  useEffect(() => {
    if (!authLoading && isAuthenticated && !isHospital) {
      router.push('/files');
    }
  }, [authLoading, isAuthenticated, isHospital, router]);

  // Load hospital's patients
  useEffect(() => {
    if (isHospital && user?.id) {
      loadPatients();
    }
  }, [isHospital, user?.id]);

  // Select patient from URL param
  useEffect(() => {
    if (patientUuid && patients.length > 0) {
      const patient = patients.find(p => p.patient_uuid === patientUuid);
      if (patient) {
        setSelectedPatient(patient);
        loadPatientFiles(patient.patient_uuid);
      }
    }
  }, [patientUuid, patients]);

  const loadPatients = async () => {
    setIsLoading(true);
    const result = await getHospitalPatients();
    if (result.data) {
      const activePatients = result.data.patients.filter(p => p.status === 'active');
      setPatients(activePatients);
    }
    setIsLoading(false);
  };

  const loadPatientFiles = async (patientUuid: string) => {
    setIsLoading(true);
    const result = await getHospitalPatientFiles(patientUuid);
    if (result.data) {
      setFiles(result.data.files || []);
    } else {
      console.error('Failed to load patient files:', result.error);
      setFiles([]);
    }
    setIsLoading(false);
  };

  const handleSelectPatient = (patient: HospitalPatient) => {
    setSelectedPatient(patient);
    setSelectedCategory(null);
    router.push(`/patient-files?patientUuid=${patient.patient_uuid}`, undefined, { shallow: true });
    loadPatientFiles(patient.patient_uuid);
  };

  // Filter patients by search query (name or UUID)
  const filteredPatients = useMemo(() => {
    if (!patientSearchQuery.trim()) return patients;
    const query = patientSearchQuery.toLowerCase();
    return patients.filter(p => 
      p.patient_username.toLowerCase().includes(query) ||
      p.patient_uuid.toLowerCase().includes(query)
    );
  }, [patients, patientSearchQuery]);

  // Group files by category
  const filesByCategory = useMemo(() => {
    const grouped: Record<string, FileRecord[]> = {};
    
    files.forEach(file => {
      const { category } = getFileCategory(file);
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push({ ...file, category });
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
        f.filename.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [files, filesByCategory, selectedCategory, searchQuery]);

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

  if (!isAuthenticated || !isHospital) return null;

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-emerald">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Patient Records</h1>
              <p className="text-gray-500">Browse and access patient health records</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar - Patient List */}
          <div className="lg:col-span-1">
            <div className="glass-card p-4">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span>👥</span> Your Patients
              </h2>
              
              {/* Patient Search */}
              <div className="mb-4">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                  <input
                    type="text"
                    placeholder="Search by name or UUID..."
                    value={patientSearchQuery}
                    onChange={(e) => setPatientSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              
              {filteredPatients.length === 0 && patients.length > 0 ? (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No patients match "{patientSearchQuery}"</p>
                </div>
              ) : patients.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm mb-3">No patients with active access</p>
                  <button
                    onClick={() => router.push('/my-patients')}
                    className="btn-ghost text-sm"
                  >
                    Request Access →
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredPatients.map((patient) => (
                    <button
                      key={patient.patient_uuid}
                      onClick={() => handleSelectPatient(patient)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selectedPatient?.patient_uuid === patient.patient_uuid
                          ? 'bg-indigo-100 border-2 border-indigo-300'
                          : 'hover:bg-gray-50 border-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
                          {patient.patient_username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {patient.patient_username}
                          </p>
                          <p className="text-xs text-gray-500">
                            {patient.file_count} files
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Content - Files */}
          <div className="lg:col-span-3">
            {!selectedPatient ? (
              <div className="glass-card p-12 text-center">
                <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">👈</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Select a Patient
                </h3>
                <p className="text-gray-500">
                  Choose a patient from the list to view their health records
                </p>
              </div>
            ) : (
              <>
                {/* Patient Header */}
                <div className="glass-card p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
                        {selectedPatient.patient_username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">
                          {selectedPatient.patient_username}
                        </h2>
                        <p className="text-sm text-gray-500">
                          Access expires: {selectedPatient.expires_at 
                            ? formatDate(selectedPatient.expires_at) 
                            : 'No expiry'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/upload?patient=${selectedPatient.patient_uuid}`)}
                      className="btn-neon flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload for Patient
                    </button>
                  </div>
                </div>

                {/* Category Folders */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-6">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`glass-card p-4 text-center card-lift ${
                      !selectedCategory ? 'ring-2 ring-indigo-500' : ''
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-2">
                      <span className="text-2xl">📂</span>
                    </div>
                    <p className="font-medium text-gray-900">All Files</p>
                    <p className="text-xs text-gray-500">{files.length} files</p>
                  </button>
                  
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={`glass-card p-4 text-center card-lift ${
                        selectedCategory === category ? 'ring-2 ring-indigo-500' : ''
                      }`}
                    >
                      <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-2">
                        <span className="text-2xl">{categoryIcons[category] || '📁'}</span>
                      </div>
                      <p className="font-medium text-gray-900">{category}</p>
                      <p className="text-xs text-gray-500">
                        {filesByCategory[category]?.length || 0} files
                      </p>
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="glass-card p-4 mb-4">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                    <input
                      type="text"
                      placeholder="Search files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Files List */}
                {displayedFiles.length === 0 ? (
                  <div className="glass-card p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">📭</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-2">No files found</h3>
                    <p className="text-gray-500 text-sm">
                      {searchQuery 
                        ? 'Try a different search term'
                        : 'No files uploaded for this patient yet'}
                    </p>
                  </div>
                ) : (
                  <div className="glass-card overflow-hidden">
                    <div className="divide-y divide-gray-100">
                      {displayedFiles.map((file) => {
                        const typeInfo = getFileTypeInfo(file.filename);
                        const { cleanName } = getFileCategory(file);
                        return (
                          <div
                            key={file.id}
                            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
                          >
                            <div className={`${typeInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center`}>
                              <span className="text-xl">{typeInfo.icon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-gray-900 truncate">{cleanName}</h3>
                              <p className="text-sm text-gray-500">{formatDate(file.created_at)}</p>
                            </div>
                            <span className="badge-success hidden sm:inline-flex">🔒 Encrypted</span>
                            <button
                              onClick={() => setSelectedFile(file)}
                              className="btn-neon text-sm py-2 px-4"
                            >
                              View
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
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
    </Layout>
  );
}
