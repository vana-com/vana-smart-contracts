// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";
import "../../dataPortabilityServers/interfaces/IDataPortabilityServers.sol";
import "../../dataPortabilityGrantees/interfaces/IDataPortabilityGrantees.sol";

/**
 * @title IDataPortabilityPermissions
 * @author Vana Network
 * @notice Interface for managing data portability permissions in the Vana ecosystem
 * @dev This contract manages permissions that grant data access rights to authorized grantees.
 *      It integrates with DataRegistry for file management, DataPortabilityServers for server
 *      management, and DataPortabilityGrantees for grantee management.
 *
 * Key Features:
 * - EIP-712 signature-based permission granting for secure off-chain authorization
 * - Time-bounded permissions with automatic expiration support
 * - Integration with file registry for ownership verification
 * - Batch operations for server registration, file addition, and permission granting
 * - Role-based access control for administrative operations
 *
 * Permission Lifecycle:
 * 1. Files are registered in DataRegistry with proper ownership
 * 2. Grantees are registered in DataPortabilityGrantees system
 * 3. Permissions are created linking files to grantees with specific grants
 * 4. Permissions can be revoked by the grantor before expiration
 *
 * Security Considerations:
 * - All user operations use nonce-based replay protection via EIP-712
 * - File ownership is verified before granting permissions
 * - Permissions are time-bounded with block-based start/end times
 * - Only file owners can grant permissions for their files
 * - Grantee existence is verified before permission creation
 *
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityPermissions {
    /**
     * @notice User data structure containing nonce and permission information
     * @dev Stores per-user state for replay protection and permission tracking
     * @param nonce Current nonce for replay protection, incremented with each signed operation
     * @param permissionIds Set of permission IDs granted by this user for efficient enumeration
     */
    struct User {
        uint256 nonce;
        EnumerableSet.UintSet permissionIds;
    }

    /**
     * @notice Internal permission data structure with full relationship mappings
     * @dev Contains all permission details including file associations and time bounds
     * @param grantor Address that granted this permission (must be file owner)
     * @param nonce Nonce value from the grantor at time of permission creation
     * @param granteeId Unique identifier of the grantee receiving access rights
     * @param grant IPFS or other URI describing the granted permissions and access rights
     * @param signature EIP-712 signature proving authorization from the grantor
     * @param startBlock Block number when permission becomes active
     * @param endBlock Block number when permission expires (type(uint256).max for indefinite)
     * @param fileIds Set of file IDs covered by this permission
     */
    struct Permission {
        address grantor;
        uint256 nonce;
        uint256 granteeId;
        string grant;
        bytes signature;
        uint256 startBlock;
        uint256 endBlock;
        EnumerableSet.UintSet fileIds;
    }

    /**
     * @notice External permission information structure for read operations
     * @dev Read-only view of permission data with file IDs as array for external consumption
     * @param id Unique permission identifier
     * @param grantor Address that granted this permission
     * @param nonce Nonce value from the grantor at time of creation
     * @param granteeId Unique identifier of the grantee
     * @param grant IPFS or other URI describing the granted permissions
     * @param signature EIP-712 signature proving grantor authorization
     * @param startBlock Block number when permission becomes active
     * @param endBlock Block number when permission expires
     * @param fileIds Array of file IDs covered by this permission
     */
    struct PermissionInfo {
        uint256 id;
        address grantor;
        uint256 nonce;
        uint256 granteeId;
        string grant;
        bytes signature;
        uint256 startBlock;
        uint256 endBlock;
        uint256[] fileIds;
    }

    /**
     * @notice Input structure for basic permission creation with signature verification
     * @dev Used for standard EIP-712 signed permission operations
     * @param nonce Current user nonce for replay protection
     * @param granteeId Unique identifier of the grantee to grant access to
     * @param grant IPFS or other URI describing the specific permissions being granted
     * @param fileIds Array of file IDs to include in this permission
     */
    struct PermissionInput {
        uint256 nonce;
        uint256 granteeId;
        string grant;
        uint256[] fileIds;
    }

    /**
     * @notice Input structure for combined server registration, file addition, and permission creation
     * @dev Used for atomic operations that set up complete data portability infrastructure
     * @param nonce Current user nonce for replay protection
     * @param granteeId Unique identifier of the grantee to grant access to
     * @param grant IPFS or other URI describing the specific permissions being granted
     * @param fileUrls Array of file URLs to register (new files will be created if not existing)
     * @param serverAddress Blockchain address for the data portability server
     * @param serverUrl HTTP/HTTPS endpoint where the server can be reached
     * @param serverPublicKey Public key for encrypting communications with the server
     */
    struct ServerFilesAndPermissionInput {
        uint256 nonce;
        uint256 granteeId;
        string grant;
        string[] fileUrls;
        address serverAddress;
        string serverUrl;
        string serverPublicKey;
    }

    /**
     * @notice Input structure for permission revocation with signature verification
     * @dev Used for EIP-712 signed permission revocation operations
     * @param nonce Current user nonce for replay protection
     * @param permissionId Unique identifier of the permission to revoke
     */
    struct RevokePermissionInput {
        uint256 nonce;
        uint256 permissionId;
    }

    // ==================== EVENTS ====================

    /**
     * @notice Emitted when a new permission is granted
     * @dev This event provides complete information about the permission creation
     * @param permissionId Unique identifier assigned to the new permission
     * @param user Address of the user (grantor) who granted the permission
     * @param granteeId Unique identifier of the grantee receiving access rights
     * @param grant IPFS or other URI describing the specific permissions granted
     * @param fileIds Array of file IDs covered by this permission
     */
    event PermissionAdded(
        uint256 indexed permissionId,
        address indexed user,
        uint256 indexed granteeId,
        string grant,
        uint256[] fileIds
    );

    /**
     * @notice Emitted when a permission is revoked by the grantor
     * @dev Revocation immediately terminates access by setting end block to current block
     * @param permissionId Unique identifier of the revoked permission
     */
    event PermissionRevoked(uint256 indexed permissionId);

    // ==================== CORE FUNCTIONS ====================

    /**
     * @notice Returns the current version of the contract implementation
     * @dev Used for tracking contract upgrades and compatibility
     * @return uint256 Current version number
     */
    function version() external pure returns (uint256);

    /**
     * @notice Pauses the contract, disabling most functions
     * @dev Emergency function to halt contract operations
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * - Contract must not already be paused
     *
     * Effects:
     * - Pauses the contract
     * - Most functions will revert with "Pausable: paused"
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function pause() external;

    /**
     * @notice Unpauses the contract, re-enabling functions
     * @dev Restores normal contract operations after pause
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * - Contract must be currently paused
     *
     * Effects:
     * - Unpauses the contract
     * - All functions return to normal operation
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function unpause() external;

    // ==================== PUBLIC STORAGE GETTERS ====================

    /**
     * @notice Gets the current trusted forwarder address for meta-transactions
     * @dev Used for EIP-2771 meta-transaction support
     * @return address Current trusted forwarder address
     */
    function trustedForwarder() external view returns (address);

    /**
     * @notice Gets the total number of permissions created
     * @dev Permissions are numbered sequentially starting from 1
     * @return uint256 Total count of permissions created
     */
    function permissionsCount() external view returns (uint256);

    /**
     * @notice Gets the current DataRegistry contract address
     * @dev Used for file ownership verification and management
     * @return IDataRegistry Current DataRegistry contract interface
     */
    function dataRegistry() external view returns (IDataRegistry);

    /**
     * @notice Gets the current DataPortabilityServers contract address
     * @dev Used for server registration and trust management
     * @return IDataPortabilityServers Current DataPortabilityServers contract interface
     */
    function dataPortabilityServers() external view returns (IDataPortabilityServers);

    /**
     * @notice Gets the current DataPortabilityGrantees contract address
     * @dev Used for grantee registration and validation
     * @return IDataPortabilityGrantees Current DataPortabilityGrantees contract interface
     */
    function dataPortabilityGrantees() external view returns (IDataPortabilityGrantees);

    /**
     * @notice Gets user information including nonce and permission IDs
     * @dev Provides access to user's nonce for replay protection and granted permissions
     * @param userAddress Address of the user to query
     * @return nonce Current nonce for the user (used for signature replay protection)
     * @return permissionIds Array of permission IDs granted by the user
     */
    function users(address userAddress) external view returns (uint256 nonce, uint256[] memory permissionIds);

    /**
     * @notice Gets complete permission information by permission ID
     * @dev Returns all permission details including files, grantee, and time bounds
     * @param permissionId Unique identifier of the permission
     * @return PermissionInfo Complete permission information struct
     */
    function permissions(uint256 permissionId) external view returns (PermissionInfo memory);

    /**
     * @notice Gets all permission IDs associated with a file
     * @dev Returns permissions that include the specified file (both active and expired)
     * @param fileId Unique identifier of the file
     * @return uint256[] Array of permission IDs that include this file
     */
    function filePermissions(uint256 fileId) external view returns (uint256[] memory);

    // ==================== CONTRACT MANAGEMENT ====================

    /**
     * @notice Updates the DataRegistry contract address
     * @dev Administrative function to change the file registry integration
     * @param newDataRegistry New DataRegistry contract interface
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * - New address must not be zero
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function updateDataRegistry(IDataRegistry newDataRegistry) external;

    /**
     * @notice Updates the trusted forwarder address for meta-transactions
     * @dev Used to change the EIP-2771 trusted forwarder for meta-transaction support
     * @param trustedForwarderAddress New trusted forwarder address
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external;

    /**
     * @notice Updates the DataPortabilityServers contract address
     * @dev Administrative function to change the server registry integration
     * @param newServersContract New DataPortabilityServers contract interface
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * - New address must not be zero
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function updateServersContract(IDataPortabilityServers newServersContract) external;

    /**
     * @notice Updates the DataPortabilityGrantees contract address
     * @dev Administrative function to change the grantee registry integration
     * @param newGranteesContract New DataPortabilityGrantees contract interface
     *
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * - New address must not be zero
     *
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function updateGranteesContract(IDataPortabilityGrantees newGranteesContract) external;

    // ==================== PERMISSION MANAGEMENT ====================

    /**
     * @notice Creates a new permission using EIP-712 signature verification
     * @dev Grants access to specified files for a grantee with signature-based authorization
     * @param permission Permission details including nonce, grantee, grant description, and file IDs
     * @param signature EIP-712 signature proving authorization from the file owner
     * @return uint256 Unique identifier of the created permission
     *
     * Requirements:
     * - Signature must be valid for the provided input
     * - Nonce must match the current user nonce
     * - Grant description must not be empty
     * - Grantee must exist in the grantees registry
     * - Signer must own all specified files
     * - Contract must not be paused
     *
     * Effects:
     * - Increments the signer's nonce
     * - Creates a new permission with unique ID
     * - Associates all specified files with the permission
     * - Adds permission to user's permission list
     * - Notifies grantees contract of new permission
     * - Emits PermissionAdded event
     *
     * @custom:signature-format Permission(uint256 nonce,uint256 granteeId,string grant,uint256[] fileIds)
     */
    function addPermission(PermissionInput calldata permission, bytes calldata signature) external returns (uint256);

    /**
     * @notice Creates server, registers files, and grants permissions in one atomic operation
     * @dev Comprehensive function that sets up complete data portability infrastructure
     * @param serverFilesAndPermissionInput Combined input for server, files, and permission details
     * @param signature EIP-712 signature proving authorization from the user
     * @return uint256 Unique identifier of the created permission
     *
     * Requirements:
     * - All requirements from addPermission
     * - Server registration requirements (unique address, valid URL, non-empty public key)
     * - File URLs must be valid (new files will be created, existing files must be owned by signer)
     *
     * Effects:
     * - All effects from addPermission
     * - Registers and trusts new server for the user
     * - Creates new files in DataRegistry for non-existing URLs
     * - Validates ownership of existing files
     * - Emits ServerRegistered, ServerTrusted, and PermissionAdded events
     *
     * @custom:signature-format ServerFilesAndPermission(uint256 nonce,uint256 granteeId,string grant,string[] fileUrls,address serverAddress,string serverUrl,string serverPublicKey)
     */
    function addServerFilesAndPermissions(
        ServerFilesAndPermissionInput calldata serverFilesAndPermissionInput,
        bytes calldata signature
    ) external returns (uint256);

    /**
     * @notice Revokes a permission immediately
     * @dev Sets the permission's end block to current block, terminating access
     * @param permissionId Unique identifier of the permission to revoke
     *
     * Requirements:
     * - Caller must be the permission grantor
     * - Permission must be currently active
     * - Contract must not be paused
     *
     * Effects:
     * - Sets permission end block to current block
     * - Removes permission from user's active permissions
     * - Notifies grantees contract of permission removal
     * - Emits PermissionRevoked event
     */
    function revokePermission(uint256 permissionId) external;

    /**
     * @notice Revokes a permission using EIP-712 signature verification
     * @dev Same as revokePermission but with signature-based authorization
     * @param revokePermissionInput Revocation details including nonce and permission ID
     * @param signature EIP-712 signature proving authorization from the grantor
     *
     * Requirements:
     * - All requirements from revokePermission
     * - Signature must be valid for the provided input
     * - Nonce must match the current user nonce
     *
     * Effects:
     * - All effects from revokePermission
     * - Increments the signer's nonce
     *
     * @custom:signature-format RevokePermission(uint256 nonce,uint256 permissionId)
     */
    function revokePermissionWithSignature(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) external;

    /**
     * @notice Gets all file IDs associated with a permission
     * @dev Returns the complete list of files covered by the specified permission
     * @param permissionId Unique identifier of the permission
     * @return uint256[] Array of file IDs included in this permission
     */
    function permissionFileIds(uint256 permissionId) external view returns (uint256[] memory);

    /**
     * @notice Gets all permission IDs that include a specific file
     * @dev Returns permissions that grant access to the specified file
     * @param fileId Unique identifier of the file
     * @return uint256[] Array of permission IDs that include this file
     */
    function filePermissionIds(uint256 fileId) external view returns (uint256[] memory);

    // ==================== USER MANAGEMENT ====================

    /**
     * @notice Gets the current nonce for a user
     * @dev Nonce is used for EIP-712 signature replay protection
     * @param user Address of the user to query
     * @return uint256 Current nonce value for the user
     */
    function userNonce(address user) external view returns (uint256);

    /**
     * @notice Gets all permission IDs granted by a user
     * @dev Returns the complete list of permissions the user has granted
     * @param user Address of the user to query
     * @return uint256[] Array of permission IDs granted by the user
     */
    function userPermissionIdsValues(address user) external view returns (uint256[] memory);

    /**
     * @notice Gets a specific permission ID by index for a user
     * @dev Provides indexed access to user's granted permissions list
     * @param user Address of the user to query
     * @param permissionIndex Zero-based index in the user's permission list
     * @return uint256 Permission ID at the specified index
     */
    function userPermissionIdsAt(address user, uint256 permissionIndex) external view returns (uint256);

    /**
     * @notice Gets the number of permissions granted by a user
     * @dev Returns the total count of permissions in the user's granted list
     * @param user Address of the user to query
     * @return uint256 Number of permissions granted by the user
     */
    function userPermissionIdsLength(address user) external view returns (uint256);
}
