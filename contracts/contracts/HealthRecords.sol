// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HealthRecords
 * @dev Manages patient health record CIDs and access grants on-chain.
 * 
 * This contract provides:
 * - Patient record storage (CID references, not actual data)
 * - Grant management for proxy re-encryption workflow
 * - Event emission for audit trail
 * 
 * Security: Only stores CIDs and public keys. Actual encrypted data
 * is stored off-chain on IPFS/Storacha. Private keys never touch the chain.
 */
contract HealthRecords {
    // ========================================================================
    // State Variables
    // ========================================================================
    
    /// @dev Mapping of patient address to their latest record CID
    mapping(address => string) public records;
    
    /// @dev Grant struct to store grant details
    struct Grant {
        bool isActive;
        uint256 expiryTimestamp;
        address granter;
        uint256 createdAt;
    }
    
    /// @dev Nested mapping: cid => granteePubkey => Grant
    mapping(string => mapping(string => Grant)) public grants;
    
    // ========================================================================
    // Gas-Optimized Storage (using bytes32 cidHash)
    // ========================================================================
    
    /// @dev Struct for hash-based grants (gas-optimized)
    struct HashGrant {
        address grantee;
        uint256 expiry;
        bool active;
        address owner;
    }
    
    /// @dev Mapping: cidHash => latest grant (only stores most recent)
    mapping(bytes32 => HashGrant) public hashGrants;
    
    // ========================================================================
    // Events
    // ========================================================================
    
    /// @dev Emitted when a patient updates their record
    event RecordUpdated(address indexed patient, string cid);
    
    /// @dev Emitted when access is granted to a file
    event GrantRecorded(
        string indexed cid,
        address indexed granter,
        string granteePubkey,
        uint256 expiryTimestamp
    );
    
    /// @dev Emitted when a grant is revoked
    event GrantRevoked(
        string indexed cid,
        address indexed granter,
        string granteePubkey
    );
    
    // ========================================================================
    // Gas-Optimized Events (using bytes32 cidHash)
    // ========================================================================
    
    /// @dev Emitted when a record is uploaded (gas-optimized with bytes32 hash)
    event UploadRecorded(bytes32 indexed cidHash, address indexed owner, uint256 ts);
    
    /// @dev Emitted when access is granted (gas-optimized with bytes32 hash)
    event AccessGranted(bytes32 indexed cidHash, address indexed owner, address grantee, uint256 expiry);
    
    /// @dev Emitted when access is revoked (gas-optimized with bytes32 hash)
    event AccessRevoked(bytes32 indexed cidHash, address indexed owner);
    
    // ========================================================================
    // Record Management
    // ========================================================================
    
    /**
     * @dev Set the patient's current record CID
     * @param cid IPFS Content Identifier of the encrypted record
     */
    function setRecord(string calldata cid) external {
        records[msg.sender] = cid;
        emit RecordUpdated(msg.sender, cid);
    }

    /**
     * @dev Get a patient's record CID
     * @param patient Address of the patient
     * @return The CID string
     */
    function getRecord(address patient) external view returns (string memory) {
        return records[patient];
    }
    
    // ========================================================================
    // Grant Management
    // ========================================================================
    
    /**
     * @dev Record a new access grant on-chain
     * @param cid IPFS CID of the file being granted
     * @param granteePubkey Grantee's Umbral public key (hex string)
     * @param expiryTimestamp Unix timestamp when grant expires (0 = no expiry)
     */
    function recordGrant(
        string calldata cid,
        string calldata granteePubkey,
        uint256 expiryTimestamp
    ) external {
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(bytes(granteePubkey).length > 0, "Grantee pubkey cannot be empty");
        
        grants[cid][granteePubkey] = Grant({
            isActive: true,
            expiryTimestamp: expiryTimestamp,
            granter: msg.sender,
            createdAt: block.timestamp
        });
        
        emit GrantRecorded(cid, msg.sender, granteePubkey, expiryTimestamp);
    }
    
    /**
     * @dev Revoke an existing grant
     * @param cid IPFS CID of the file
     * @param granteePubkey Grantee's public key to revoke
     */
    function revokeGrant(
        string calldata cid,
        string calldata granteePubkey
    ) external {
        Grant storage grant = grants[cid][granteePubkey];
        
        require(grant.isActive, "Grant is not active");
        require(grant.granter == msg.sender, "Only granter can revoke");
        
        grant.isActive = false;
        
        emit GrantRevoked(cid, msg.sender, granteePubkey);
    }
    
    /**
     * @dev View grant details
     * @param cid IPFS CID of the file
     * @param granteePubkey Grantee's public key
     * @return isActive Whether the grant is currently active
     * @return expiryTimestamp When the grant expires (0 = no expiry)
     * @return granter Address of the granter
     */
    function viewGrant(
        string calldata cid,
        string calldata granteePubkey
    ) external view returns (
        bool isActive,
        uint256 expiryTimestamp,
        address granter
    ) {
        Grant storage grant = grants[cid][granteePubkey];
        return (grant.isActive, grant.expiryTimestamp, grant.granter);
    }
    
    /**
     * @dev Check if a grant is valid (active and not expired)
     * @param cid IPFS CID of the file
     * @param granteePubkey Grantee's public key
     * @return valid True if grant is active and not expired
     */
    function isGrantValid(
        string calldata cid,
        string calldata granteePubkey
    ) external view returns (bool valid) {
        Grant storage grant = grants[cid][granteePubkey];
        
        if (!grant.isActive) {
            return false;
        }
        
        // If expiry is 0, grant never expires
        if (grant.expiryTimestamp == 0) {
            return true;
        }
        
        // Check if expired
        return block.timestamp <= grant.expiryTimestamp;
    }
    
    // ========================================================================
    // Gas-Optimized Functions (using bytes32 cidHash)
    // ========================================================================
    
    /**
     * @dev Record an upload using cidHash for gas optimization
     * @param cidHash keccak256(abi.encodePacked(cid)) of the CID string
     * 
     * Gas savings: bytes32 is cheaper than string storage
     */
    function recordUpload(bytes32 cidHash) external {
        emit UploadRecorded(cidHash, msg.sender, block.timestamp);
    }
    
    /**
     * @dev Grant access using cidHash for gas optimization
     * @param cidHash keccak256(abi.encodePacked(cid)) of the CID string
     * @param grantee Address of the grantee
     * @param expiry Unix timestamp when grant expires (0 = no expiry)
     * 
     * Gas savings: Uses address instead of pubkey string, bytes32 for cidHash
     */
    function grantAccessByHash(
        bytes32 cidHash,
        address grantee,
        uint256 expiry
    ) external {
        require(grantee != address(0), "Invalid grantee address");
        
        hashGrants[cidHash] = HashGrant({
            grantee: grantee,
            expiry: expiry,
            active: true,
            owner: msg.sender
        });
        
        emit AccessGranted(cidHash, msg.sender, grantee, expiry);
    }
    
    /**
     * @dev Revoke access using cidHash
     * @param cidHash keccak256(abi.encodePacked(cid)) of the CID string
     */
    function revokeAccessByHash(bytes32 cidHash) external {
        HashGrant storage grant = hashGrants[cidHash];
        require(grant.active, "Grant is not active");
        require(grant.owner == msg.sender, "Only owner can revoke");
        
        grant.active = false;
        
        emit AccessRevoked(cidHash, msg.sender);
    }
    
    /**
     * @dev Signal CEK rotation / bulk revocation for a CID (no grant required)
     * @param cidHash keccak256(abi.encodePacked(cid)) of the CID string
     * 
     * This function allows file owners to emit a revocation event to signal
     * that the Content Encryption Key has been rotated. Unlike revokeAccessByHash,
     * this does not require an active grant to exist.
     * 
     * Use case: When rotating CEK after revoking all grants, emit this event
     * to create an on-chain audit trail of the key rotation.
     */
    function signalKeyRotation(bytes32 cidHash) external {
        // No grant check - this is a signal that the owner is rotating keys
        // The event serves as an audit trail for key rotation
        emit AccessRevoked(cidHash, msg.sender);
    }
    
    /**
     * @dev Get the latest grant for a cidHash
     * @param cidHash keccak256(abi.encodePacked(cid)) of the CID string
     * @return grantee Address of the grantee
     * @return expiry Unix timestamp when grant expires (0 = no expiry)
     * @return active Whether the grant is currently active
     */
    function getLatestGrant(bytes32 cidHash) external view returns (
        address grantee,
        uint256 expiry,
        bool active
    ) {
        HashGrant storage grant = hashGrants[cidHash];
        return (grant.grantee, grant.expiry, grant.active);
    }
    
    /**
     * @dev Utility: Compute cidHash from a CID string (for convenience)
     * @param cid The CID string
     * @return cidHash The keccak256 hash
     * 
     * Note: Clients can also compute this off-chain using ethers.js:
     * ethers.keccak256(ethers.toUtf8Bytes(cid))
     */
    function computeCidHash(string calldata cid) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(cid));
    }
}
