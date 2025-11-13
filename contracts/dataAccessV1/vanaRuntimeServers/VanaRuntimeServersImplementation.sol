// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IVanaRuntimeServers.sol";

/**
 * @title VanaRuntimeServersImplementation
 * @notice Implementation of the VanaRuntimeServers contract
 * @dev Registers and manages Vana Runtime server instances
 */
contract VanaRuntimeServersImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IVanaRuntimeServers
{
    /// @notice Role for runtime registration operations
    bytes32 public constant RUNTIME_REGISTRAR_ROLE =
        keccak256("RUNTIME_REGISTRAR_ROLE");

    /// @notice Counter for server IDs
    uint256 private _serverIdCounter;

    /// @notice Mapping from server ID to Server struct
    mapping(uint256 => Server) private _servers;

    /// @notice Mapping from runtime address to server ID
    mapping(address => uint256) private _runtimeToServerId;

    /// @notice Mapping from owner to array of server IDs
    mapping(address => uint256[]) private _ownerServers;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RUNTIME_REGISTRAR_ROLE, admin);

        _serverIdCounter = 1; // Start from 1
    }

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
    ) external override nonReentrant returns (uint256) {
        require(
            hasRole(RUNTIME_REGISTRAR_ROLE, msg.sender) ||
                msg.sender == owner,
            "Not authorized"
        );
        require(owner != address(0), "Invalid owner address");
        require(runtimeAddress != address(0), "Invalid runtime address");
        require(publicKey.length > 0, "Invalid public key");
        require(escrowedPrivateKey.length > 0, "Invalid escrowed key");
        require(bytes(url).length > 0, "Invalid URL");
        require(
            _runtimeToServerId[runtimeAddress] == 0,
            "Runtime already registered"
        );

        uint256 serverId = _serverIdCounter++;

        _servers[serverId] = Server({
            id: serverId,
            owner: owner,
            runtimeAddress: runtimeAddress,
            publicKey: publicKey,
            escrowedPrivateKey: escrowedPrivateKey,
            url: url,
            isActive: true,
            registeredAt: block.timestamp
        });

        _runtimeToServerId[runtimeAddress] = serverId;
        _ownerServers[owner].push(serverId);

        emit ServerRegistered(serverId, owner, runtimeAddress, url);

        return serverId;
    }

    /**
     * @notice Deactivate a runtime server
     * @param serverId The server to deactivate
     */
    function deactivateServer(uint256 serverId) external override {
        Server storage server = _servers[serverId];
        require(server.id != 0, "Server not found");
        require(
            msg.sender == server.owner ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(server.isActive, "Server already inactive");

        server.isActive = false;

        emit ServerDeactivated(serverId);
    }

    /**
     * @notice Reactivate a runtime server
     * @param serverId The server to reactivate
     */
    function reactivateServer(uint256 serverId) external override {
        Server storage server = _servers[serverId];
        require(server.id != 0, "Server not found");
        require(
            msg.sender == server.owner ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(!server.isActive, "Server already active");

        server.isActive = true;

        emit ServerReactivated(serverId);
    }

    /**
     * @notice Update the URL for a runtime server
     * @param serverId The server to update
     * @param newUrl The new URL endpoint
     */
    function updateServerUrl(
        uint256 serverId,
        string memory newUrl
    ) external override {
        Server storage server = _servers[serverId];
        require(server.id != 0, "Server not found");
        require(
            msg.sender == server.owner ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(bytes(newUrl).length > 0, "Invalid URL");

        server.url = newUrl;

        emit ServerUrlUpdated(serverId, newUrl);
    }

    /**
     * @notice Get server details
     * @param serverId The server identifier
     * @return server The server structure
     */
    function getServer(
        uint256 serverId
    ) external view override returns (Server memory) {
        require(_servers[serverId].id != 0, "Server not found");
        return _servers[serverId];
    }

    /**
     * @notice Get server by runtime address
     * @param runtimeAddress The runtime address to look up
     * @return server The server structure
     */
    function getServerByAddress(
        address runtimeAddress
    ) external view override returns (Server memory) {
        uint256 serverId = _runtimeToServerId[runtimeAddress];
        require(serverId != 0, "Runtime not registered");
        return _servers[serverId];
    }

    /**
     * @notice Get all servers owned by an address
     * @param owner The owner address
     * @return servers Array of server structures
     */
    function getServersByOwner(
        address owner
    ) external view override returns (Server[] memory) {
        uint256[] memory serverIds = _ownerServers[owner];
        Server[] memory servers = new Server[](serverIds.length);

        for (uint256 i = 0; i < serverIds.length; i++) {
            servers[i] = _servers[serverIds[i]];
        }

        return servers;
    }

    /**
     * @notice Get the owner of a runtime address
     * @param runtimeAddress The runtime address
     * @return owner The owner address
     */
    function getOwnerOfRuntime(
        address runtimeAddress
    ) external view override returns (address) {
        uint256 serverId = _runtimeToServerId[runtimeAddress];
        require(serverId != 0, "Runtime not registered");
        return _servers[serverId].owner;
    }

    /**
     * @notice Check if a runtime address is registered
     * @param runtimeAddress The runtime address to check
     * @return isRegistered True if the runtime is registered
     */
    function isRuntimeRegistered(
        address runtimeAddress
    ) external view override returns (bool) {
        return _runtimeToServerId[runtimeAddress] != 0;
    }

    /**
     * @notice Check if a runtime is active
     * @param runtimeAddress The runtime address to check
     * @return isActive True if the runtime is active
     */
    function isRuntimeActive(
        address runtimeAddress
    ) external view override returns (bool) {
        uint256 serverId = _runtimeToServerId[runtimeAddress];
        if (serverId == 0) return false;
        return _servers[serverId].isActive;
    }

    /**
     * @dev Required override for UUPS upgrades
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[50] private __gap;
}
