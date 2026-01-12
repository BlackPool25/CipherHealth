/**
 * CipherHealth Umbral Wrapper
 * 
 * Wrapper for @nucypher/umbral-pre WASM library for Proxy Re-Encryption.
 * Provides encryption, decryption, and key management functions.
 * 
 * Architecture Notes:
 * - Client-side key generation using this library
 * - kfrag generation delegated to server (pyumbral) due to serialization incompatibility
 * - Decryption performed client-side for original data, or via server for re-encrypted data
 */

import type {
    SecretKey as UmbralSecretKey,
    PublicKey as UmbralPublicKey,
    Capsule as UmbralCapsule,
    CapsuleFrag as UmbralCapsuleFrag,
    EncryptedMessage,
} from '@nucypher/umbral-pre';

import KeyManager from './KeyManager';

// Re-export types for convenience
export type SecretKey = UmbralSecretKey;
export type PublicKey = UmbralPublicKey;
export type Capsule = UmbralCapsule;
export type CapsuleFrag = UmbralCapsuleFrag;

// Module state
let umbralModule: typeof import('@nucypher/umbral-pre') | null = null;
let isInitialized = false;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the Umbral WASM module
 * 
 * Must be called before any other Umbral operations.
 * Safe to call multiple times (will only initialize once).
 */
export async function initUmbral(): Promise<void> {
    if (isInitialized && umbralModule) return;

    try {
        // Dynamic import to handle WASM loading
        umbralModule = await import('@nucypher/umbral-pre');
        isInitialized = true;
        console.log('[Umbral] WASM module initialized successfully');
    } catch (error) {
        console.error('[Umbral] Failed to initialize WASM module:', error);
        throw new Error('Failed to initialize Umbral encryption. Please refresh and try again.');
    }
}

/**
 * Check if Umbral is initialized
 */
export function isUmbralInitialized(): boolean {
    return isInitialized && umbralModule !== null;
}

/**
 * Get the Umbral module (throws if not initialized)
 */
function getModule(): typeof import('@nucypher/umbral-pre') {
    if (!umbralModule) {
        throw new Error('Umbral not initialized. Call initUmbral() first.');
    }
    return umbralModule;
}

// =============================================================================
// Key Generation
// =============================================================================

/**
 * Generate a new random secret key
 */
export function generateSecretKey(): SecretKey {
    const { SecretKey } = getModule();
    return SecretKey.random();
}

/**
 * Create a secret key from raw bytes
 * 
 * @param bytes - 32-byte Uint8Array
 */
export function secretKeyFromBytes(bytes: Uint8Array): SecretKey {
    const { SecretKey } = getModule();
    return SecretKey.fromBEBytes(bytes);
}

/**
 * Convert secret key to raw bytes
 * 
 * @param sk - Secret key
 * @returns 32-byte Uint8Array
 */
export function secretKeyToBytes(sk: SecretKey): Uint8Array {
    return sk.toBEBytes();
}

/**
 * Get the public key from a secret key
 */
export function getPublicKey(sk: SecretKey): PublicKey {
    return sk.publicKey();
}

/**
 * Convert public key to hex string
 */
export function publicKeyToHex(pk: PublicKey): string {
    const bytes = pk.toCompressedBytes();
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Create public key from hex string
 */
export function publicKeyFromHex(hex: string): PublicKey {
    const { PublicKey } = getModule();
    const bytes = hexToBytes(hex);
    return PublicKey.fromCompressedBytes(bytes);
}

// =============================================================================
// Encryption / Decryption
// =============================================================================

/**
 * Encrypt data for a recipient (creates capsule + ciphertext)
 * 
 * Used by the data owner to encrypt their own data.
 * 
 * @param plaintext - Data to encrypt
 * @param recipientPk - Recipient's public key
 * @returns Capsule and encrypted message
 */
export function encryptForRecipient(
    plaintext: Uint8Array,
    recipientPk: PublicKey
): { capsule: Capsule; ciphertext: Uint8Array } {
    const { encrypt } = getModule();
    const result: EncryptedMessage = encrypt(recipientPk, plaintext);

    return {
        capsule: result.capsule,
        ciphertext: result.ciphertext,
    };
}

/**
 * Encrypt data for self (owner encrypting their own data)
 * 
 * @param plaintext - Data to encrypt
 * @param ownerSk - Owner's secret key (for deriving public key)
 */
export function encryptForSelf(
    plaintext: Uint8Array,
    ownerSk: SecretKey
): { capsule: Capsule; ciphertext: Uint8Array } {
    const ownerPk = getPublicKey(ownerSk);
    return encryptForRecipient(plaintext, ownerPk);
}

/**
 * Decrypt data that was encrypted for you (original encryption, no re-encryption)
 * 
 * @param sk - Your secret key
 * @param capsule - The capsule from encryption
 * @param ciphertext - The encrypted data
 */
export function decryptOriginal(
    sk: SecretKey,
    capsule: Capsule,
    ciphertext: Uint8Array
): Uint8Array {
    const { decryptOriginal: umbralDecrypt } = getModule();
    return umbralDecrypt(sk, capsule, ciphertext);
}

/**
 * Decrypt re-encrypted data using cfrag from proxy
 * 
 * @param sk - Your secret key (receiving key)
 * @param delegatingPk - Delegator's public key (original owner)
 * @param capsule - Original capsule
 * @param cfrag - Capsule fragment from re-encryption
 * @param ciphertext - Encrypted data
 */
export function decryptReencrypted(
    sk: SecretKey,
    delegatingPk: PublicKey,
    capsule: Capsule,
    cfrag: CapsuleFrag,
    ciphertext: Uint8Array
): Uint8Array {
    const { decryptReencrypted: umbralDecryptReenc } = getModule();

    return umbralDecryptReenc(
        sk,
        delegatingPk,
        capsule,
        [cfrag],
        ciphertext
    );
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) throw new Error('Invalid hex string');
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Serialize capsule to hex string
 */
export function capsuleToHex(capsule: Capsule): string {
    return bytesToHex(capsule.toBytes());
}

/**
 * Deserialize capsule from hex string
 */
export function capsuleFromHex(hex: string): Capsule {
    const { Capsule } = getModule();
    return Capsule.fromBytes(hexToBytes(hex));
}

/**
 * Deserialize cfrag from hex string
 */
export function cfragFromHex(hex: string): CapsuleFrag {
    const { CapsuleFrag } = getModule();
    return CapsuleFrag.fromBytes(hexToBytes(hex));
}

/**
 * Serialize cfrag to hex string
 */
export function cfragToHex(cfrag: CapsuleFrag): string {
    return bytesToHex(cfrag.toBytes());
}

// =============================================================================
// AES-GCM Helpers (for CEK encryption)
// =============================================================================

/**
 * Generate a random Content Encryption Key (CEK)
 * 
 * @returns 32-byte random key for AES-256-GCM
 */
export function generateCEK(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypt data with AES-256-GCM
 * 
 * @param plaintext - Data to encrypt
 * @param cek - 32-byte Content Encryption Key
 * @returns Object containing ciphertext and nonce
 */
export async function encryptWithCEK(
    plaintext: Uint8Array,
    cek: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    const key = await crypto.subtle.importKey(
        'raw',
        cek,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        plaintext
    );

    return {
        ciphertext: new Uint8Array(ciphertext),
        nonce,
    };
}

/**
 * Decrypt data with AES-256-GCM
 * 
 * @param ciphertext - Encrypted data
 * @param cek - 32-byte Content Encryption Key
 * @param nonce - 12-byte nonce used during encryption
 */
export async function decryptWithCEK(
    ciphertext: Uint8Array,
    cek: Uint8Array,
    nonce: Uint8Array
): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        'raw',
        cek,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
    );

    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        ciphertext
    );

    return new Uint8Array(plaintext);
}

// =============================================================================
// High-Level File Encryption Helpers
// =============================================================================

export interface EncryptedFileData {
    encryptedFile: Uint8Array;
    nonce: Uint8Array;
    capsule: string; // Hex-encoded
    encryptedCek: string; // Hex-encoded
}

/**
 * Encrypt a file for the owner
 * 
 * Full encryption flow:
 * 1. Generate random CEK
 * 2. Encrypt file with CEK (AES-GCM)
 * 3. Encapsulate CEK with owner's public key (Umbral)
 * 
 * @param fileData - Raw file bytes
 * @param ownerSk - Owner's secret key
 */
export async function encryptFile(
    fileData: Uint8Array,
    ownerSk: SecretKey
): Promise<EncryptedFileData> {
    // Generate random CEK
    const cek = generateCEK();

    // Encrypt file with CEK
    const { ciphertext: encryptedFile, nonce } = await encryptWithCEK(fileData, cek);

    // Encapsulate CEK with owner's public key
    const ownerPk = getPublicKey(ownerSk);
    const { capsule, ciphertext: encryptedCekBytes } = encryptForRecipient(cek, ownerPk);

    return {
        encryptedFile,
        nonce,
        capsule: capsuleToHex(capsule),
        encryptedCek: bytesToHex(encryptedCekBytes),
    };
}

/**
 * Decrypt a file that you own (original encryption)
 * 
 * @param encryptedFile - Encrypted file bytes (includes nonce at start)
 * @param capsuleHex - Capsule from encryption (hex string)
 * @param encryptedCekHex - Encrypted CEK (hex string)
 * @param ownerSk - Owner's secret key
 */
export async function decryptOwnFile(
    encryptedFile: Uint8Array,
    nonce: Uint8Array,
    capsuleHex: string,
    encryptedCekHex: string,
    ownerSk: SecretKey
): Promise<Uint8Array> {
    // Parse capsule and encrypted CEK
    const capsule = capsuleFromHex(capsuleHex);
    const encryptedCek = hexToBytes(encryptedCekHex);

    // Decrypt CEK using Umbral
    const cek = decryptOriginal(ownerSk, capsule, encryptedCek);

    // Decrypt file with CEK
    return decryptWithCEK(encryptedFile, cek, nonce);
}

/**
 * Decrypt a file that was re-encrypted for you
 * 
 * @param encryptedFile - Encrypted file bytes
 * @param nonce - Nonce used during file encryption
 * @param capsuleHex - Original capsule (hex string)
 * @param cfragHex - Capsule fragment from re-encryption (hex string)
 * @param encryptedCekHex - Encrypted CEK (hex string)
 * @param delegatingPkHex - Owner's public key (hex string)
 * @param receivingSk - Your secret key
 */
export async function decryptReencryptedFile(
    encryptedFile: Uint8Array,
    nonce: Uint8Array,
    capsuleHex: string,
    cfragHex: string,
    encryptedCekHex: string,
    delegatingPkHex: string,
    receivingSk: SecretKey
): Promise<Uint8Array> {
    // Parse components
    const capsule = capsuleFromHex(capsuleHex);
    const cfrag = cfragFromHex(cfragHex);
    const encryptedCek = hexToBytes(encryptedCekHex);
    const delegatingPk = publicKeyFromHex(delegatingPkHex);

    // Decrypt CEK using re-encrypted capsule
    const cek = decryptReencrypted(receivingSk, delegatingPk, capsule, cfrag, encryptedCek);

    // Decrypt file with CEK
    return decryptWithCEK(encryptedFile, cek, nonce);
}

// =============================================================================
// Key Pair Generation (Higher Level)
// =============================================================================

export interface GeneratedKeyPair {
    secretKey: SecretKey;
    publicKey: PublicKey;
    secretKeyBytes: Uint8Array;
    publicKeyHex: string;
}

/**
 * Generate a new Umbral keypair
 */
export function generateKeyPair(): GeneratedKeyPair {
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);

    return {
        secretKey,
        publicKey,
        secretKeyBytes: secretKeyToBytes(secretKey),
        publicKeyHex: publicKeyToHex(publicKey),
    };
}

/**
 * Generate a signing keypair (same as regular keypair in Umbral)
 */
export function generateSigningKeyPair(): GeneratedKeyPair {
    return generateKeyPair();
}

// =============================================================================
// Key Persistence (Wrapper around KeyManager)
// =============================================================================

export interface StoredKeys {
    secretKeyBytes: Uint8Array;
    signingKeyBytes?: Uint8Array;
    publicKeyHex: string;
    signingPublicKeyHex?: string;
}

/**
 * Store keys encrypted with passphrase
 */
export async function storeKeys(
    userId: string,
    passphrase: string,
    secretKeyBytes: Uint8Array,
    publicKeyHex: string,
    signingKeyBytes?: Uint8Array,
    signingPublicKeyHex?: string
): Promise<void> {
    await KeyManager.storeKeys(
        userId,
        passphrase,
        secretKeyBytes,
        publicKeyHex,
        signingKeyBytes,
        signingPublicKeyHex
    );
}

/**
 * Load keys from storage using passphrase
 */
export async function loadKeys(userId: string, passphrase: string): Promise<StoredKeys | null> {
    const keyPair = await KeyManager.loadPrivateKey(userId, passphrase);
    if (!keyPair) return null;

    return {
        secretKeyBytes: keyPair.secretKeyBytes,
        signingKeyBytes: keyPair.signingKeyBytes,
        publicKeyHex: keyPair.publicKeyHex,
        signingPublicKeyHex: keyPair.signingPublicKeyHex,
    };
}

/**
 * Check if user has stored keys
 */
export async function hasStoredKeys(userId: string): Promise<boolean> {
    return KeyManager.hasStoredKey(userId);
}

/**
 * Export keys for backup (encrypted with passphrase)
 */
export async function exportKeysForBackup(
    secretKeyBytes: Uint8Array,
    signingKeyBytes: Uint8Array | undefined,
    passphrase: string
): Promise<string> {
    const secretKeyExport = await KeyManager.exportPrivateKey(secretKeyBytes, passphrase);

    if (signingKeyBytes) {
        const signingKeyExport = await KeyManager.exportPrivateKey(signingKeyBytes, passphrase);
        return JSON.stringify({
            version: 1,
            secretKey: JSON.parse(secretKeyExport),
            signingKey: JSON.parse(signingKeyExport),
        });
    }

    return JSON.stringify({
        version: 1,
        secretKey: JSON.parse(secretKeyExport),
    });
}

/**
 * Import keys from backup
 */
export async function importKeysFromBackup(
    backupString: string,
    passphrase: string
): Promise<{ secretKeyBytes: Uint8Array; signingKeyBytes?: Uint8Array }> {
    const backupData = JSON.parse(backupString);

    if (backupData.version !== 1) {
        throw new Error('Unsupported backup format version');
    }

    const secretKeyBytes = await KeyManager.importPrivateKey(
        JSON.stringify(backupData.secretKey),
        passphrase
    );

    let signingKeyBytes: Uint8Array | undefined;
    if (backupData.signingKey) {
        signingKeyBytes = await KeyManager.importPrivateKey(
            JSON.stringify(backupData.signingKey),
            passphrase
        );
    }

    return { secretKeyBytes, signingKeyBytes };
}
