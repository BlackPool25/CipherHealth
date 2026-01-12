/**
 * CipherHealth API Client
 * 
 * Comprehensive API client for interacting with the backend.
 * All endpoints match the FastAPI backend routes.
 */

import { API_BASE_URL } from './constants';

// =============================================================================
// HTTP Client Utilities
// =============================================================================

/**
 * Get the stored JWT token from localStorage
 */
function getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('auth_token');
}

/**
 * Set the JWT token in localStorage
 */
export function setAuthToken(token: string): void {
    if (typeof window !== 'undefined') {
        localStorage.setItem('auth_token', token);
    }
}

/**
 * Clear the JWT token from localStorage
 */
export function clearAuthToken(): void {
    if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token');
    }
}

/**
 * Make an authenticated API request
 */
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = getAuthToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Make a multipart form data request (for file uploads)
 */
async function apiFormRequest<T>(
    endpoint: string,
    formData: FormData
): Promise<T> {
    const token = getAuthToken();

    const headers: HeadersInit = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
}

// =============================================================================
// Type Definitions
// =============================================================================

// --- User Types ---

export type UserRole = 'patient' | 'hospital';

export interface User {
    id: number;
    uuid: string;
    username: string;
    email?: string;
    role: UserRole;
    public_key?: string;
}

export interface PatientProfile {
    id: number;
    user_id: number;
    name: string;
    dob?: string;
    aadhar_masked?: string;
    blood_group?: string;
    emergency_contact?: string;
    public_key: string;
    profile_cid?: string;
}

export interface HospitalProfile {
    id: number;
    user_id: number;
    name: string;
    registration_id_masked?: string;
    address?: string;
    contact_email?: string;
    contact_phone?: string;
    public_key: string;
}

// --- File/Record Types ---

export interface FileRecord {
    id: number;
    cid: string;
    filename: string;
    display_name?: string;
    category?: string;
    description?: string;
    capsule: string;
    encrypted_cek: string;
    tx_hash?: string;
    created_at: string;
}

export interface RecordsListResponse {
    records: FileRecord[];
    count: number;
}

// --- Access Types ---

export interface AccessRequest {
    id: number;
    cid: string;
    requester_pubkey: string;
    purpose: string;
    status: 'pending' | 'approved' | 'denied' | 'expired';
    expires_at?: string;
    tx_hash?: string;
    created_at: string;
}

export interface Grant {
    id: number;
    granter_id: number;
    grantee_id: number;
    grantee_username: string;
    file_id: number;
    filename: string;
    status: 'active' | 'revoked' | 'expired';
    expires_at?: string;
    tx_hash?: string;
    created_at: string;
}

export interface ApprovedGrant {
    id: number;
    cid: string;
    requester_pubkey: string;
    purpose: string;
    status: string;
    expires_at?: string;
    tx_hash?: string;
    created_at: string;
    time_remaining?: string;
    is_expired: boolean;
}

// --- Hospital-Patient Types ---

export interface HospitalPatient {
    id: number;
    patient_id: number;
    patient_uuid: string;
    hospital_id: number;
    name: string;
    public_key: string;
    status: 'active' | 'revoked';
    has_active_grant: boolean;
    last_access?: string;
    files_count: number;
    expires_at?: string;
}

export interface PendingHospitalRequest {
    id: number;
    patient_id: number;
    patient_name: string;
    hospital_id: number;
    status: 'pending' | 'approved' | 'denied';
    requested_at: string;
    hospital_name?: string;
    hospital_username?: string;
    purpose?: string;
}

export interface HospitalAccess {
    id: number;
    hospital_id: number;
    hospital_name: string;
    has_access: boolean;
    granted_at?: string;
    expires_at?: string;
    status: 'active' | 'revoked';
    hospital_username?: string;
    branch_name?: string;
    location?: string;
    revoked_at?: string;
    withdrawn_by_hospital?: boolean;
    file_count?: number;
    specializations?: string;
    purpose?: string;
    requested_at?: string;
    tx_hash?: string;
}

export interface HospitalInfo {
    id: number;
    uuid: string;
    name: string;
    public_key: string;
}

// --- Redeem Types ---

export interface RedeemAccessResponse {
    reenc_capsule: string; // Base64-encoded cfrag
    cid: string;
    blob_url: string;
    capsule: string;
    encrypted_cek: string;
    owner_pubkey: string;
    filename: string;
}

// --- Audit Types ---

export interface AuditLogEntry {
    id: number;
    event_type: 'upload' | 'grant' | 'access' | 'revoke' | 'rotation';
    actor_id: number;
    actor_name?: string;
    actor_role?: string;
    target_id?: number;
    target_name?: string;
    patient_id?: number;
    file_id?: number;
    cid?: string;
    filename?: string;
    details?: string;
    tx_hash?: string;
    timestamp?: string;
    block_number?: number;
    created_at: string;
}

// =============================================================================
// Authentication API
// =============================================================================

export interface RegisterRequest {
    username: string;
    password: string;
    email?: string;
    role: UserRole;
    invite_token?: string;
}

export interface RegisterResponse {
    user_id: number;
    uuid: string;
    role: UserRole;
    access_token: string;
    needs_profile_upload?: boolean;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
    user_id: number;
    uuid: string;
    role: UserRole;
    username: string;
}

/**
 * Register a new user (patient or hospital)
 */
export async function registerUser(data: RegisterRequest): Promise<RegisterResponse> {
    return apiRequest('/auth/register-v2', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * Login and get JWT token
 */
export async function loginUser(username: string, password: string): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });

    // Store the token
    setAuthToken(response.access_token);

    return response;
}

/**
 * Logout (clear stored token)
 */
export function logout(): void {
    clearAuthToken();
}

/**
 * Get current authenticated user's profile
 */
export async function getUserProfile(): Promise<User> {
    return apiRequest('/auth/me');
}

/**
 * Update user profile (including public key)
 */
export async function updateUserProfile(data: {
    public_key?: string;
    email?: string;
}): Promise<{ message: string }> {
    return apiRequest('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

/**
 * Verify user's password (for sensitive operations)
 */
export async function verifyPassword(password: string): Promise<{ valid: boolean }> {
    return apiRequest('/auth/verify-password', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });
}

/**
 * Create an invite code (hospital only)
 */
export async function createInviteCode(): Promise<{ invite_code: string; expires_at: string }> {
    return apiRequest('/auth/create-invite', { method: 'POST' });
}

// =============================================================================
// Patient Profile API
// =============================================================================

export interface CreatePatientProfileRequest {
    name: string;
    dob?: string;
    aadhar?: string;
    blood_group?: string;
    emergency_contact?: string;
    public_key: string;
}

/**
 * Create or update patient base profile
 */
export async function createPatientProfile(
    data: CreatePatientProfileRequest
): Promise<{ patient_id: number; public_key: string }> {
    return apiRequest('/patients/create-base-profile', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * Create patient profile with encrypted data stored on IPFS
 */
export async function createPatientProfileWithCid(data: {
    name: string;
    public_key: string;
    profile_cid: string;
    capsule: string;
    encrypted_cek: string;
}): Promise<{ patient_id: number; profile_cid: string }> {
    return apiRequest('/patients/create-base-profile-with-cid', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * Get patient profile by ID
 */
export async function getPatientProfile(patientId: number): Promise<PatientProfile> {
    return apiRequest(`/patients/profile/${patientId}`);
}

/**
 * Update patient profile
 */
export async function updatePatientProfile(
    patientId: number,
    data: Partial<CreatePatientProfileRequest>
): Promise<{ message: string }> {
    return apiRequest(`/patients/profile/${patientId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

// =============================================================================
// File Upload API
// =============================================================================

export interface UploadResponse {
    cid: string;
    file_id: number;
    tx_hash?: string;
    etherscan_url?: string;
}

/**
 * Upload and encrypt a file
 */
export async function uploadFile(
    file: File,
    patientId: number,
    ownerPublicKey?: string
): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patient_id', patientId.toString());
    if (ownerPublicKey) {
        formData.append('owner_public_key', ownerPublicKey);
    }

    return apiFormRequest('/upload/upload', formData);
}

/**
 * Hospital uploads a file for a patient
 */
export async function hospitalUploadFile(
    file: File,
    patientId: number,
    category?: string,
    description?: string
): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patient_id', patientId.toString());
    if (category) formData.append('category', category);
    if (description) formData.append('description', description);

    return apiFormRequest('/upload/hospital-upload', formData);
}

// =============================================================================
// Records API
// =============================================================================

/**
 * Get patient's records (files)
 */
export async function getPatientRecords(patientId: number): Promise<{
    data?: RecordsListResponse;
    error?: string;
}> {
    try {
        const response = await apiRequest<RecordsListResponse>(`/access/records/${patientId}`);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to get records' };
    }
}

export interface DecryptedFileResponse {
    data?: {
        filename: string;
        content_base64: string;
        content_type: string;
        size: number;
    };
    error?: string;
}

/**
 * Download and decrypt file by fileId (server-side decryption for patient files)
 */
export async function downloadFile(
    fileId: number,
    privateKeyHex: string,
    grantId?: number
): Promise<DecryptedFileResponse> {
    try {
        const response = await apiRequest<{
            filename: string;
            content_base64: string;
            content_type: string;
            size: number;
        }>("/upload/decrypt-file", {
            method: "POST",
            body: JSON.stringify({
                file_id: fileId,
                private_key_hex: privateKeyHex,
                grant_id: grantId,
            }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Download failed" };
    }
}

/**
 * Download encrypted file as raw blob by CID
 */
export async function downloadFileBlob(cid: string): Promise<Blob> {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/upload/download/${cid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
        throw new Error("Failed to download file");
    }

    return response.blob();
}

/**
 * Download raw encrypted bytes (for re-encryption flow)
 */
export async function downloadRawEncrypted(cid: string): Promise<ArrayBuffer> {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/upload/download-raw/${cid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
        throw new Error('Failed to download encrypted file');
    }

    return response.arrayBuffer();
}

/**
 * Get file metadata by CID
 */
export async function getFileMetadata(cid: string): Promise<FileRecord> {
    return apiRequest(`/upload/metadata/${cid}`);
}

/**
 * Update file display name or category
 */
export async function updateFileMetadata(
    fileId: number,
    data: { display_name?: string; category?: string }
): Promise<{ message: string }> {
    return apiRequest(`/upload/metadata/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

// =============================================================================
// Access Request API
// =============================================================================

/**
 * Request access to a file by CID
 */
export async function requestAccess(
    cid: string,
    requesterPubkey: string,
    purpose: string
): Promise<{ request_id: number; status: string }> {
    return apiRequest('/access/request-access', {
        method: 'POST',
        body: JSON.stringify({
            cid,
            requester_pubkey: requesterPubkey,
            purpose,
        }),
    });
}

/**
 * Approve an access request (file owner only)
 */
export async function approveAccess(
    requestId: number,
    expirySeconds?: number,
    kfragHex?: string,
    verifyingKeyHex?: string
): Promise<{ granted: boolean; tx_hash?: string; etherscan_url?: string }> {
    return apiRequest('/access/approve-access', {
        method: 'POST',
        body: JSON.stringify({
            request_id: requestId,
            expiry_seconds: expirySeconds,
            kfrag_hex: kfragHex,
            verifying_key_hex: verifyingKeyHex,
        }),
    });
}

/**
 * Deny an access request (file owner only)
 */
export async function denyAccess(requestId: number): Promise<{ message: string }> {
    return apiRequest(`/access/deny-access/${requestId}`, {
        method: 'POST',
    });
}

/**
 * Redeem approved access (get re-encrypted capsule)
 */
export async function redeemAccess(
    cid: string,
    requesterPubkey?: string
): Promise<RedeemAccessResponse> {
    return apiRequest('/access/redeem', {
        method: 'POST',
        body: JSON.stringify({
            cid,
            requester_pubkey: requesterPubkey,
        }),
    });
}

/**
 * Get pending access requests for the current user's files
 */
export async function getPendingRequests(): Promise<{
    requests: AccessRequest[];
    count: number;
}> {
    return apiRequest('/access/pending-requests');
}

/**
 * Get approved grants for the current user's files
 */
export async function getApprovedGrants(): Promise<{
    grants: ApprovedGrant[];
    count: number;
}> {
    return apiRequest('/access/my-grants');
}

// -----------------------------------------------------------------------------
// Grant Management
// -----------------------------------------------------------------------------

export interface CreateGrantParams {
    granter_id: number;
    grantee_id?: number;
    grantee_uuid?: string;
    file_id: number;
    expiry_seconds?: number;
}

/**
 * Create a new grant (grant access to a file)
 */
export async function createGrant(params: CreateGrantParams): Promise<{
    data?: { grant_id: number; tx_hash?: string; message: string };
    error?: string;
}> {
    try {
        const body: any = {
            granter_id: params.granter_id,
            file_id: params.file_id,
        };

        if (params.grantee_uuid) {
            body.grantee_uuid = params.grantee_uuid;
        } else if (params.grantee_id) {
            body.grantee_id = params.grantee_id;
        }

        if (params.expiry_seconds) {
            body.expires_at = new Date(Date.now() + params.expiry_seconds * 1000).toISOString();
        }

        const response = await apiRequest<{ grant_id: number; tx_hash?: string; message: string }>('/grant/create', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to create grant' };
    }
}

// -----------------------------------------------------------------------------
// Revocation
// -----------------------------------------------------------------------------

export interface RevokeGrantParams {
    grant_id: number;
    granter_id: number;
    emit_onchain?: boolean;
}

/**
 * Revoke a grant
 */
export async function revokeGrant(params: RevokeGrantParams): Promise<{
    data?: { message: string; tx_hash?: string };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ message: string; tx_hash?: string }>('/grant/revoke', {
            method: 'POST',
            body: JSON.stringify({
                grant_id: params.grant_id,
                granter_id: params.granter_id,
                emit_onchain: params.emit_onchain
            }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to revoke grant' };
    }
}

/**
 * Redeem a grant (get re-encrypted capsule)
 */
export async function redeemGrant(
    grantId: number,
    capsule: string
): Promise<{
    cfrag: string;
    capsule: string;
    delegating_pk: string;
    message: string;
}> {
    return apiRequest('/grant/redeem', {
        method: 'POST',
        body: JSON.stringify({
            grant_id: grantId,
            capsule,
        }),
    });
}

/**
 * List grants created by a user
 */
export async function listGrants(userId: number): Promise<{
    data?: { grants: Grant[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ grants: Grant[]; count: number }>(`/grant/list/${userId}`);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list grants' };
    }
}

/**
 * List grants received by a user
 */
export async function listGrantsForGrantee(
    granteeId: number
): Promise<{ grants: Grant[]; count: number }> {
    return apiRequest(`/grant/for-grantee/${granteeId}`);
}

// =============================================================================
// Hospital Access API
// =============================================================================

/**
 * List available hospitals
 */
export async function listHospitals(): Promise<{ hospitals: HospitalInfo[]; count: number }> {
    return apiRequest('/patients/hospitals');
}

/**
 * Grant a hospital access to patient's records
 */
export async function grantHospitalAccess(
    hospitalId: number,
    expirySeconds?: number
): Promise<{ message: string; tx_hash?: string }> {
    return apiRequest('/patients/grant-hospital-access', {
        method: 'POST',
        body: JSON.stringify({
            hospital_id: hospitalId,
            expiry_seconds: expirySeconds,
        }),
    });
}

/**
 * Revoke hospital's access to patient's records
 */
export async function revokeHospitalAccess(
    hospitalId: number,
    emitOnchain: boolean = false
): Promise<{ message: string; tx_hash?: string }> {
    return apiRequest('/patients/revoke-hospital-access', {
        method: 'POST',
        body: JSON.stringify({
            hospital_id: hospitalId,
            emit_onchain: emitOnchain,
        }),
    });
}

/**
 * Check if a hospital has access
 */
export async function checkHospitalAccess(
    hospitalId: number
): Promise<{ has_access: boolean; expires_at?: string }> {
    return apiRequest(`/patients/check-hospital-access/${hospitalId}`);
}

/**
 * Get list of hospitals with their access status for current patient
 */
export async function getHospitalAccessList(): Promise<{
    hospitals: HospitalAccess[];
    count: number;
}> {
    return apiRequest('/patients/hospital-access-list');
}

// =============================================================================
// Hospital Patient Management API
// =============================================================================

/**
 * Get hospital's patients (hospital only)
 */
export async function getHospitalPatients(): Promise<{
    data?: { patients: HospitalPatient[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ patients: HospitalPatient[]; count: number }>('/hospital/patients');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list patients' };
    }
}

/**
 * Get pending patient requests for a hospital
 */
export async function getPendingHospitalRequests(): Promise<{
    requests: PendingHospitalRequest[];
    count: number;
}> {
    return apiRequest('/patients/pending-requests');
}

/**
 * Approve a patient's request to link with hospital
 */
export async function approveHospitalRequest(
    requestId: number
): Promise<{ message: string; tx_hash?: string }> {
    return apiRequest(`/patients/approve-request/${requestId}`, {
        method: 'POST',
    });
}

/**
 * Deny a patient's request
 */
export async function denyHospitalRequest(requestId: number): Promise<{ message: string }> {
    return apiRequest(`/patients/deny-request/${requestId}`, {
        method: 'POST',
    });
}

/**
 * Patient requests access to a hospital
 */
export async function requestHospitalLink(hospitalId: number): Promise<{
    request_id: number;
    status: string;
}> {
    return apiRequest('/patients/request-hospital-link', {
        method: 'POST',
        body: JSON.stringify({ hospital_id: hospitalId }),
    });
}

// =============================================================================
// Revocation & CEK Rotation API
// =============================================================================

/**
 * Initiate access revocation
 */
export async function revokeAccess(grantId: number): Promise<{
    message: string;
    tx_hash?: string;
}> {
    return apiRequest('/revoke/initiate', {
        method: 'POST',
        body: JSON.stringify({ grant_id: grantId }),
    });
}

/**
 * Complete CEK rotation after re-encrypting file
 */
export async function completeRotation(
    fileId: number,
    newCid: string,
    newCapsule: string,
    newEncryptedCek: string
): Promise<{
    message: string;
    new_cid: string;
    tx_hash?: string;
}> {
    return apiRequest('/revoke/complete-rotation', {
        method: 'POST',
        body: JSON.stringify({
            file_id: fileId,
            new_cid: newCid,
            new_capsule: newCapsule,
            new_encrypted_cek: newEncryptedCek,
        }),
    });
}

/**
 * Server-assisted revocation (for demo purposes)
 */
export async function serverAssistedRevocation(
    fileId: number
): Promise<{
    message: string;
    new_cid: string;
    tx_hash?: string;
}> {
    return apiRequest('/revoke/server-assisted', {
        method: 'POST',
        body: JSON.stringify({ file_id: fileId }),
    });
}

// =============================================================================
// Audit Log API
// =============================================================================

/**
 * Get audit log for a patient
 */
export async function getAuditLog(
    patientId: number,
    limit?: number
): Promise<{ logs: AuditLogEntry[]; count: number }> {
    const params = limit ? `?limit=${limit}` : '';
    return apiRequest(`/audit/logs/${patientId}${params}`);
}

/**
 * Get combined audit log (database + blockchain)
 */
export async function getCombinedAuditLog(
    patientId: number
): Promise<{ logs: AuditLogEntry[]; count: number }> {
    return apiRequest(`/audit/combined/${patientId}`);
}

// =============================================================================
// KFrag Generation API (Server-side for compatibility)
// =============================================================================

/**
 * Generate kfrag on server using patient's secret key bytes
 * This is used because @nucypher/umbral-pre (WASM) and pyumbral have
 * incompatible kfrag serialization formats.
 */
export async function generateKfragServerSide(
    secretKeyBytesHex: string,
    receivingPubkeyHex: string,
    signingSecretKeyHex?: string
): Promise<{
    kfrag_hex: string;
    verifying_key_hex: string;
}> {
    return apiRequest('/grant/generate-kfrag', {
        method: 'POST',
        body: JSON.stringify({
            delegating_sk_bytes_hex: secretKeyBytesHex,
            receiving_pk_hex: receivingPubkeyHex,
            signing_sk_bytes_hex: signingSecretKeyHex,
        }),
    });
}

// =============================================================================
// Hospital File Decryption API
// =============================================================================

/**
 * Decrypt file for hospital (server-assisted decryption)
 * Hospital sends their secret key bytes to server for decryption
 */
export async function decryptFileForHospital(
    fileId: number,
    hospitalSecretKeyHex: string
): Promise<DecryptedFileResponse> {
    try {
        const response = await apiRequest<{
            filename: string;
            content_base64: string;
            content_type: string;
            size: number;
        }>("/access/decrypt-for-hospital", {
            method: "POST",
            body: JSON.stringify({
                file_id: fileId,
                hospital_sk_bytes_hex: hospitalSecretKeyHex,
            }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "Decryption failed" };
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
    return getAuthToken() !== null;
}

/**
 * Get stored user info from localStorage
 */
export function getStoredUser(): Partial<User> | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem('user_info');
    return stored ? JSON.parse(stored) : null;
}

/**
 * Store user info in localStorage
 */
export function setStoredUser(user: Partial<User>): void {
    if (typeof window !== 'undefined') {
        localStorage.setItem('user_info', JSON.stringify(user));
    }
}

/**
 * Clear all stored auth data
 */
export function clearStoredAuth(): void {
    clearAuthToken();
    if (typeof window !== 'undefined') {
        localStorage.removeItem('user_info');
    }
}

// =============================================================================
// Additional Auth Functions (V2)
// =============================================================================

/**
 * Register a new user V2 (patient or hospital)
 */
export async function registerV2(data: RegisterRequest, hospitalSecret?: string): Promise<{
    data?: RegisterResponse;
    error?: string;
}> {
    try {
        const body: any = { ...data };
        if (hospitalSecret) {
            body.hospital_secret = hospitalSecret;
        }
        const response = await apiRequest<RegisterResponse>('/auth/register-v2', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Registration failed' };
    }
}

/**
 * Login V2 and get JWT token
 */
export async function loginV2(credentials: { username: string; password: string }): Promise<{
    data?: LoginResponse;
    error?: string;
}> {
    try {
        const response = await apiRequest<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
        });
        setAuthToken(response.access_token);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Login failed' };
    }
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<{
    data?: User;
    error?: string;
}> {
    try {
        const response = await apiRequest<User>('/auth/me');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to fetch user' };
    }
}

/**
 * Validate an invite token
 */
export async function validateInviteToken(token: string): Promise<{
    data?: { valid: boolean; hospital_name?: string };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ valid: boolean; hospital_name?: string }>(`/auth/validate-invite/${token}`);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid invite token' };
    }
}

/**
 * Generate a public invite (hospital only)
 */
export async function generatePublicInvite(password?: string, expiresSeconds?: number): Promise<{
    data?: { invite_token: string; expires_at: string };
    error?: string;
}> {
    try {
        const body: any = {};
        if (password) body.password = password;
        if (expiresSeconds) body.expires_seconds = expiresSeconds;

        const response = await apiRequest<{ invite_token: string; expires_at: string }>('/auth/create-invite', {
            method: 'POST',
            body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to generate invite' };
    }
}

/**
 * Update user's public key
 */
export async function updatePublicKey(publicKey: string): Promise<{ message: string }> {
    return apiRequest('/auth/update-public-key', {
        method: 'POST',
        body: JSON.stringify({ public_key: publicKey }),
    });
}

// =============================================================================
// Profile Functions
// =============================================================================

/**
 * Get current user's profile (patient or hospital)
 */
export async function getMyProfile(): Promise<PatientProfile | HospitalProfile> {
    return apiRequest('/auth/my-profile');
}

/**
 * Update hospital profile 
 */
export async function updateHospitalProfile(
    hospitalId: number,
    data: Partial<{
        name: string;
        address: string;
        contact_email: string;
        contact_phone: string;
    }>
): Promise<{ message: string }> {
    return apiRequest(`/hospitals/profile/\${hospitalId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

// =============================================================================
// Hospital Access Request Functions
// =============================================================================

export interface HospitalAccessRequestStatus {
    id: number;
    hospital_id: number;
    hospital_name: string;
    patient_id: number;
    patient_name: string;
    status: 'pending' | 'approved' | 'denied' | 'expired';
    purpose?: string;
    created_at: string;
    expires_at?: string;
}

/**
 * Request patient access (hospital side)
 */
export async function requestPatientAccess(
    patientIdentifier: string,
    purpose?: string
): Promise<{ request_id: number; status: string }> {
    return apiRequest('/access/request-patient-access', {
        method: 'POST',
        body: JSON.stringify({ patient_identifier: patientIdentifier, purpose }),
    });
}

/**
 * Get hospital's access requests
 */
export async function getHospitalAccessRequests(): Promise<{
    requests: HospitalAccessRequestStatus[];
    count: number;
}> {
    return apiRequest('/access/hospital-requests');
}

/**
 * Withdraw access request (hospital side)
 */
export async function getPatientHospitals(): Promise<{
    data?: { hospitals: HospitalAccess[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ hospitals: HospitalAccess[]; count: number }>('/access/my-hospitals');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list hospitals' };
    }
}
/**
 * Get patient's hospitals list
 * Get patient's access history
 */
export async function getPatientAccessHistory(): Promise<{
    data?: { history: HospitalAccessRequestStatus[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ history: HospitalAccessRequestStatus[]; count: number }>('/patients/access-history');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to get access history' };
    }
}

/**
 * Get patient's pending requests from hospitals
 */
export async function getPatientPendingRequests(): Promise<{
    data?: { requests: PendingHospitalRequest[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ requests: PendingHospitalRequest[]; count: number }>('/patients/pending-hospital-requests');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to get pending requests' };
    }
}

/**
 * Get hospital's public key for a request
 */
export async function getHospitalPublicKeyForRequest(requestId: number): Promise<{ public_key: string }> {
    return apiRequest(`/access/hospital-pubkey/\${requestId}`);
}

// =============================================================================
// Patient-to-Patient Sharing
// =============================================================================

export interface PatientAccessEntry {
    id: number;
    grant_id: number;
    owner_id: number;
    owner_name: string;
    file_id: number;
    filename: string;
    cid: string;
    status: "active" | "revoked";
    granted_at: string;
    expires_at?: string;
}
export interface PatientGrantEntry {
    id: number;
    grant_id: number;
    grantee_id: number;
    grantee_name: string;
    grantee_uuid: string;
    file_id: number;
    filename: string;
    cid: string;
    status: "active" | "revoked" | "expired";
    granted_at: string;
    expires_at?: string;
}

export async function getMySharedFiles(): Promise<{
    data?: { grants: PatientGrantEntry[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ shares: any[]; count: number }>('/sharing/my-shares');
        const grants: PatientGrantEntry[] = response.shares.map(s => ({
            ...s,
            id: s.id,
            grant_id: s.id,
            granted_at: s.created_at || s.granted_at,
            status: s.status
        }));
        return { data: { grants, count: response.count } };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list shared files' };
    }
}

/**
 * Get files shared with me by other patients
 */
export async function getFilesSharedWithMe(): Promise<{
    data?: { shares: PatientAccessEntry[]; count: number };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ shares: PatientAccessEntry[]; count: number }>('/sharing/shared-with-me');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to fetch shared files' };
    }
}

/**
 * Share file(s) with another patient
 */
export async function shareFilesWithPatient(
    params: {
        grantee_uuid: string;
        file_ids: number[];
        expires_seconds?: number;
        purpose?: string;
    },
    secretKeyHex?: string,
    signingKeyHex?: string
): Promise<{
    data?: {
        grant_ids: number[];
        message: string;
        file_count?: number;
        grantee_name?: string;
        tx_hash?: string;
    };
    error?: string;
}> {
    try {
        const body: any = { ...params };
        if (secretKeyHex) body.secret_key_hex = secretKeyHex;
        if (signingKeyHex) body.signing_key_hex = signingKeyHex;

        const response = await apiRequest<{
            grant_ids: number[];
            message: string;
            file_count?: number;
            grantee_name?: string;
            tx_hash?: string;
        }>('/sharing/share', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to share files' };
    }
}

/**
 * Revoke a patient share
 */
export async function revokePatientShare(grantId: number): Promise<{
    data?: { message: string; tx_hash?: string };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ message: string; tx_hash?: string }>(`/sharing/revoke/${grantId}`, { method: 'POST' });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to revoke share' };
    }
}

/**
 * Bulk revoke patient shares
 */
export async function bulkRevokePatientShares(grantIds: number[]): Promise<{
    data?: { message: string; revoked_count: number; failed_count: number; tx_hashes: string[] };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ message: string; revoked_count: number; failed_count: number; tx_hashes: string[] }>('/sharing/bulk-revoke', {
            method: 'POST',
            body: JSON.stringify({ grant_ids: grantIds }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to revoke shares' };
    }
}

/**
 * Get a patient's public key by UUID
 */
export async function getPatientPublicKey(patientUuid: string): Promise<{
    data?: { public_key: string; patient_name: string; patient_uuid: string; has_public_key: boolean };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ public_key: string; patient_name: string; patient_uuid: string; has_public_key: boolean }>(`/patients/public-key/${patientUuid}`);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to lookup patient' };
    }
}

/**
 * Decrypt a shared file (server-side)
 */
export async function decryptSharedFile(
    grantId: number,
    secretKeyHex: string
): Promise<{
    data?: { filename: string; content_base64: string; content_type: string; size: number };
    error?: string;
}> {
    return apiRequest('/sharing/decrypt', {
        method: 'POST',
        body: JSON.stringify({ grant_id: grantId, secret_key_hex: secretKeyHex }),
    });
}

// =============================================================================
// File Operations
// =============================================================================

/**
 * List files for a user
 */
export async function listFiles(userId?: number): Promise<{
    data?: { files: FileRecord[]; count: number };
    error?: string;
}> {
    try {
        const endpoint = userId ? `/files/list/${userId}` : '/files/my-files';
        const response = await apiRequest<{ files: FileRecord[]; count: number }>(endpoint);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list files' };
    }
}

/**
 * Rename a file
 */
export async function renameFile(userId: number, fileId: number, newName: string): Promise<{
    data?: { message: string };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ message: string }>(`/files/rename/${fileId}`, {
            method: 'PUT',
            body: JSON.stringify({ filename: newName }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to rename file' };
    }
}

/**
 * Get hospital patient files
 */
export async function getHospitalPatientFiles(patientId: number): Promise<{
    files: FileRecord[];
    count: number;
}> {
    return apiRequest(`/access/hospital-patient-files/\${patientId}`);
}

// =============================================================================
// Audit Functions
// =============================================================================

export interface CategorizedAuditResponse {
    all_logs?: AuditLogEntry[];
    uploads?: AuditLogEntry[];
    grants?: AuditLogEntry[];
    accesses?: AuditLogEntry[];
    access_events?: AuditLogEntry[];
    revocations?: AuditLogEntry[];
    revokes?: AuditLogEntry[];
    rotations?: AuditLogEntry[];
    total?: number;
    total_count?: number;
    grants_count?: number;
    access_count?: number;
}

/**
 * Get audit logs for current user
 */
export async function getMyAuditLogs(limit?: number): Promise<{
    data?: CategorizedAuditResponse;
    error?: string;
}> {
    try {
        const params = limit ? `?limit=${limit}` : '';
        const response = await apiRequest<CategorizedAuditResponse>(`/audit/my-logs${params}`);

        // Polyfill fields for frontend compatibility
        const result: CategorizedAuditResponse = {
            ...response,
            access_events: response.access_events || response.accesses || [],
            revokes: response.revokes || response.revocations || [],
            total_count: response.total_count || response.total || 0,
            all_logs: response.all_logs || []
        };

        // If all_logs is empty, aggregate from categories
        if (!result.all_logs || result.all_logs.length === 0) {
            result.all_logs = [
                ...(result.uploads || []),
                ...(result.grants || []),
                ...(result.access_events || []),
                ...(result.revokes || []),
                ...(result.rotations || [])
            ].sort((a, b) => new Date(b.timestamp || '').getTime() - new Date(a.timestamp || '').getTime());

            result.total_count = result.all_logs.length;
        }

        return { data: result };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to fetch audit logs' };
    }
}
export async function getAuditLogs(
    patientId?: number,
    limit?: number
): Promise<{
    data?: { logs: AuditLogEntry[]; count: number };
    error?: string;
}> {
    try {
        const params = limit ? `?limit=${limit}` : '';
        const endpoint = patientId ? `/audit/logs/${patientId}` : '/audit/logs';
        const response = await apiRequest<{ logs: AuditLogEntry[]; count: number }>(`${endpoint}${params}`);
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to fetch audit logs' };
    }
}

// =============================================================================
// Revocation / Rotation
// =============================================================================

/**
 * Prepare rotation - get file data for client-side re-encryption
 */
export async function prepareRotation(fileId: number): Promise<{
    cid: string;
    capsule: string;
    encrypted_cek: string;
    filename: string;
}> {
    return apiRequest(`/revoke/prepare/\${fileId}`);
}

// =============================================================================
// Hospital Invite Token Functions
// =============================================================================

/**
 * Generate a hospital invite token
 */
export async function generateHospitalInvite(expiresSeconds?: number): Promise<{
    data?: { token: string; expires_at: string };
    error?: string;
}> {
    try {
        const response = await apiRequest<{ token: string; expires_at: string }>('/auth/create-invite', {
            method: 'POST',
            body: JSON.stringify({ expires_seconds: expiresSeconds }),
        });
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to generate invite' };
    }
}

/**
 * List hospital invite tokens
 */
export async function listHospitalInviteTokens(): Promise<{
    data?: {
        tokens: Array<{
            token: string;
            created_at: string;
            expires_at: string | null;
            used: boolean;
            used_at: string | null;
            expired: boolean;
        }>;
    };
    error?: string;
}> {
    try {
        const response = await apiRequest<{
            tokens: Array<{
                token: string;
                created_at: string;
                expires_at: string | null;
                used: boolean;
                used_at: string | null;
                expired: boolean;
            }>;
        }>('/auth/list-invites');
        return { data: response };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to list invites' };
    }
}

