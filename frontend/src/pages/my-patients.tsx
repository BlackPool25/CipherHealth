/**
 * My Patients Page for Hospitals
 * 
 * This page allows hospitals to:
 * - Request access to patients' records
 * - View pending access requests
 * - View approved patients they can upload for
 * - Upload records for approved patients
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import TxHashDisplay from '@/components/TxHashDisplay';
import { useAuth } from '@/contexts/AuthContext';
import {
  requestPatientAccess,
  getHospitalAccessRequests,
  getHospitalPatients,
  HospitalAccessRequestStatus,
  HospitalPatient,
} from '@/lib/api';

type TabType = 'patients' | 'requests';

export default function MyPatientsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  // State
  const [activeTab, setActiveTab] = useState<TabType>('patients');
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [requests, setRequests] = useState<HospitalAccessRequestStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [patientUuid, setPatientUuid] = useState('');
  const [requestPurpose, setRequestPurpose] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Auth check
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth');
    }
  }, [authLoading, isAuthenticated, router]);

  // Check user is a hospital
  useEffect(() => {
    if (user && user.role !== 'hospital') {
      router.push('/dashboard');
    }
  }, [user, router]);

  // Load data
  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    setIsLoading(true);
    setError('');

    const [patientsResult, requestsResult] = await Promise.all([
      getHospitalPatients(),
      getHospitalAccessRequests(),
    ]);

    if (patientsResult.data) {
      setPatients(patientsResult.data.patients);
    } else if (patientsResult.error) {
      setError(patientsResult.error);
    }

    if (requestsResult.data) {
      setRequests(requestsResult.data.requests);
    }

    setIsLoading(false);
  };

  const handleRequestAccess = async () => {
    if (!patientUuid.trim() || !requestPurpose.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setIsRequesting(true);
    setError('');
    setSuccess('');

    const result = await requestPatientAccess({
      patient_uuid: patientUuid.trim(),
      purpose: requestPurpose.trim(),
    });

    if (result.error) {
      setError(result.error);
      setIsRequesting(false);
      return;
    }

    if (result.data) {
      setSuccess(`Access request sent successfully. Request ID: ${result.data.request_id}. Waiting for patient approval.`);
      setShowRequestModal(false);
      setPatientUuid('');
      setRequestPurpose('');
      await loadData();
    }

    setIsRequesting(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            ⏳ Pending
          </span>
        );
      case 'approved':
      case 'active':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
            ✓ Approved
          </span>
        );
      case 'denied':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
            ✗ Denied
          </span>
        );
      case 'revoked':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
            ⊘ Revoked
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading || !user) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      </Layout>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const activePatients = patients.filter(p => p.status === 'active');

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">My Patients</h1>
          <p className="text-gray-600">
            Manage patient access and upload medical records for patients who have granted you permission.
          </p>
        </div>

        {/* Success/Error Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-emerald-700">{success}</p>
          </div>
        )}

        {/* Request Access Button */}
        <div className="mb-6">
          <button
            onClick={() => setShowRequestModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Request Patient Access
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('patients')}
              className={`pb-3 px-1 font-medium text-sm relative ${
                activeTab === 'patients'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Approved Patients
              {activePatients.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                  {activePatients.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`pb-3 px-1 font-medium text-sm relative ${
                activeTab === 'requests'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              My Requests
              {pendingRequests.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Approved Patients Tab */}
        {activeTab === 'patients' && (
          <div className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900">Approved Patients</h2>
              <p className="text-sm text-gray-500">
                Patients who have granted you permission to upload records
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : activePatients.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">👤</span>
                </div>
                <p className="text-gray-500">No patients have granted you access yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Request access to patients to upload medical records for them.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {activePatients.map((patient) => (
                  <div key={patient.patient_id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                          <span className="text-xl">👤</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {patient.patient_name || 'Patient (Profile incomplete)'}
                          </h3>
                          {/* Patient profile info */}
                          {patient.profile_completed && (
                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                              {patient.age && <span>{patient.age} yrs</span>}
                              {patient.gender && <span className="capitalize">• {patient.gender}</span>}
                              {patient.blood_group && <span>• {patient.blood_group}</span>}
                            </div>
                          )}
                          {/* Patient UUID */}
                          <p className="text-xs text-gray-400 font-mono mt-0.5">
                            UUID: {patient.patient_uuid}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {getStatusBadge(patient.status)}
                            {patient.tx_hash && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                ⛓ On-chain
                              </span>
                            )}
                            {!patient.profile_completed && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                Profile incomplete
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p className="text-gray-500">Access granted: {formatDate(patient.granted_at)}</p>
                          {patient.expires_at && (
                            <p className="text-amber-600">Expires: {formatDate(patient.expires_at)}</p>
                          )}
                          <p className="text-gray-400">{patient.file_count} files uploaded</p>
                        </div>
                        <button
                          onClick={() => router.push(`/upload?patient=${patient.patient_id}`)}
                          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                        >
                          Upload Records
                        </button>
                      </div>
                    </div>
                    {patient.tx_hash && (
                      <div className="mt-2 ml-16">
                        <TxHashDisplay txHash={patient.tx_hash} label="Grant TX" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Requests Tab */}
        {activeTab === 'requests' && (
          <div className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900">Access Requests</h2>
              <p className="text-sm text-gray-500">
                Track the status of your patient access requests
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-gray-500">No access requests yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Use the &quot;Request Patient Access&quot; button to request access to a patient.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {requests.map((request) => (
                  <div key={request.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          request.status === 'pending' ? 'bg-amber-100' :
                          request.status === 'approved' ? 'bg-emerald-100' :
                          request.status === 'denied' ? 'bg-red-100' : 'bg-gray-100'
                        }`}>
                          <span className="text-xl">👤</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {request.patient_name || 'Patient (Profile incomplete)'}
                          </h3>
                          {/* Patient profile info */}
                          {request.profile_completed && (
                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                              {request.age && <span>{request.age} yrs</span>}
                              {request.gender && <span className="capitalize">• {request.gender}</span>}
                              {request.blood_group && <span>• {request.blood_group}</span>}
                            </div>
                          )}
                          {/* Patient UUID */}
                          <p className="text-xs text-gray-400 font-mono mt-0.5">
                            UUID: {request.patient_uuid}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            <strong>Purpose:</strong> {request.purpose}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {getStatusBadge(request.status)}
                            {!request.profile_completed && (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                Profile incomplete
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="text-gray-500">Requested: {formatDate(request.created_at)}</p>
                        {request.processed_at && (
                          <p className="text-gray-400">Processed: {formatDate(request.processed_at)}</p>
                        )}
                        {request.tx_hash && (
                          <div className="mt-1">
                            <TxHashDisplay txHash={request.tx_hash} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Request Access Modal */}
        {showRequestModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">Request Patient Access</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Request permission to upload medical records for a patient
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* Patient UUID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Patient UUID
                  </label>
                  <input
                    type="text"
                    value={patientUuid}
                    onChange={(e) => setPatientUuid(e.target.value)}
                    placeholder="Enter patient's UUID (e.g., a1b2c3d4-e5f6-...)"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Ask the patient for their UUID from their profile page
                  </p>
                </div>

                {/* Purpose */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Purpose
                  </label>
                  <textarea
                    value={requestPurpose}
                    onChange={(e) => setRequestPurpose(e.target.value)}
                    placeholder="Describe why you need access to this patient's records..."
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h4 className="font-medium text-blue-900 flex items-center gap-2">
                    <span>ℹ️</span> How it works
                  </h4>
                  <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• Patient will receive your access request</li>
                    <li>• They can approve or deny your request</li>
                    <li>• Approval is recorded on the blockchain</li>
                    <li>• Once approved, you can upload records for them</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => {
                    setShowRequestModal(false);
                    setPatientUuid('');
                    setRequestPurpose('');
                  }}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestAccess}
                  disabled={isRequesting || !patientUuid.trim() || !requestPurpose.trim()}
                  className="flex-1 btn-primary disabled:opacity-50"
                >
                  {isRequesting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Sending Request...
                    </span>
                  ) : (
                    'Send Request'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
