// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title IDataPortabilityGrantees
 * @author Vana Network
 * @notice Interface for managing data portability grantees in the Vana ecosystem
 * @dev This contract manages the registry of authorized grantees who can receive data access permissions.
 *      Grantees are entities (individuals, organizations, or services) that can be granted access to user data
 *      through the data portability system.
 * 
 * Key Features:
 * - Grantee registration with owner, address, and public key
 * - Permission tracking for each grantee
 * - Address-based grantee lookup for efficient queries
 * - Role-based access control for administrative operations
 * - Integration with DataPortabilityPermissions for permission management
 * 
 * Grantee Lifecycle:
 * 1. Grantees are registered with an owner, grantee address, and public key
 * 2. Permissions are associated with grantees via DataPortabilityPermissions contract
 * 3. Permission associations are managed by authorized contracts (PERMISSION_MANAGER_ROLE)
 * 4. Grantees can be queried by ID or address for permission verification
 * 
 * Security Considerations:
 * - Only authorized contracts can modify permission associations
 * - Grantee registration is open but creates immutable records
 * - Public keys are stored for encryption and verification purposes
 * - Administrative functions require appropriate role permissions
 * 
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityGrantees {
    /**
     * @notice Internal grantee data structure with permission tracking
     * @dev Contains complete grantee information including permission associations
     * @param owner Address that registered and controls this grantee
     * @param granteeAddress Unique blockchain address representing this grantee
     * @param publicKey Public key for encrypting data intended for this grantee
     * @param permissionIds Set of permission IDs associated with this grantee for efficient enumeration
     */
    struct Grantee {
        address owner;
        address granteeAddress;
        string publicKey;
        EnumerableSet.UintSet permissionIds;
    }

    /**
     * @notice External grantee information structure for read operations
     * @dev Read-only view of grantee data with permission IDs as array for external consumption
     * @param owner Address that registered and controls this grantee
     * @param granteeAddress Unique blockchain address representing this grantee
     * @param publicKey Public key for encrypting data intended for this grantee
     * @param permissionIds Array of permission IDs associated with this grantee
     */
    struct GranteeInfo {
        address owner;
        address granteeAddress;
        string publicKey;
        uint256[] permissionIds;
    }

    /**
     * @notice External grantee information structure for read operations
     * @dev Read-only view of grantee data with permission count for external consumption
     * @dev Keep GranteeInfo for backward compatibility
     * @param owner Address that registered and controls this grantee
     * @param granteeAddress Unique blockchain address representing this grantee
     * @param publicKey Public key for encrypting data intended for this grantee
     * @param permissionsCount Number of permissions associated with this grantee
     */
    struct GranteeInfoV2 {
        address owner;
        address granteeAddress;
        string publicKey;
        uint256 permissionsCount;
    }

    // ==================== EVENTS ====================

    /**
     * @notice Emitted when a new grantee is registered in the system
     * @dev This event provides all necessary information to track grantee registrations
     * @param granteeId Unique numerical identifier assigned to the new grantee
     * @param owner Address that registered and will control this grantee
     * @param granteeAddress Unique blockchain address representing this grantee
     * @param publicKey Public key for encrypting data intended for this grantee
     */
    event GranteeRegistered(
        uint256 indexed granteeId,
        address indexed owner,
        address indexed granteeAddress,
        string publicKey
    );

    // ==================== PUBLIC STORAGE GETTERS ====================

    /**
     * @notice Gets the current trusted forwarder address for meta-transactions
     * @dev Used for EIP-2771 meta-transaction support
     * @return address Current trusted forwarder address
     */
    function trustedForwarder() external view returns (address);

    /**
     * @notice Gets the total number of registered grantees
     * @dev Grantees are numbered sequentially starting from 1
     * @return uint256 Total count of registered grantees
     */
    function granteesCount() external view returns (uint256);

    /**
     * @notice Maps a grantee address to its unique grantee ID
     * @dev Returns 0 if the grantee address is not registered
     * @param granteeAddress Blockchain address of the grantee
     * @return uint256 Grantee ID (0 if not registered)
     */
    function granteeAddressToId(address granteeAddress) external view returns (uint256);

    /**
     * @notice Gets complete grantee information by grantee ID
     * @dev Returns all grantee details including owner, address, public key, and permissions
     * @param granteeId Unique identifier of the grantee
     * @return GranteeInfo Complete grantee information struct
     */
    function grantees(uint256 granteeId) external view returns (GranteeInfo memory);

    function granteesV2(uint256 granteeId) external view returns (GranteeInfoV2 memory);

    /**
     * @notice Gets all permission IDs associated with a grantee
     * @dev Returns the complete list of permissions granted to the specified grantee
     * @param granteeId Unique identifier of the grantee
     * @return uint256[] Array of permission IDs associated with this grantee
     */
    function granteePermissions(uint256 granteeId) external view returns (uint256[] memory);
    
    // ==================== GRANTEE MANAGEMENT FUNCTIONS ====================

    /**
     * @notice Registers a new grantee in the system
     * @dev Creates a new grantee entry with unique ID and associates it with the provided details
     * @param owner Address that will own and control this grantee registration
     * @param granteeAddress Unique blockchain address representing this grantee
     * @param publicKey Public key for encrypting data intended for this grantee
     * @return uint256 Unique identifier assigned to the new grantee
     * 
     * Requirements:
     * - Grantee address must not be already registered
     * - Owner address must not be zero
     * - Grantee address must not be zero
     * - Public key must not be empty
     * - Contract must not be paused
     * 
     * Effects:
     * - Increments grantees count
     * - Creates new grantee entry with unique ID
     * - Maps grantee address to ID for lookup
     * - Emits GranteeRegistered event
     */
    function registerGrantee(
        address owner,
        address granteeAddress,
        string memory publicKey
    ) external returns (uint256);

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Gets complete grantee information by grantee ID
     * @dev Alias for grantees() function, returns all grantee details
     * @param granteeId Unique identifier of the grantee
     * @return GranteeInfo Complete grantee information struct
     */
    function granteeInfo(uint256 granteeId) external view returns (GranteeInfo memory);

    function granteeInfoV2(uint256 granteeId) external view returns (GranteeInfoV2 memory);

    /**
     * @notice Retrieves grantee information by grantee address
     * @dev Looks up grantee details using the grantee's blockchain address
     * @param granteeAddress Blockchain address of the grantee to look up
     * @return GranteeInfo Complete grantee information including ID, owner, and permissions
     */
    function granteeByAddress(address granteeAddress) external view returns (GranteeInfo memory);

    function granteeByAddressV2(address granteeAddress) external view returns (GranteeInfoV2 memory);

    /**
     * @notice Gets all permission IDs associated with a grantee
     * @dev Alias for granteePermissions() function, returns permission associations
     * @param granteeId Unique identifier of the grantee
     * @return uint256[] Array of permission IDs associated with this grantee
     */
    function granteePermissionIds(uint256 granteeId) external view returns (uint256[] memory);

    /**
     * @notice Gets paginated permission IDs associated with a grantee
     * @dev Returns a subset of permission IDs to avoid gas limit issues with large lists
     * @param granteeId Unique identifier of the grantee
     * @param offset Starting index for pagination (0-based)
     * @param limit Maximum number of permission IDs to return
     * @return permissionIds Array of permission IDs for the requested page
     * @return totalCount Total number of permissions associated with the grantee
     * @return hasMore Boolean indicating if there are more permissions beyond this page
     *
     * Requirements:
     * - Grantee must exist
     * - Offset must be less than total permission count
     *
     * Example usage:
     * - First page: granteePermissionsPaginated(granteeId, 0, 100)
     * - Second page: granteePermissionsPaginated(granteeId, 100, 100)
     * - Continue until hasMore is false
     */
    function granteePermissionsPaginated(
        uint256 granteeId,
        uint256 offset,
        uint256 limit
    ) external view returns (
        uint256[] memory permissionIds,
        uint256 totalCount,
        bool hasMore
    );

    // ==================== PERMISSION MANAGEMENT FUNCTIONS ====================

    /**
     * @notice Associates a permission with a grantee
     * @dev Administrative function called by DataPortabilityPermissions contract
     * @param granteeId Unique identifier of the grantee to associate the permission with
     * @param permissionId Unique identifier of the permission to associate
     * 
     * Requirements:
     * - Caller must have PERMISSION_MANAGER_ROLE
     * - Grantee must exist
     * - Permission must not already be associated with the grantee
     * - Contract must not be paused
     * 
     * Effects:
     * - Adds permission ID to grantee's permission set
     * 
     * @custom:access-control Requires PERMISSION_MANAGER_ROLE
     */
    function addPermissionToGrantee(uint256 granteeId, uint256 permissionId) external;

    /**
     * @notice Removes a permission association from a grantee
     * @dev Administrative function called by DataPortabilityPermissions contract
     * @param granteeId Unique identifier of the grantee to remove the permission from
     * @param permissionId Unique identifier of the permission to remove
     * 
     * Requirements:
     * - Caller must have PERMISSION_MANAGER_ROLE
     * - Grantee must exist
     * - Permission must be currently associated with the grantee
     * - Contract must not be paused
     * 
     * Effects:
     * - Removes permission ID from grantee's permission set
     * 
     * @custom:access-control Requires PERMISSION_MANAGER_ROLE
     */
    function removePermissionFromGrantee(uint256 granteeId, uint256 permissionId) external;
    
    // ==================== ADMIN FUNCTIONS ====================

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
}