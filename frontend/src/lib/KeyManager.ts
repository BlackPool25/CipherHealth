/**
 * CipherHealth Key Manager
 * 
 * Client-side cryptographic key management using Web Crypto API and IndexedDB.
 * Provides secure generation, storage, and retrieval of Umbral-compatible keys.
 * 
 * Security Features:
 * - Private keys encrypted with password-derived key (PBKDF2 + AES-GCM)
 * - Keys stored in IndexedDB (persistent, not accessible to other origins)
 * - Private keys never exposed in plaintext outside this module
 * - Per-user key storage (keys are stored per userId)
 */

const DB_NAME = 'CipherHealthKeys';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

// PBKDF2 parameters for key derivation
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// =============================================================================
// Key Data Types
// =============================================================================

export interface EncryptedKeyData {
    encrypted: string; // Base64-encoded
    salt: string; // Base64-encoded
    iv: string; // Base64-encoded
}

export interface StoredKeyData {
    secretKey: EncryptedKeyData;
    signingKey?: EncryptedKeyData;
    publicKey: string; // Hex-encoded (unencrypted)
    signingPublicKey?: string; // Hex-encoded (unencrypted)
}

export interface KeyPairData {
    secretKeyBytes: Uint8Array;
    signingKeyBytes?: Uint8Array;
    publicKeyHex: string;
    signingPublicKeyHex?: string;
}

// =============================================================================
// IndexedDB Helpers
// =============================================================================

/**
 * Open the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(new Error('Failed to open database'));

        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Store data in IndexedDB
 */
async function storeInDB(id: string, data: unknown): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ id, data });

        request.onerror = () => reject(new Error('Failed to store data'));
        request.onsuccess = () => resolve();

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Retrieve data from IndexedDB
 */
async function getFromDB<T>(id: string): Promise<T | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onerror = () => reject(new Error('Failed to retrieve data'));
        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? result.data : null);
        };

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Delete data from IndexedDB
 */
async function deleteFromDB(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onerror = () => reject(new Error('Failed to delete data'));
        request.onsuccess = () => resolve();

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Check if a key exists in IndexedDB
 */
async function existsInDB(id: string): Promise<boolean> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count(id);

        request.onerror = () => reject(new Error('Failed to check key existence'));
        request.onsuccess = () => resolve(request.result > 0);

        transaction.oncomplete = () => db.close();
    });
}

// =============================================================================
// Cryptographic Helpers
// =============================================================================

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) throw new Error('Invalid hex string');
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as any,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt data with password-derived key
 */
async function encryptWithPassword(
    data: Uint8Array,
    password: string
): Promise<EncryptedKeyData> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt);

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data as any
    );

    return {
        encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...iv)),
    };
}

/**
 * Decrypt data with password-derived key
 */
async function decryptWithPassword(
    encryptedData: EncryptedKeyData,
    password: string
): Promise<Uint8Array> {
    const encrypted = Uint8Array.from(atob(encryptedData.encrypted), c => c.charCodeAt(0));
    const salt = Uint8Array.from(atob(encryptedData.salt), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));

    const key = await deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted as any
    );

    return new Uint8Array(decrypted);
}

// =============================================================================
// KeyManager Class
// =============================================================================

/**
 * Get the storage key for a user's keys
 */
function getUserKeyId(userId: string): string {
    return `user_keys_${userId}`;
}

/**
 * KeyManager - Secure client-side key management
 * 
 * Uses Web Crypto API for key operations and IndexedDB for storage.
 * Keys are encrypted with user's passphrase before storage.
 * Each user has their own set of keys, identified by userId.
 */
class KeyManager {
    /**
     * Generate a new Umbral-compatible keypair
     * 
     * Generates 32-byte random secret keys for both encryption and signing.
     * The public keys should be derived using the Umbral library after generation.
     * 
     * @returns Object with secret key bytes (public keys to be derived with Umbral)
     */
    static generateKeyBytes(): { secretKeyBytes: Uint8Array; signingKeyBytes: Uint8Array } {
        return {
            secretKeyBytes: crypto.getRandomValues(new Uint8Array(32)),
            signingKeyBytes: crypto.getRandomValues(new Uint8Array(32)),
        };
    }

    /**
     * Store keys encrypted with passphrase
     * 
     * @param userId - User's ID (for per-user storage)
     * @param passphrase - User's passphrase for encryption
     * @param secretKeyBytes - Raw secret key bytes (32 bytes)
     * @param publicKeyHex - Hex-encoded public key
     * @param signingKeyBytes - Optional signing key bytes (32 bytes)
     * @param signingPublicKeyHex - Optional hex-encoded signing public key
     */
    static async storeKeys(
        userId: string,
        passphrase: string,
        secretKeyBytes: Uint8Array,
        publicKeyHex: string,
        signingKeyBytes?: Uint8Array,
        signingPublicKeyHex?: string
    ): Promise<void> {
        // Encrypt secret key with passphrase
        const encryptedSecretKey = await encryptWithPassword(secretKeyBytes, passphrase);

        // Encrypt signing key if provided
        let encryptedSigningKey: EncryptedKeyData | undefined;
        if (signingKeyBytes) {
            encryptedSigningKey = await encryptWithPassword(signingKeyBytes, passphrase);
        }

        const storedData: StoredKeyData = {
            secretKey: encryptedSecretKey,
            signingKey: encryptedSigningKey,
            publicKey: publicKeyHex,
            signingPublicKey: signingPublicKeyHex,
        };

        await storeInDB(getUserKeyId(userId), storedData);
    }

    /**
     * Load and decrypt private key
     * 
     * @param userId - User's ID
     * @param passphrase - User's passphrase for decryption
     * @returns KeyPairData with decrypted keys, or null if not found
     */
    static async loadPrivateKey(userId: string, passphrase: string): Promise<KeyPairData | null> {
        const storedData = await getFromDB<StoredKeyData>(getUserKeyId(userId));
        if (!storedData) return null;

        try {
            // Decrypt secret key
            const secretKeyBytes = await decryptWithPassword(storedData.secretKey, passphrase);

            // Decrypt signing key if present
            let signingKeyBytes: Uint8Array | undefined;
            if (storedData.signingKey) {
                signingKeyBytes = await decryptWithPassword(storedData.signingKey, passphrase);
            }

            return {
                secretKeyBytes,
                signingKeyBytes,
                publicKeyHex: storedData.publicKey,
                signingPublicKeyHex: storedData.signingPublicKey,
            };
        } catch (error) {
            console.error('Failed to decrypt keys:', error);
            throw new Error('Invalid passphrase or corrupted key data');
        }
    }

    /**
     * Load stored public key (no passphrase needed)
     * 
     * @param userId - User's ID
     * @returns Hex-encoded public key, or null if not found
     */
    static async loadPublicKey(userId: string): Promise<string | null> {
        const storedData = await getFromDB<StoredKeyData>(getUserKeyId(userId));
        return storedData?.publicKey ?? null;
    }

    /**
     * Check if user has stored keys
     * 
     * @param userId - User's ID
     * @returns true if encrypted keys exist for this user
     */
    static async hasKeypair(userId: string): Promise<boolean> {
        return existsInDB(getUserKeyId(userId));
    }

    /**
     * Clear user's stored keys
     * 
     * @param userId - User's ID
     */
    static async clearStoredKeys(userId: string): Promise<void> {
        await deleteFromDB(getUserKeyId(userId));
    }

    /**
     * Export private key as encrypted string (for backup)
     * 
     * @param secretKeyBytes - Raw private key bytes
     * @param passphrase - Password for export encryption
     * @returns Encrypted export string (can be saved to file)
     */
    static async exportPrivateKey(secretKeyBytes: Uint8Array, passphrase: string): Promise<string> {
        const encryptedData = await encryptWithPassword(secretKeyBytes, passphrase);

        const exportData = {
            version: 1,
            ...encryptedData,
        };

        return JSON.stringify(exportData);
    }

    /**
     * Import private key from encrypted export string
     * 
     * @param exportString - Encrypted export string from exportPrivateKey
     * @param passphrase - Password used during export
     * @returns Private key bytes
     */
    static async importPrivateKey(exportString: string, passphrase: string): Promise<Uint8Array> {
        const exportData = JSON.parse(exportString);

        if (exportData.version !== 1) {
            throw new Error('Unsupported export format version');
        }

        const encryptedKeyData: EncryptedKeyData = {
            encrypted: exportData.encrypted,
            salt: exportData.salt,
            iv: exportData.iv,
        };

        return decryptWithPassword(encryptedKeyData, passphrase);
    }

    /**
     * Convert private key bytes to hex string
     * 
     * @param privateKeyBytes - Raw private key bytes
     * @returns Hex-encoded private key (for sending to server)
     */
    static privateKeyToHex(privateKeyBytes: Uint8Array): string {
        return bufferToHex(privateKeyBytes);
    }

    /**
     * Convert hex string to private key bytes
     * 
     * @param hex - Hex-encoded private key
     * @returns Private key bytes
     */
    static hexToPrivateKey(hex: string): Uint8Array {
        return hexToBuffer(hex);
    }

    /**
     * Verify passphrase by attempting to decrypt stored key
     * 
     * @param userId - User's ID
     * @param passphrase - Passphrase to verify
     * @returns true if passphrase is correct
     */
    static async verifyPassphrase(userId: string, passphrase: string): Promise<boolean> {
        try {
            const keyPair = await this.loadPrivateKey(userId, passphrase);
            return keyPair !== null;
        } catch {
            return false;
        }
    }

    /**
     * Change passphrase for stored keys
     * 
     * @param userId - User's ID
     * @param oldPassphrase - Current passphrase
     * @param newPassphrase - New passphrase
     */
    static async changePassphrase(
        userId: string,
        oldPassphrase: string,
        newPassphrase: string
    ): Promise<void> {
        const keyPair = await this.loadPrivateKey(userId, oldPassphrase);
        if (!keyPair) {
            throw new Error('No stored keys found or invalid passphrase');
        }

        await this.storeKeys(
            userId,
            newPassphrase,
            keyPair.secretKeyBytes,
            keyPair.publicKeyHex,
            keyPair.signingKeyBytes,
            keyPair.signingPublicKeyHex
        );
    }
}

export default KeyManager;
