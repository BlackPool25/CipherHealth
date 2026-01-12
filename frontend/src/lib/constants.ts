/**
 * CipherHealth Constants
 * 
 * Blockchain network configuration and application-wide constants.
 */

// =============================================================================
// Sepolia Testnet Configuration
// =============================================================================

/** Sepolia chain ID in hex format (for MetaMask) */
export const SEPOLIA_CHAIN_ID = '0xaa36a7';

/** Sepolia chain ID as decimal number */
export const SEPOLIA_CHAIN_ID_DECIMAL = 11155111;

/** Etherscan base URL for transaction links */
export const SEPOLIA_ETHERSCAN_TX = 'https://sepolia.etherscan.io/tx';

/** Etherscan base URL for address links */
export const SEPOLIA_ETHERSCAN_ADDRESS = 'https://sepolia.etherscan.io/address';

/** Full network configuration for adding to MetaMask */
export const SEPOLIA_NETWORK_CONFIG = {
    chainId: SEPOLIA_CHAIN_ID,
    chainName: 'Sepolia Testnet',
    nativeCurrency: {
        name: 'SepoliaETH',
        symbol: 'ETH',
        decimals: 18,
    },
    rpcUrls: ['https://rpc.sepolia.org', 'https://sepolia.drpc.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

// =============================================================================
// API Configuration
// =============================================================================

/** Backend API base URL */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// =============================================================================
// Application Constants
// =============================================================================

/** Default grant expiry time in seconds (1 hour) */
export const DEFAULT_GRANT_EXPIRY_SECONDS = 3600;

/** Maximum file size for upload in bytes (50MB) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Supported file categories for medical records */
export const FILE_CATEGORIES = [
    'Lab Results',
    'Imaging',
    'Prescriptions',
    'Discharge Summary',
    'Consultation Notes',
    'Vaccination Records',
    'Other',
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];
