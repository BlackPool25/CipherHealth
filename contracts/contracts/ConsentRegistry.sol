// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ConsentRegistry
 * @dev Consent management contract with comprehensive audit events.
 * 
 * This contract manages patient consent for health record access with:
 * - Hash-based identifiers for privacy (keccak256)
 * - Time-based access grants with configurable expiry
 * - Complete audit trail via events
 * - Hospital-to-hospital transfer support
 * 
 * Security:
 * - Only stores hashed identifiers on-chain (no plaintext PHI)
 * - All CIDs, patient IDs, hospital IDs are hashed with keccak256
 * - Actual encrypted data is stored off-chain on Storacha/IPFS
 * 
 * Events emitted (per design spec):
 * - UploadRecorded: When a file is uploaded
 * - AccessRequested: When a hospital requests access
 * - AccessGranted: When a patient grants access
 * - AccessRedeemed: When a hospital accesses the file
 * - AccessRevoked: When access is revoked
 */
contract ConsentRegistry {
    // ========================================================================
    // State Variables
    // ========================================================================
    
    /// @dev Grant struct storing access grant details
    struct Grant {
        bytes32 hospitalIdHash;     // keccak256(hospitalId)
        uint256 expiry;             // Unix timestamp when grant expires
        bool active;                // Whether grant is currently active
        uint256 createdAt;          // Block timestamp when grant was created
    }
    
    /// @dev Access request struct
    struct AccessRequest {
        bytes32 requesterHash;      // keccak256(requesterId)
        uint256 requestedAt;        // Block timestamp of request
        bool pending;               // Whether request is still pending
    }
    
    /// @dev Mapping: cidHash => patientIdHash => hospitalIdHash => Grant
    mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => Grant))) public grants;
    
    /// @dev Mapping: cidHash => patientIdHash => AccessRequest[]
    mapping(bytes32 => mapping(bytes32 => AccessRequest[])) public accessRequests;
    
    /// @dev Mapping: cidHash => uploaded (to track uploads)
    mapping(bytes32 => bool) public uploadedCids;
    
    /// @dev Patient preferences for allowing transfers
    mapping(bytes32 => bool) public allowsTransfers;
    
    // ========================================================================
    // Events (Exactly as specified in design doc)
    // ========================================================================
    
    /**
     * @dev Emitted when a file is uploaded
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId) - the uploader
     * @param actor Address of the uploader
     * @param ts Block timestamp
     */
    event UploadRecorded(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 indexed hospitalIdHash,
        address actor,
        uint256 ts
    );
    
    /**
     * @dev Emitted when a hospital requests access to a file
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param requesterHash keccak256(requesterId)
     * @param ts Block timestamp
     */
    event AccessRequested(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 indexed requesterHash,
        uint256 ts
    );
    
    /**
     * @dev Emitted when a patient grants access to a hospital
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     * @param expiry Unix timestamp when grant expires
     * @param ts Block timestamp
     */
    event AccessGranted(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 indexed hospitalIdHash,
        uint256 expiry,
        uint256 ts
    );
    
    /**
     * @dev Emitted when a hospital redeems/accesses the file
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     * @param actor Address of the accessor
     * @param ts Block timestamp
     */
    event AccessRedeemed(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 indexed hospitalIdHash,
        address actor,
        uint256 ts
    );
    
    /**
     * @dev Emitted when access is revoked
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     * @param ts Block timestamp
     */
    event AccessRevoked(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 indexed hospitalIdHash,
        uint256 ts
    );
    
    /**
     * @dev Emitted when access is transferred from one hospital to another
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param fromHospitalHash keccak256(fromHospitalId)
     * @param toHospitalHash keccak256(toHospitalId)
     * @param ts Block timestamp
     */
    event AccessTransferred(
        bytes32 indexed cidHash,
        bytes32 indexed patientIdHash,
        bytes32 fromHospitalHash,
        bytes32 toHospitalHash,
        uint256 ts
    );
    
    // ========================================================================
    // Upload Functions
    // ========================================================================
    
    /**
     * @dev Record an upload on-chain
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId) - the uploader
     */
    function recordUpload(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash
    ) external {
        require(cidHash != bytes32(0), "Invalid cidHash");
        require(patientIdHash != bytes32(0), "Invalid patientIdHash");
        
        uploadedCids[cidHash] = true;
        
        emit UploadRecorded(
            cidHash,
            patientIdHash,
            hospitalIdHash,
            msg.sender,
            block.timestamp
        );
    }
    
    // ========================================================================
    // Access Request Functions
    // ========================================================================
    
    /**
     * @dev Request access to a file
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param requesterHash keccak256(requesterId)
     */
    function requestAccess(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 requesterHash
    ) external {
        require(cidHash != bytes32(0), "Invalid cidHash");
        require(patientIdHash != bytes32(0), "Invalid patientIdHash");
        require(requesterHash != bytes32(0), "Invalid requesterHash");
        
        accessRequests[cidHash][patientIdHash].push(AccessRequest({
            requesterHash: requesterHash,
            requestedAt: block.timestamp,
            pending: true
        }));
        
        emit AccessRequested(
            cidHash,
            patientIdHash,
            requesterHash,
            block.timestamp
        );
    }
    
    // ========================================================================
    // Grant Functions
    // ========================================================================
    
    /**
     * @dev Grant access to a hospital
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     * @param expiry Unix timestamp when grant expires (0 = no expiry)
     */
    function grantAccess(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash,
        uint256 expiry
    ) external {
        require(cidHash != bytes32(0), "Invalid cidHash");
        require(patientIdHash != bytes32(0), "Invalid patientIdHash");
        require(hospitalIdHash != bytes32(0), "Invalid hospitalIdHash");
        
        grants[cidHash][patientIdHash][hospitalIdHash] = Grant({
            hospitalIdHash: hospitalIdHash,
            expiry: expiry,
            active: true,
            createdAt: block.timestamp
        });
        
        emit AccessGranted(
            cidHash,
            patientIdHash,
            hospitalIdHash,
            expiry,
            block.timestamp
        );
    }
    
    /**
     * @dev Record that a hospital has redeemed/accessed a file
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     */
    function redeemAccess(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash
    ) external {
        Grant storage grant = grants[cidHash][patientIdHash][hospitalIdHash];
        require(grant.active, "No active grant");
        
        // Check expiry if set
        if (grant.expiry > 0) {
            require(block.timestamp <= grant.expiry, "Grant expired");
        }
        
        emit AccessRedeemed(
            cidHash,
            patientIdHash,
            hospitalIdHash,
            msg.sender,
            block.timestamp
        );
    }
    
    /**
     * @dev Revoke access from a hospital
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     */
    function revokeAccess(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash
    ) external {
        Grant storage grant = grants[cidHash][patientIdHash][hospitalIdHash];
        require(grant.active, "No active grant to revoke");
        
        grant.active = false;
        
        emit AccessRevoked(
            cidHash,
            patientIdHash,
            hospitalIdHash,
            block.timestamp
        );
    }
    
    // ========================================================================
    // Transfer Functions
    // ========================================================================
    
    /**
     * @dev Set patient preference for allowing transfers
     * @param patientIdHash keccak256(patientId)
     * @param allowed Whether transfers are allowed
     */
    function setTransferPreference(
        bytes32 patientIdHash,
        bool allowed
    ) external {
        allowsTransfers[patientIdHash] = allowed;
    }
    
    /**
     * @dev Transfer access from one hospital to another
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param fromHospitalHash keccak256(fromHospitalId)
     * @param toHospitalHash keccak256(toHospitalId)
     * @param newExpiry Expiry for the new grant
     */
    function transferAccess(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 fromHospitalHash,
        bytes32 toHospitalHash,
        uint256 newExpiry
    ) external {
        require(allowsTransfers[patientIdHash], "Patient does not allow transfers");
        
        Grant storage fromGrant = grants[cidHash][patientIdHash][fromHospitalHash];
        require(fromGrant.active, "Source hospital has no active grant");
        
        // Revoke from source hospital
        fromGrant.active = false;
        
        emit AccessRevoked(
            cidHash,
            patientIdHash,
            fromHospitalHash,
            block.timestamp
        );
        
        // Grant to target hospital
        grants[cidHash][patientIdHash][toHospitalHash] = Grant({
            hospitalIdHash: toHospitalHash,
            expiry: newExpiry,
            active: true,
            createdAt: block.timestamp
        });
        
        emit AccessGranted(
            cidHash,
            patientIdHash,
            toHospitalHash,
            newExpiry,
            block.timestamp
        );
        
        emit AccessTransferred(
            cidHash,
            patientIdHash,
            fromHospitalHash,
            toHospitalHash,
            block.timestamp
        );
    }
    
    // ========================================================================
    // View Functions
    // ========================================================================
    
    /**
     * @dev Check if a grant is valid (active and not expired)
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     * @return valid True if grant is active and not expired
     */
    function isGrantValid(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash
    ) external view returns (bool valid) {
        Grant storage grant = grants[cidHash][patientIdHash][hospitalIdHash];
        
        if (!grant.active) {
            return false;
        }
        
        if (grant.expiry == 0) {
            return true; // No expiry
        }
        
        return block.timestamp <= grant.expiry;
    }
    
    /**
     * @dev Get grant details
     * @param cidHash keccak256(cid)
     * @param patientIdHash keccak256(patientId)
     * @param hospitalIdHash keccak256(hospitalId)
     */
    function getGrant(
        bytes32 cidHash,
        bytes32 patientIdHash,
        bytes32 hospitalIdHash
    ) external view returns (
        bool active,
        uint256 expiry,
        uint256 createdAt
    ) {
        Grant storage grant = grants[cidHash][patientIdHash][hospitalIdHash];
        return (grant.active, grant.expiry, grant.createdAt);
    }
    
    // ========================================================================
    // Utility Functions
    // ========================================================================
    
    /**
     * @dev Compute keccak256 hash of a string (utility for clients)
     * @param input The string to hash
     * @return The keccak256 hash
     */
    function computeHash(string calldata input) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(input));
    }
}
