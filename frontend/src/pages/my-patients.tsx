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
  hospitalWithdrawAccess,
} from '@/lib/api';

type TabType = 'patients' | 'requests';

// Collapsible Card Component for patients - Modern design matching hospital-access
interface CollapsiblePatientCardProps {
  patient: HospitalPatient | HospitalAccessRequestStatus;
  type: 'active' | 'request';
  isExpanded: boolean;
  onToggle: () => void;
  onAction?: (action: string) => void;
  isLoading?: boolean;
}

function CollapsiblePatientCard({ 
  patient, 
  type, 
  isExpanded, 
  onToggle, 
  onAction,
  isLoading
}: CollapsiblePatientCardProps) {
  const isActive = type === 'active';
  const p = patient as HospitalPatient;
  const r = patient as HospitalAccessRequestStatus;
  const status = isActive ? p.status : r.status;

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'active': return 'bg-emerald-500';
      case 'approved': return 'bg-emerald-500';
      case 'pending': return 'bg-amber-500';
      case 'denied': return 'bg-red-500';
      case 'revoked': return 'bg-orange-500';
      case 'expired': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getStatusBgLight = (s: string) => {
    switch (s) {
      case 'active': return 'bg-emerald-50 border-emerald-200';
      case 'approved': return 'bg-emerald-50 border-emerald-200';
      case 'pending': return 'bg-amber-50 border-amber-200';
      case 'denied': return 'bg-red-50 border-red-200';
      case 'revoked': return 'bg-orange-50 border-orange-200';
      case 'expired': return 'bg-gray-50 border-gray-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const formatDateShort = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateFull = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const patientName = isActive 
    ? (p.patient_name || 'Unknown Patient')
    : (r.patient_name || 'Unknown Patient');
  const patientUuid = isActive ? p.patient_uuid : r.patient_uuid;
  const profileCompleted = isActive ? p.profile_completed : r.profile_completed;

  return (
    <div 
      className={`border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer ${getStatusBgLight(status)}`}
      onClick={onToggle}
    >
      {/* Main Card - Always visible */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left - Patient info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Status indicator */}
            <div className={`w-10 h-10 rounded-lg ${getStatusColor(status)} flex items-center justify-center flex-shrink-0 text-white font-bold`}>
              {patientName.charAt(0).toUpperCase()}
            </div>
            
            {/* Patient details */}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 truncate">{patientName}</h3>
              
              {/* Profile info preview */}
              {isActive && profileCompleted && (
                <p className="text-sm text-gray-500 truncate">
                  {p.age && <span>{p.age} yrs</span>}
                  {p.age && p.gender && <span> • </span>}
                  {p.gender && <span className="capitalize">{p.gender}</span>}
                  {p.blood_group && <span> • {p.blood_group}</span>}
                </p>
              )}
              
              {/* Quick stats/info */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {/* Status badge */}
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                  status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  status === 'denied' ? 'bg-red-100 text-red-700' :
                  status === 'revoked' ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {status === 'active' ? '✓ Active' :
                   status === 'approved' ? '✓ Approved' :
                   status === 'pending' ? '⏳ Pending' :
                   status === 'denied' ? '✗ Denied' :
                   status === 'revoked' ? '↩ Revoked' :
                   status}
                </span>
                
                {/* On-chain badge */}
                {((isActive && p.tx_hash) || (!isActive && r.tx_hash)) && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                    ⛓ On-chain
                  </span>
                )}
                
                {/* Profile incomplete */}
                {!profileCompleted && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    Profile incomplete
                  </span>
                )}
                
                {/* Files count for active */}
                {isActive && p.file_count > 0 && (
                  <span className="text-xs text-indigo-600">📁 {p.file_count} files</span>
                )}
                
                {/* Date info */}
                {isActive && p.granted_at && (
                  <span className="text-xs text-gray-400">Since {formatDateShort(p.granted_at)}</span>
                )}
                {!isActive && (
                  <span className="text-xs text-gray-400">Requested {formatDateShort(r.created_at)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Right - Action buttons + expand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Quick action buttons */}
            {onAction && isActive && status === 'active' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onAction('upload'); }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                >
                  📤 Upload
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onAction('withdraw'); }}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoading ? '...' : '↩ Withdraw'}
                </button>
              </>
            )}
            
            {/* Expand/collapse indicator */}
            <div className="p-2">
              <svg 
                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-gray-200 bg-white p-4" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {/* Patient Details column */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Patient Details</h4>
              
              <p><span className="text-gray-400">UUID:</span> <span className="font-mono text-xs">{patientUuid}</span></p>
              
              {isActive && profileCompleted && (
                <>
                  {p.age && <p><span className="text-gray-400">Age:</span> {p.age} years</p>}
                  {p.gender && <p><span className="text-gray-400">Gender:</span> <span className="capitalize">{p.gender}</span></p>}
                  {p.blood_group && <p><span className="text-gray-400">Blood Group:</span> {p.blood_group}</p>}
                </>
              )}
              
              {!isActive && r.purpose && (
                <p><span className="text-gray-400">Purpose:</span> {r.purpose}</p>
              )}
            </div>

            {/* Access Info column */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Access Info</h4>
              
              {isActive && (
                <>
                  <p><span className="text-gray-400">Files Uploaded:</span> {p.file_count}</p>
                  <p><span className="text-emerald-600">Granted:</span> {formatDateFull(p.granted_at)}</p>
                  {p.expires_at && (
                    <p><span className="text-amber-600">Expires:</span> {formatDateFull(p.expires_at)}</p>
                  )}
                </>
              )}
              
              {!isActive && (
                <>
                  <p><span className="text-gray-400">Requested:</span> {formatDateFull(r.created_at)}</p>
                  {r.processed_at && (
                    <p>
                      <span className={status === 'approved' ? 'text-emerald-600' : status === 'denied' ? 'text-red-600' : 'text-gray-400'}>
                        Processed:
                      </span> {formatDateFull(r.processed_at)}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Transaction info */}
          {((isActive && p.tx_hash) || (!isActive && r.tx_hash)) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <TxHashDisplay txHash={isActive ? p.tx_hash! : r.tx_hash!} label="Transaction" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

  // Withdrawal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawPatient, setWithdrawPatient] = useState<HospitalPatient | null>(null);
  const [withdrawPassphrase, setWithdrawPassphrase] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  
  // Expanded card state for collapsible cards
  const [expandedPatientId, setExpandedPatientId] = useState<number | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(null);

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

  const handleWithdrawAccess = async () => {
    if (!withdrawPatient || !withdrawPassphrase.trim()) {
      setError('Please enter your passphrase');
      return;
    }

    setIsWithdrawing(true);
    setError('');
    setSuccess('');

    const result = await hospitalWithdrawAccess(
      withdrawPatient.patient_id,
      withdrawPassphrase.trim()
    );

    if (result.error) {
      setError(result.error);
      setIsWithdrawing(false);
      return;
    }

    if (result.data) {
      setSuccess(`Access to ${withdrawPatient.patient_name || 'patient'} has been withdrawn successfully.${result.data.tx_hash ? ' Transaction recorded on blockchain.' : ''}`);
      setShowWithdrawModal(false);
      setWithdrawPatient(null);
      setWithdrawPassphrase('');
      await loadData();
    }

    setIsWithdrawing(false);
  };

  const openWithdrawModal = (patient: HospitalPatient) => {
    setWithdrawPatient(patient);
    setShowWithdrawModal(true);
    setWithdrawPassphrase('');
    setError('');
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
          <div>
            {/* Section Header */}
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Approved Patients</h2>
              <p className="text-sm text-gray-500">
                Patients who have granted you permission to upload records
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : activePatients.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">👤</span>
                </div>
                <p className="text-gray-500">No patients have granted you access yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Request access to patients to upload medical records for them.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activePatients.map((patient) => (
                  <CollapsiblePatientCard
                    key={patient.patient_id}
                    patient={patient}
                    type="active"
                    isExpanded={expandedPatientId === patient.patient_id}
                    onToggle={() => setExpandedPatientId(
                      expandedPatientId === patient.patient_id ? null : patient.patient_id
                    )}
                    onAction={(action) => {
                      if (action === 'upload') {
                        router.push(`/upload?patient=${patient.patient_id}`);
                      } else if (action === 'withdraw') {
                        openWithdrawModal(patient);
                      }
                    }}
                    isLoading={isWithdrawing && withdrawPatient?.patient_id === patient.patient_id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Requests Tab */}
        {activeTab === 'requests' && (
          <div>
            {/* Section Header */}
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Access Requests</h2>
              <p className="text-sm text-gray-500">
                Track the status of your patient access requests
              </p>
            </div>

            {isLoading ? (
              <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-gray-500">No access requests yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Use the &quot;Request Patient Access&quot; button to request access to a patient.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <CollapsiblePatientCard
                    key={request.id}
                    patient={request}
                    type="request"
                    isExpanded={expandedRequestId === request.id}
                    onToggle={() => setExpandedRequestId(
                      expandedRequestId === request.id ? null : request.id
                    )}
                  />
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

        {/* Withdraw Access Modal */}
        {showWithdrawModal && withdrawPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4">
              <div className="p-6 border-b border-gray-100">
                <h3 className="text-xl font-semibold text-gray-900">Withdraw Access</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Voluntarily withdraw your access to {withdrawPatient.patient_name || 'this patient'}
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* Warning */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <h4 className="font-medium text-amber-900 flex items-center gap-2">
                    <span>⚠️</span> This action is permanent
                  </h4>
                  <ul className="text-sm text-amber-700 mt-2 space-y-1">
                    <li>• You will no longer be able to view this patient&apos;s records</li>
                    <li>• You will no longer be able to upload files for them</li>
                    <li>• To regain access, you must request it again</li>
                    <li>• This may be recorded on the blockchain</li>
                  </ul>
                </div>

                {/* Patient Info */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-sm text-gray-600">Patient:</p>
                  <p className="font-medium text-gray-900">{withdrawPatient.patient_name || 'Unknown'}</p>
                  <p className="text-xs text-gray-500 font-mono">{withdrawPatient.patient_uuid}</p>
                </div>

                {/* Passphrase Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Enter your passphrase to confirm
                  </label>
                  <input
                    type="password"
                    value={withdrawPassphrase}
                    onChange={(e) => setWithdrawPassphrase(e.target.value)}
                    placeholder="Your account passphrase"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => {
                    setShowWithdrawModal(false);
                    setWithdrawPatient(null);
                    setWithdrawPassphrase('');
                    setError('');
                  }}
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleWithdrawAccess}
                  disabled={isWithdrawing || !withdrawPassphrase.trim()}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {isWithdrawing ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Withdrawing...
                    </span>
                  ) : (
                    'Withdraw Access'
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
