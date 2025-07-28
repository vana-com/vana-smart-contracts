// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";

/**
 * @title IDataPortabilityServers
 * @author Vana Network
 * @notice Interface for managing data portability servers in the Vana ecosystem
 * @dev This contract manages server registration, trust relationships, and user-server associations
 *      for data portability operations. Servers are used to facilitate secure data transfer and processing.
 * 
 * Key Features:
 * - Server registration with public key and URL
 * - User-based server trust management with time-bounded trust periods
 * - Role-based access control for administrative operations
 * - EIP-712 signature-based operations for secure off-chain interactions
 * 
 * Security Considerations:
 * - All user operations use nonce-based replay protection
 * - Server trust relationships are time-bounded with start and end blocks
 * - Administrative operations require appropriate role permissions
 * - Server addresses are unique across the system
 * 
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityServers {
    /**
     * @notice User data structure containing nonce and trusted server information
     * @dev Stores per-user state including replay protection and server trust relationships
     * @param nonce Current nonce for replay protection, incremented with each signed operation
     * @param trustedServers Mapping of server ID to trust relationship details
     * @param trustedServerIds Set of currently trusted server IDs for efficient enumeration
     */
    struct User {
        uint256 nonce;
        mapping(uint256 serverId => TrustedServer trustedServer) trustedServers;
        EnumerableSet.UintSet trustedServerIds;
    }

    /**
     * @notice Server registration data structure
     * @dev Contains all information needed to identify and communicate with a server
     * @param owner Address that owns and controls this server registration
     * @param serverAddress Unique blockchain address representing this server
     * @param publicKey Public key for encrypting communications with this server
     * @param url HTTP/HTTPS endpoint where the server can be reached
     */
    struct Server {
        address owner;
        address serverAddress;
        string publicKey;
        string url;
    }

    /**
     * @notice Trust relationship between a user and a server
     * @dev Time-bounded trust allows for automatic expiration and access control
     * @param startBlock Block number when trust relationship becomes active
     * @param endBlock Block number when trust relationship expires (type(uint256).max for indefinite)
     */
    struct TrustedServer {
        uint256 startBlock;
        uint256 endBlock;
    }

    /**
     * @notice Complete server information for external consumption
     * @dev Read-only structure combining server details with ID
     * @param id Unique numerical identifier for the server
     * @param owner Address that owns and controls this server
     * @param serverAddress Unique blockchain address representing this server
     * @param publicKey Public key for encrypting communications with this server
     * @param url HTTP/HTTPS endpoint where the server can be reached
     */
    struct ServerInfo {
        uint256 id;
        address owner;
        address serverAddress;
        string publicKey;
        string url;
    }

    /**
     * @notice Input structure for adding a server without signature verification
     * @dev Used for direct calls that don't require EIP-712 signature verification
     * @param serverAddress Unique blockchain address for the new server
     * @param publicKey Public key for server communications
     * @param serverUrl HTTP/HTTPS endpoint for the server
     */
    struct AddServerInput {
        address serverAddress;
        string publicKey;
        string serverUrl;
    }

    /**
     * @notice Input structure for adding a server with EIP-712 signature verification
     * @dev Used for signed operations that require nonce-based replay protection
     * @param nonce Current user nonce for replay protection
     * @param serverAddress Unique blockchain address for the new server
     * @param publicKey Public key for server communications
     * @param serverUrl HTTP/HTTPS endpoint for the server
     */
    struct AddServerWithSignatureInput {
        uint256 nonce;
        address serverAddress;
        string publicKey;
        string serverUrl;
    }

    /**
     * @notice Input structure for trusting a server with signature verification
     * @dev Used for EIP-712 signed trust operations
     * @param nonce Current user nonce for replay protection
     * @param serverId ID of the server to trust
     */
    struct TrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }

    /**
     * @notice Input structure for untrusting a server with signature verification
     * @dev Used for EIP-712 signed untrust operations
     * @param nonce Current user nonce for replay protection
     * @param serverId ID of the server to untrust
     */
    struct UntrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }

    // ==================== EVENTS ====================

    /**
     * @notice Emitted when a new server is registered in the system
     * @dev This event provides all necessary information to track server registrations
     * @param serverId Unique numerical identifier assigned to the new server
     * @param owner Address that owns and controls this server registration
     * @param serverAddress Unique blockchain address representing this server
     * @param publicKey Public key for encrypting communications with this server
     * @param url HTTP/HTTPS endpoint where the server can be reached
     */
    event ServerRegistered(
        uint256 indexed serverId,
        address indexed owner,
        address indexed serverAddress,
        string publicKey,
        string url
    );

    /**
     * @notice Emitted when a server's URL is updated
     * @dev Only the server owner can update the URL
     * @param serverId Unique identifier of the updated server
     * @param url New HTTP/HTTPS endpoint for the server
     */
    event ServerUpdated(uint256 indexed serverId, string url);

    /**
     * @notice Emitted when a user establishes trust with a server
     * @dev Trust relationships are time-bounded and can expire
     * @param user Address of the user establishing trust
     * @param serverId Unique identifier of the trusted server
     */
    event ServerTrusted(address indexed user, uint256 indexed serverId);

    /**
     * @notice Emitted when a user revokes trust from a server
     * @dev Untrusting sets the end block to current block, immediately terminating access
     * @param user Address of the user revoking trust
     * @param serverId Unique identifier of the untrusted server
     */
    event ServerUntrusted(address indexed user, uint256 indexed serverId);

    // ==================== SERVER MANAGEMENT FUNCTIONS ====================

    /**
     * @notice Registers a new server using EIP-712 signature verification
     * @dev Verifies signature against AddServer type hash and increments user nonce
     * @param addServerInput Server registration details including nonce for replay protection
     * @param signature EIP-712 signature proving authorization from the server owner
     * 
     * Requirements:
     * - Signature must be valid for the provided input
     * - Nonce must match the current user nonce
     * - Server address must not be already registered
     * - Public key and URL must not be empty
     * - Contract must not be paused
     * 
     * Effects:
     * - Increments the signer's nonce
     * - Registers the server with a new unique ID
     * - Emits ServerRegistered event
     * 
     * @custom:signature-format AddServer(uint256 nonce,address serverAddress,string publicKey,string serverUrl)
     */
    function addServerWithSignature(
        AddServerWithSignatureInput calldata addServerInput,
        bytes calldata signature
    ) external;

    /**
     * @notice Registers a new server and immediately establishes trust using EIP-712 signature
     * @dev Combines server registration and trust establishment in a single atomic operation
     * @param addServerInput Server registration details including nonce for replay protection
     * @param signature EIP-712 signature proving authorization from the server owner
     * 
     * Requirements:
     * - All requirements from addServerWithSignature
     * - Trust establishment requirements (server must exist after registration)
     * 
     * Effects:
     * - All effects from addServerWithSignature
     * - Establishes trust relationship between signer and new server
     * - Emits ServerTrusted event in addition to ServerRegistered
     * 
     * @custom:signature-format AddServer(uint256 nonce,address serverAddress,string publicKey,string serverUrl)
     */
    function addAndTrustServerWithSignature(
        AddServerWithSignatureInput calldata addServerInput,
        bytes calldata signature
    ) external;

    /**
     * @notice Registers a server and establishes trust on behalf of another address
     * @dev Administrative function for authorized roles to manage servers for users
     * @param ownerAddress Address that will own the registered server
     * @param addServerInput Server registration details (no nonce required)
     * 
     * Requirements:
     * - Caller must have PERMISSION_MANAGER_ROLE
     * - Server address must not be already registered
     * - Public key and URL must not be empty
     * - Owner address must not be zero
     * - Contract must not be paused
     * 
     * Effects:
     * - Registers the server with the specified owner
     * - Establishes trust relationship between owner and new server
     * - Emits ServerRegistered and ServerTrusted events
     * 
     * @custom:access-control Requires PERMISSION_MANAGER_ROLE
     */
    function addAndTrustServerOnBehalf(address ownerAddress, AddServerInput calldata addServerInput) external;

    /**
     * @notice Updates the URL of an existing server
     * @dev Only the server owner can update the URL
     * @param serverId Unique identifier of the server to update
     * @param url New HTTP/HTTPS endpoint for the server
     * 
     * Requirements:
     * - Caller must be the server owner
     * - Server must exist
     * - URL must not be empty
     * - Contract must not be paused
     * 
     * Effects:
     * - Updates the server's URL
     * - Emits ServerUpdated event
     */
    function updateServer(uint256 serverId, string memory url) external;

    /**
     * @notice Establishes trust with a server
     * @dev Creates a time-bounded trust relationship starting from current block
     * @param serverId Unique identifier of the server to trust
     * 
     * Requirements:
     * - Server must exist
     * - Server must not already be trusted and active
     * - Contract must not be paused
     * 
     * Effects:
     * - Creates or reactivates trust relationship
     * - Sets start block to current block and end block to max uint256
     * - Adds server to user's trusted server set
     * - Emits ServerTrusted event
     */
    function trustServer(uint256 serverId) external;

    /**
     * @notice Establishes trust with a server using EIP-712 signature verification
     * @dev Same as trustServer but with signature-based authorization
     * @param trustServerInput Trust operation details including nonce
     * @param signature EIP-712 signature proving authorization
     * 
     * Requirements:
     * - All requirements from trustServer
     * - Signature must be valid for the provided input
     * - Nonce must match the current user nonce
     * 
     * Effects:
     * - All effects from trustServer
     * - Increments the signer's nonce
     * 
     * @custom:signature-format TrustServer(uint256 nonce,uint256 serverId)
     */
    function trustServerWithSignature(TrustServerInput calldata trustServerInput, bytes calldata signature) external;

    /**
     * @notice Revokes trust from a server
     * @dev Immediately terminates the trust relationship by setting end block to current block
     * @param serverId Unique identifier of the server to untrust
     * 
     * Requirements:
     * - Server must be currently trusted and active
     * - Contract must not be paused
     * 
     * Effects:
     * - Sets trust end block to current block
     * - Emits ServerUntrusted event
     */
    function untrustServer(uint256 serverId) external;

    /**
     * @notice Revokes trust from a server using EIP-712 signature verification
     * @dev Same as untrustServer but with signature-based authorization
     * @param untrustServerInput Untrust operation details including nonce
     * @param signature EIP-712 signature proving authorization
     * 
     * Requirements:
     * - All requirements from untrustServer
     * - Signature must be valid for the provided input
     * - Nonce must match the current user nonce
     * 
     * Effects:
     * - All effects from untrustServer
     * - Increments the signer's nonce
     * 
     * @custom:signature-format UntrustServer(uint256 nonce,uint256 serverId)
     */
    function untrustServerWithSignature(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) external;

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Checks if a server is registered and active in the system
     * @dev A server is active if it exists (serverId > 0 and <= serversCount)
     * @param serverId Unique identifier of the server to check
     * @return bool True if the server is registered and active, false otherwise
     */
    function isActiveServer(uint256 serverId) external view returns (bool);

    /**
     * @notice Checks if a server is currently trusted by a specific user
     * @dev Checks both server existence and active trust relationship within time bounds
     * @param userAddress Address of the user to check trust relationship for
     * @param serverId Unique identifier of the server to check
     * @return bool True if user currently trusts the server (within start/end block range)
     */
    function isActiveServerForUser(address userAddress, uint256 serverId) external view returns (bool);

    /**
     * @notice Retrieves server information by server address
     * @dev Looks up server details using the server's blockchain address
     * @param serverAddress Blockchain address of the server to look up
     * @return ServerInfo Complete server information including ID, owner, and connection details
     */
    function serverByAddress(address serverAddress) external view returns (ServerInfo memory);

    /**
     * @notice Gets all trusted server IDs for a user
     * @dev Returns the complete list of server IDs the user has trust relationships with
     * @param user Address of the user to query trusted servers for
     * @return uint256[] Array of server IDs trusted by the user (may include expired trusts)
     */
    function userServerIdsValues(address user) external view returns (uint256[] memory);

    /**
     * @notice Gets a specific trusted server ID by index for a user
     * @dev Provides indexed access to user's trusted server list
     * @param user Address of the user to query
     * @param serverIndex Zero-based index in the user's trusted server list
     * @return uint256 Server ID at the specified index
     */
    function userServerIdsAt(address user, uint256 serverIndex) external view returns (uint256);

    /**
     * @notice Gets the number of trusted servers for a user
     * @dev Returns the total count of servers in the user's trust list
     * @param user Address of the user to query
     * @return uint256 Number of trusted servers for the user
     */
    function userServerIdsLength(address user) external view returns (uint256);

    // ==================== PUBLIC STORAGE GETTERS ====================

    /**
     * @notice Gets the current trusted forwarder address for meta-transactions
     * @dev Used for EIP-2771 meta-transaction support
     * @return address Current trusted forwarder address
     */
    function trustedForwarder() external view returns (address);

    /**
     * @notice Gets the total number of registered servers
     * @dev Servers are numbered sequentially starting from 1
     * @return uint256 Total count of registered servers
     */
    function serversCount() external view returns (uint256);

    /**
     * @notice Maps a server address to its unique server ID
     * @dev Returns 0 if the server address is not registered
     * @param serverAddress Blockchain address of the server
     * @return uint256 Server ID (0 if not registered)
     */
    function serverAddressToId(address serverAddress) external view returns (uint256);

    /**
     * @notice Gets complete server information by server ID
     * @dev Returns all server details including owner, address, public key, and URL
     * @param serverId Unique identifier of the server
     * @return ServerInfo Complete server information struct
     */
    function servers(uint256 serverId) external view returns (ServerInfo memory);

    /**
     * @notice Gets user information including nonce and trusted server IDs
     * @dev Provides access to user's nonce for replay protection and trust relationships
     * @param userAddress Address of the user to query
     * @return nonce Current nonce for the user (used for signature replay protection)
     * @return trustedServerIds Array of server IDs trusted by the user
     */
    function users(address userAddress) external view returns (uint256 nonce, uint256[] memory trustedServerIds);

    // ==================== USER MANAGEMENT FUNCTIONS ====================

    /**
     * @notice Gets the current nonce for a user
     * @dev Nonce is used for EIP-712 signature replay protection
     * @param user Address of the user to query
     * @return uint256 Current nonce value for the user
     */
    function userNonce(address user) external view returns (uint256);

    /**
     * @notice Sets the nonce for a user (admin function)
     * @dev Used for administrative nonce management, requires MAINTAINER_ROLE
     * @param user Address of the user to modify
     * @param nonce New nonce value to set
     * 
     * Requirements:
     * - Caller must have MAINTAINER_ROLE
     * 
     * @custom:access-control Requires MAINTAINER_ROLE
     */
    function setUserNonce(address user, uint256 nonce) external;

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
