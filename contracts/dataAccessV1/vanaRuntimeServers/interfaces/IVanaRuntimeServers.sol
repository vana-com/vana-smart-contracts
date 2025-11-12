// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IVanaRuntimeServers
 * @notice Interface for the VanaRuntimeServers contract
 * @dev Registers and manages Vana Runtime server instances
 */
interface IVanaRuntimeServers {
    /**
     * @notice Structure representing a Vana Runtime server
     * @param id Unique server identifier
     * @param owner Owner of the runtime server
     * @param runtimeAddress Address representing the runtime's identity
     * @param publicKey Public key of the runtime server
     * @param escrowedPrivateKey Private key encrypted with PGE's public key
     * @param url URL endpoint for the runtime server
     * @param isActive Whether the server is currently active
     * @param registeredAt Timestamp when server was registered
     */
    struct Server {
        uint256 id;
        address owner;
        address runtimeAddress;
        bytes publicKey;
        bytes escrowedPrivateKey;
        string url;
        bool isActive;
        uint256 registeredAt;
    }

    /**
     * @notice Emitted when a new runtime server is registered
     * @param serverId The unique server identifier
     * @param owner Owner of the runtime
     * @param runtimeAddress Address of the runtime
     * @param url URL endpoint for the runtime
     */
    event ServerRegistered(
        uint256 indexed serverId,
        address indexed owner,
        address indexed runtimeAddress,
        string url
    );

    /**
     * @notice Emitted when a runtime server is deactivated
     * @param serverId The server identifier that was deactivated
     */
    event ServerDeactivated(uint256 indexed serverId);

    /**
     * @notice Emitted when a runtime server is reactivated
     * @param serverId The server identifier that was reactivated
     */
    event ServerReactivated(uint256 indexed serverId);

    /**
     * @notice Emitted when a runtime server's URL is updated
     * @param serverId The server identifier
     * @param newUrl The new URL endpoint
     */
    event ServerUrlUpdated(uint256 indexed serverId, string newUrl);

    /**
     * @notice Register a new Vana Runtime server
     * @param owner Owner address of the runtime
     * @param runtimeAddress Address representing the runtime's identity
     * @param publicKey Public key of the runtime
     * @param escrowedPrivateKey Private key encrypted with PGE's public key
     * @param url URL endpoint for accessing the runtime
     * @return serverId The unique identifier for the registered server
     */
    function registerServer(
        address owner,
        address runtimeAddress,
        bytes memory publicKey,
        bytes memory escrowedPrivateKey,
        string memory url
    ) external returns (uint256 serverId);

    /**
     * @notice Deactivate a runtime server
     * @param serverId The server to deactivate
     */
    function deactivateServer(uint256 serverId) external;

    /**
     * @notice Reactivate a runtime server
     * @param serverId The server to reactivate
     */
    function reactivateServer(uint256 serverId) external;

    /**
     * @notice Update the URL for a runtime server
     * @param serverId The server to update
     * @param newUrl The new URL endpoint
     */
    function updateServerUrl(uint256 serverId, string memory newUrl) external;

    /**
     * @notice Get server details
     * @param serverId The server identifier
     * @return server The server structure
     */
    function getServer(
        uint256 serverId
    ) external view returns (Server memory server);

    /**
     * @notice Get server by runtime address
     * @param runtimeAddress The runtime address to look up
     * @return server The server structure
     */
    function getServerByAddress(
        address runtimeAddress
    ) external view returns (Server memory server);

    /**
     * @notice Get all servers owned by an address
     * @param owner The owner address
     * @return servers Array of server structures
     */
    function getServersByOwner(
        address owner
    ) external view returns (Server[] memory servers);

    /**
     * @notice Get the owner of a runtime address
     * @param runtimeAddress The runtime address
     * @return owner The owner address
     */
    function getOwnerOfRuntime(
        address runtimeAddress
    ) external view returns (address owner);

    /**
     * @notice Check if a runtime address is registered
     * @param runtimeAddress The runtime address to check
     * @return isRegistered True if the runtime is registered
     */
    function isRuntimeRegistered(
        address runtimeAddress
    ) external view returns (bool isRegistered);

    /**
     * @notice Check if a runtime is active
     * @param runtimeAddress The runtime address to check
     * @return isActive True if the runtime is active
     */
    function isRuntimeActive(
        address runtimeAddress
    ) external view returns (bool isActive);
}
