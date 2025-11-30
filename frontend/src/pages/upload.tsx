/**
 * Upload Page - Modern Colorful File Upload
 * 
 * Hospitals use this page to upload records for patients.
 * Patients are redirected to dashboard (they can't upload).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { useWalletContext } from '@/contexts/WalletContext';
import { hospitalUploadFile, getHospitalPatients, HospitalPatient } from '@/lib/api';

interface UploadProgress {
  stage: 'idle' | 'encrypting' | 'uploading' | 'recording' | 'complete' | 'error';
  progress: number;
  message: string;
}

export default function UploadPage() {
  const router = useRouter();
  const { patient: patientIdParam } = router.query;
  const { user, isAuthenticated, isLoading: authLoading, isHospital } = useAuth();
  const { address } = useWalletContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    progress: 0,
    message: 'Ready to upload'
  });
  const [result, setResult] = useState<{ cid: string; txHash?: string; etherscanUrl?: string } | null>(null);
  
  // Hospital patient selection
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [selectedPatientUuid, setSelectedPatientUuid] = useState<string | null>(null);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  
  // Folder/Category selection
  const [selectedCategory, setSelectedCategory] = useState<string>('General');
  const categories = ['General', 'Lab Results', 'Imaging', 'Prescriptions', 'Referrals', 'Reports', 'Other'];

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  // Only hospitals can upload - redirect patients to dashboard
  useEffect(() => {
    if (!authLoading && isAuthenticated && !isHospital) {
      router.push('/dashboard');
    }
  }, [authLoading, isAuthenticated, isHospital, router]);

  // Load hospital's approved patients
  useEffect(() => {
    if (isHospital && isAuthenticated) {
      loadPatients();
    }
  }, [isHospital, isAuthenticated]);

  // Set selected patient from URL param (expects UUID)
  useEffect(() => {
    if (patientIdParam && typeof patientIdParam === 'string') {
      setSelectedPatientUuid(patientIdParam);
    }
  }, [patientIdParam]);

  const loadPatients = async () => {
    setIsLoadingPatients(true);
    const result = await getHospitalPatients();
    if (result.data) {
      setPatients(result.data.patients.filter(p => p.status === 'active'));
    }
    setIsLoadingPatients(false);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
      setUploadProgress({ stage: 'idle', progress: 0, message: 'File selected' });
      setResult(null);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      setUploadProgress({ stage: 'idle', progress: 0, message: 'File selected' });
      setResult(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    // Hospitals must select a patient to upload for
    if (!selectedPatientUuid) {
      setUploadProgress({ 
        stage: 'error', 
        progress: 0, 
        message: 'Please select a patient to upload for' 
      });
      return;
    }

    try {
      setUploadProgress({ stage: 'encrypting', progress: 20, message: 'Encrypting file for patient...' });
      await new Promise(r => setTimeout(r, 500));

      setUploadProgress({ stage: 'uploading', progress: 50, message: 'Uploading to decentralized storage...' });

      // Get selected patient's info
      const selectedPatient = patients.find(p => p.patient_uuid === selectedPatientUuid);
      
      // Upload for the selected patient using hospital upload endpoint
      const response = await hospitalUploadFile(selectedFile, selectedPatientUuid, selectedCategory);

      if (response.error) {
        throw new Error(response.error);
      }

      setUploadProgress({ stage: 'recording', progress: 80, message: 'Recording on blockchain...' });
      await new Promise(r => setTimeout(r, 500));

      setUploadProgress({ stage: 'complete', progress: 100, message: 'Upload complete!' });
      setResult({
        cid: response.data?.cid || 'Unknown',
        txHash: response.data?.upload_tx,
        etherscanUrl: response.data?.etherscan_url,
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadProgress({
        stage: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Upload failed'
      });
    }
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setUploadProgress({ stage: 'idle', progress: 0, message: 'Ready to upload' });
    setResult(null);
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

  const stages = [
    { id: 'encrypting', label: 'Encrypt', icon: '🔐' },
    { id: 'uploading', label: 'Upload', icon: '☁️' },
    { id: 'recording', label: 'Record', icon: '⛓️' },
    { id: 'complete', label: 'Done', icon: '✅' }
  ];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-pink">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Upload Record</h1>
              <p className="text-gray-500">Upload encrypted health records for your patients</p>
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="glass-card p-8">
          {!result ? (
            <>
              {/* Patient Selector for Hospitals */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Patient *
                </label>
                {isLoadingPatients ? (
                  <div className="animate-pulse h-12 bg-gray-100 rounded-xl"></div>
                ) : patients.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-amber-700 text-sm">
                      No approved patients. Request access from patients first.
                    </p>
                    <button 
                      onClick={() => router.push('/my-patients')} 
                      className="mt-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Go to My Patients →
                    </button>
                  </div>
                ) : (
                  <select
                    value={selectedPatientUuid || ''}
                    onChange={(e) => setSelectedPatientUuid(e.target.value || null)}
                    className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-gray-900"
                  >
                    <option value="">-- Select a patient --</option>
                    {patients.map((patient) => (
                      <option key={patient.patient_uuid} value={patient.patient_uuid}>
                        {patient.patient_username} (UUID: {patient.patient_uuid.slice(0, 8)}...)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Category Selector */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category / Folder
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full p-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-gray-900"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50' 
                    : selectedFile 
                      ? 'border-emerald-400 bg-emerald-50' 
                      : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                />
                
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto">
                      <span className="text-3xl">📄</span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{selectedFile.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                      className="text-sm text-gray-500 hover:text-red-500 transition-colors"
                    >
                      Remove file
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto">
                      <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Drop your file here</p>
                      <p className="text-sm text-gray-500">or click to browse</p>
                    </div>
                    <p className="text-xs text-gray-400">PDF, DOC, TXT, JPG, PNG up to 10MB</p>
                  </div>
                )}
              </div>

              {/* Progress */}
              {uploadProgress.stage !== 'idle' && uploadProgress.stage !== 'error' && (
                <div className="mt-8 space-y-4">
                  <div className="flex justify-between items-center">
                    {stages.map((stage, i) => {
                      const stageOrder = ['encrypting', 'uploading', 'recording', 'complete'];
                      const currentIndex = stageOrder.indexOf(uploadProgress.stage);
                      const stageIndex = stageOrder.indexOf(stage.id);
                      const isActive = stageIndex <= currentIndex;
                      const isCurrent = stage.id === uploadProgress.stage;
                      
                      return (
                        <div key={stage.id} className="flex items-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all ${
                            isActive 
                              ? isCurrent 
                                ? 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white animate-pulse' 
                                : 'bg-emerald-100 text-emerald-600' 
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            {stage.icon}
                          </div>
                          {i < stages.length - 1 && (
                            <div className={`w-12 h-1 mx-1 rounded-full transition-colors ${
                              stageIndex < currentIndex ? 'bg-emerald-400' : 'bg-gray-200'
                            }`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-gray-100 h-2 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${uploadProgress.progress}%` }}
                    />
                  </div>
                  <p className="text-center text-gray-600">{uploadProgress.message}</p>
                </div>
              )}

              {/* Error */}
              {uploadProgress.stage === 'error' && (
                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
                  <p className="font-medium">Upload Failed</p>
                  <p className="text-sm mt-1">{uploadProgress.message}</p>
                </div>
              )}

              {/* Upload Button */}
              <div className="mt-8 flex justify-center">
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile || !selectedPatientUuid || (uploadProgress.stage !== 'idle' && uploadProgress.stage !== 'error')}
                  className="btn-neon px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadProgress.stage !== 'idle' && uploadProgress.stage !== 'error' && uploadProgress.stage !== 'complete' 
                    ? 'Uploading...' 
                    : 'Upload Securely'}
                </button>
              </div>
              
              {/* Help text if no patient selected */}
              {!selectedPatientUuid && patients.length > 0 && (
                <p className="text-center text-amber-600 text-sm mt-2">
                  Please select a patient above to upload for
                </p>
              )}
            </>
          ) : (
            /* Success View */
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Complete!</h2>
              <p className="text-gray-500 mb-6">The health record has been securely stored for the patient</p>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
                <div className="mb-3">
                  <p className="text-sm text-gray-500 mb-1">Content ID (CID)</p>
                  <code className="text-sm text-indigo-600 break-all">{result.cid}</code>
                </div>
                {result.txHash && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Blockchain Transaction</p>
                    <a 
                      href={result.etherscanUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-800 break-all underline"
                    >
                      View on Etherscan →
                    </a>
                  </div>
                )}
              </div>
              
              <div className="flex gap-3 justify-center">
                <button onClick={() => router.push('/my-patients')} className="btn-neon">
                  My Patients
                </button>
                <button onClick={resetUpload} className="btn-ghost">
                  Upload Another
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {[
            { icon: '🔐', title: 'End-to-End Encryption', desc: 'Your files are encrypted before upload', color: 'indigo' },
            { icon: '🌐', title: 'Decentralized Storage', desc: 'Stored on IPFS for durability', color: 'purple' },
            { icon: '⛓️', title: 'Blockchain Verified', desc: 'Immutable proof of ownership', color: 'pink' }
          ].map((item) => (
            <div key={item.title} className="glass-card p-4 flex items-start gap-3">
              <div className={`icon-box icon-box-${item.color} w-10 h-10 text-sm`}>
                <span>{item.icon}</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
