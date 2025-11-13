// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IVanaRuntimePermissions
 * @notice Interface for the VanaRuntimePermissions contract
 * @dev Manages permissions for Vana Runtime operations on datasets
 */
interface IVanaRuntimePermissions {
    /**
     * @notice Structure representing a permission grant
     * @param id Unique permission identifier
     * @param datasetId Dataset this permission applies to
     * @param nonce Nonce for permission versioning
     * @param granteeId ID of the data consumer
     * @param grant IPFS hash pointing to the permission grant details
     * @param startBlock Block number when permission becomes active
     * @param endBlock Block number when permission expires
     */
    struct Permission {
        uint256 id;
        uint256 datasetId;
        uint256 nonce;
        uint256 granteeId;
        string grant; // Stored offchain (e.g. IPFS)
        uint256 startBlock;
        uint256 endBlock;
    }

    /**
     * @notice Emitted when a new permission is created
     * @param permissionId The unique permission identifier
     * @param datasetId Dataset the permission applies to
     * @param granteeId ID of the grantee
     * @param grant IPFS hash of the permission details
     */
    event PermissionCreated(
        uint256 indexed permissionId,
        uint256 indexed datasetId,
        uint256 indexed granteeId,
        string grant
    );

    /**
     * @notice Emitted when a permission is revoked
     * @param permissionId The permission identifier that was revoked
     */
    event PermissionRevoked(uint256 indexed permissionId);

    /**
     * @notice Emitted when a permission is updated
     * @param permissionId The permission identifier
     * @param newGrant New IPFS hash of the permission details
     */
    event PermissionUpdated(uint256 indexed permissionId, string newGrant);

    /**
     * @notice Create a new permission for dataset access
     * @param datasetId Dataset to grant permission for
     * @param granteeId ID of the data consumer receiving permission
     * @param grant IPFS hash containing permission details (pricing, parameters, etc.)
     * @param startBlock Block when permission becomes active
     * @param endBlock Block when permission expires
     * @return permissionId The unique identifier for the created permission
     */
    function createPermission(
        uint256 datasetId,
        uint256 granteeId,
        string memory grant,
        uint256 startBlock,
        uint256 endBlock
    ) external returns (uint256 permissionId);

    /**
     * @notice Revoke an existing permission
     * @param permissionId The permission to revoke
     */
    function revokePermission(uint256 permissionId) external;

    /**
     * @notice Update an existing permission's grant details
     * @param permissionId The permission to update
     * @param newGrant New IPFS hash containing updated permission details
     */
    function updatePermission(
        uint256 permissionId,
        string memory newGrant
    ) external;

    /**
     * @notice Get permission details
     * @param permissionId The permission identifier
     * @return permission The permission structure
     */
    function getPermission(
        uint256 permissionId
    ) external view returns (Permission memory permission);

    /**
     * @notice Check if a permission is currently active
     * @param permissionId The permission identifier
     * @return isActive True if the permission is active at current block
     */
    function isPermissionActive(
        uint256 permissionId
    ) external view returns (bool isActive);

    /**
     * @notice Get all permissions for a dataset
     * @param datasetId The dataset identifier
     * @return permissions Array of permission structures
     */
    function getDatasetPermissions(
        uint256 datasetId
    ) external view returns (Permission[] memory permissions);

    /**
     * @notice Get all permissions for a grantee
     * @param granteeId The grantee identifier
     * @return permissions Array of permission structures
     */
    function getGranteePermissions(
        uint256 granteeId
    ) external view returns (Permission[] memory permissions);
}
