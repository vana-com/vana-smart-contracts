// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPermissionsStorageV1.sol";

contract DataPermissionsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    EIP712Upgradeable,
    DataPermissionsStorageV1
{
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    string private constant SIGNING_DOMAIN = "VanaDataPermissions";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant PERMISSION_TYPEHASH =
        keccak256("Permission(uint256 nonce,uint256 applicationId,string grant,uint256[] fileIds)");
    bytes32 private constant REVOKE_PERMISSION_TYPEHASH =
        keccak256("RevokePermission(uint256 nonce,uint256 permissionId)");
    bytes32 private constant TRUST_SERVER_TYPEHASH =
        keccak256("TrustServer(uint256 nonce,bytes serverPublicKey,string serverUrl)");
    bytes32 private constant UNTRUST_SERVER_TYPEHASH = keccak256("UntrustServer(uint256 nonce,uint256 serverId)");

    /**
     * @notice Triggered when a permission has been added
     *
     * @param permissionId                      id of the permission
     * @param user                              address of the user
     * @param applicationId                     id of the application
     * @param grant                             grant of the permission
     */
    event PermissionAdded(
        uint256 indexed permissionId,
        address indexed user,
        uint256 indexed applicationId,
        string grant,
        uint256[] fileIds
    );
    event PermissionRevoked(uint256 indexed permissionId);
    event ServerRegistered(uint256 indexed serverId, address indexed serverAddress, string url);
    event ServerTrusted(address indexed user, uint256 indexed serverId, string serverUrl);
    event ServerUntrusted(address indexed user, uint256 indexed serverId);
    event ApplicationRegistered(uint256 indexed applicationId, address indexed applicationAddress);

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error GrantAlreadyUsed();
    error InvalidSignature();
    error EmptyGrant();
    error EmptyUrl();
    error ZeroAddress();
    error EmptyPublicKey();
    error ServerUrlMismatch(string existingUrl, string providedUrl);
    error ServerNotFound();
    error ServerAlreadyRegistered();
    error ServerNotTrusted();
    error ApplicationNotFound();
    error ApplicationAlreadyRegistered();
    error InactivePermission(uint256 permissionId);
    error NotPermissionGrantor(address permissionOwner, address requestor);
    error NotFileOwner(address fileOwner, address requestor);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
     * @param trustedForwarderAddress           address of the trusted forwarder
     * @param ownerAddress                      address of the owner
     */
    function initialize(
        address trustedForwarderAddress,
        address ownerAddress,
        IDataRegistry dataRegistryAddress
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _trustedForwarder = trustedForwarderAddress;
        _dataRegistry = dataRegistryAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    function _checkRole(bytes32 role) internal view override {
        _checkRole(role, msg.sender);
    }

    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoleAdmin(role, adminRole);
    }

    /**
     * @dev Returns the address of the trusted forwarder.
     */
    function trustedForwarder() public view virtual override returns (address) {
        return _trustedForwarder;
    }

    /**
     * @notice Returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Update the trusted forwarder
     *
     * @param trustedForwarderAddress                  address of the trusted forwarder
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function dataRegistry() external view returns (IDataRegistry) {
        return _dataRegistry;
    }

    function updateDataRegistry(IDataRegistry newDataRegistry) external onlyRole(MAINTAINER_ROLE) {
        if (address(newDataRegistry) == address(0)) {
            revert ZeroAddress();
        }
        _dataRegistry = newDataRegistry;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Derive address from public key
     */
    function _deriveAddress(bytes memory publicKey) internal pure returns (address) {
        if (publicKey.length != 64) {
            revert EmptyPublicKey();
        }
        return address(uint160(uint256(keccak256(publicKey))));
    }

    /**
     * @notice Register a new application
     */
    function registerApplication(bytes memory publicKey) external whenNotPaused returns (uint256) {
        if (publicKey.length == 0) {
            revert EmptyPublicKey();
        }

        address applicationAddress = _deriveAddress(publicKey);

        if (_applicationAddressToId[applicationAddress] != 0) {
            revert ApplicationAlreadyRegistered();
        }

        uint256 applicationId = ++applicationsCount;

        Application storage application = _applications[applicationId];
        application.publicKey = publicKey;

        _applicationAddressToId[applicationAddress] = applicationId;

        emit ApplicationRegistered(applicationId, applicationAddress);

        return applicationId;
    }

    /**
     * @notice Register a new server
     */
    function registerServer(bytes memory publicKey, string memory url) external whenNotPaused returns (uint256) {
        if (publicKey.length == 0) {
            revert EmptyPublicKey();
        }

        if (bytes(url).length == 0) {
            revert EmptyUrl();
        }

        address serverAddress = _deriveAddress(publicKey);

        if (_serverAddressToId[serverAddress] != 0) {
            revert ServerAlreadyRegistered();
        }

        uint256 serverId = ++serversCount;

        Server storage server = _servers[serverId];
        server.publicKey = publicKey;
        server.url = url;

        _serverAddressToId[serverAddress] = serverId;

        emit ServerRegistered(serverId, serverAddress, url);

        return serverId;
    }

    /**
     * @notice Extract the signer from the permission and signature using EIP-712
     *
     * @param permission                        permission input data
     * @param signature                         signature for the permission
     * @return address                          address of the signer
     */
    function _extractSignerFromPermission(
        PermissionInput calldata permission,
        bytes calldata signature
    ) internal view returns (address) {
        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(
                PERMISSION_TYPEHASH,
                permission.nonce,
                permission.applicationId,
                keccak256(bytes(permission.grant)),
                keccak256(abi.encodePacked(permission.fileIds))
            )
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromRevokePermission(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) internal view returns (address) {
        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(REVOKE_PERMISSION_TYPEHASH, revokePermissionInput.nonce, revokePermissionInput.permissionId)
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromTrustServer(
        TrustServerInput calldata trustServerInput,
        bytes calldata signature
    ) internal view returns (address) {
        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(
                TRUST_SERVER_TYPEHASH,
                trustServerInput.nonce,
                keccak256(trustServerInput.serverPublicKey),
                keccak256(bytes(trustServerInput.serverUrl))
            )
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromUntrustServer(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) internal view returns (address) {
        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(UNTRUST_SERVER_TYPEHASH, untrustServerInput.nonce, untrustServerInput.serverId)
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSigner(bytes32 structHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature);
    }

    /**
     * @notice Returns all permission IDs for a user
     *
     * @param user                              address of the user
     * @return uint256[]                        array of permission IDs
     */
    function userPermissionIdsValues(address user) external view returns (uint256[] memory) {
        return _users[user].permissionIds.values();
    }

    /**
     * @notice Returns a permission ID at a specific index for a user
     *
     * @param user                              address of the user
     * @param permissionIndex                   index of the permission
     * @return uint256                          permission ID
     */
    function userPermissionIdsAt(address user, uint256 permissionIndex) external view returns (uint256) {
        return _users[user].permissionIds.at(permissionIndex);
    }

    /**
     * @notice Returns the number of permissions for a user
     *
     * @param user                              address of the user
     * @return uint256                          number of permissions
     */
    function userPermissionIdsLength(address user) external view returns (uint256) {
        return _users[user].permissionIds.length();
    }

    function userRevokedPermissionIdsValues(address user) external view returns (uint256[] memory) {
        return _users[user].revokedPermissionIds.values();
    }

    function userRevokedPermissionIdsAt(address user, uint256 permissionIndex) external view returns (uint256) {
        return _users[user].revokedPermissionIds.at(permissionIndex);
    }

    function userRevokedPermissionIdsLength(address user) external view returns (uint256) {
        return _users[user].revokedPermissionIds.length();
    }

    /**
     * @notice Returns information about a permission
     *
     * @param permissionId                      id of the permission
     * @return Permission                       permission information
     */
    function permissions(uint256 permissionId) external view returns (PermissionInfo memory) {
        Permission storage permission = _permissions[permissionId];
        return
            PermissionInfo({
                id: permissionId,
                grantor: permission.grantor,
                nonce: permission.nonce,
                applicationId: permission.applicationId,
                grant: permission.grant,
                signature: permission.signature,
                isActive: permission.isActive,
                fileIds: permission.fileIds.values()
            });
    }

    /**
     * @notice Returns the current nonce for a user
     *
     * @param user                              address of the user
     * @return uint256                          current nonce
     */
    function userNonce(address user) external view returns (uint256) {
        return _users[user].nonce;
    }

    /**
     * @notice Get permission ID by grant hash
     *
     * @param grant                             the grant to look up
     * @return permissionId                     the ID of the permission (0 if not found)
     */
    function permissionIdByGrant(string memory grant) external view returns (uint256) {
        return _grantHashToPermissionId[keccak256(abi.encodePacked(grant))];
    }

    /**
     * @notice Adds a permission with the provided signature
     *
     * @param permission                        permission input data
     * @param signature                         signature for the permission
     * @return uint256                          id of the created permission
     */
    function addPermission(
        PermissionInput calldata permission,
        bytes calldata signature
    ) external whenNotPaused returns (uint256) {
        address signer = _extractSignerFromPermission(permission, signature);
        User storage user = _users[signer];

        if (permission.nonce != user.nonce) {
            revert InvalidNonce(user.nonce, permission.nonce);
        }

        // Increment user nonce
        ++user.nonce;

        return _addPermission(permission, signature, signer);
    }

    /**
     * @notice Internal function to add a permission
     *
     * @param permissionInput                   permission input data
     * @param signature                         signature for the permission
     * @param signer                            address of the user
     * @return uint256                          id of the created permission
     */
    function _addPermission(
        PermissionInput calldata permissionInput,
        bytes calldata signature,
        address signer
    ) internal returns (uint256) {
        // Validate grant is not empty
        if (bytes(permissionInput.grant).length == 0) {
            revert EmptyGrant();
        }

        // Validate application exists
        if (permissionInput.applicationId == 0 || permissionInput.applicationId > applicationsCount) {
            revert ApplicationNotFound();
        }

        // Check if grant is already used
        bytes32 grantHash = keccak256(abi.encodePacked(permissionInput.grant));
        if (_grantHashToPermissionId[grantHash] != 0) {
            revert GrantAlreadyUsed();
        }

        // Create permission
        uint256 permissionId = ++permissionsCount;

        Permission storage permission = _permissions[permissionId];
        permission.grantor = signer;
        permission.nonce = permissionInput.nonce;
        permission.applicationId = permissionInput.applicationId;
        permission.grant = permissionInput.grant;
        permission.signature = signature;
        permission.isActive = true;

        uint256 fileIdsLength = permissionInput.fileIds.length;
        for (uint256 i = 0; i < fileIdsLength; ) {
            uint256 fileId = permissionInput.fileIds[i];
            address fileOwner = _dataRegistry.files(fileId).ownerAddress;
            if (fileOwner != signer) {
                revert NotFileOwner(fileOwner, signer);
            }
            permission.fileIds.add(fileId);
            _filePermissions[fileId].add(permissionId);
            unchecked {
                ++i;
            }
        }

        // Index by grant hash
        _grantHashToPermissionId[grantHash] = permissionId;

        // Add to user's permission set
        _users[signer].permissionIds.add(permissionId);

        // Add to application's permission set
        _applicationPermissions[permissionInput.applicationId].add(permissionId);

        emit PermissionAdded(
            permissionId,
            signer,
            permissionInput.applicationId,
            permissionInput.grant,
            permissionInput.fileIds
        );

        return permissionId;
    }

    function isActivePermission(uint256 permissionId) external view returns (bool) {
        return _permissions[permissionId].isActive;
    }

    function revokePermission(uint256 permissionId) external whenNotPaused {
        _revokePermission(permissionId, _msgSender());
    }

    function revokePermissionWithSignature(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) external whenNotPaused {
        address signer = _extractSignerFromRevokePermission(revokePermissionInput, signature);

        User storage user = _users[signer];

        if (revokePermissionInput.nonce != user.nonce) {
            revert InvalidNonce(user.nonce, revokePermissionInput.nonce);
        }

        // Increment user nonce
        ++user.nonce;

        // Revoke permission
        _revokePermission(revokePermissionInput.permissionId, signer);
    }

    function _revokePermission(uint256 permissionId, address signer) internal {
        Permission storage permission = _permissions[permissionId];
        if (permission.grantor != signer) {
            revert NotPermissionGrantor(permission.grantor, signer);
        }

        if (!permission.isActive) {
            revert InactivePermission(permissionId);
        }
        // Mark the permission as inactive
        permission.isActive = false;

        // Remove from user's permission set
        User storage user = _users[signer];
        if (!user.permissionIds.remove(permissionId)) {
            revert InactivePermission(permissionId);
        }
        // Add to user's revoked permission set
        user.revokedPermissionIds.add(permissionId);

        emit PermissionRevoked(permissionId);
    }

    function _trustServer(bytes memory serverPublicKey, string memory serverUrl, address signer) internal {
        if (serverPublicKey.length == 0) {
            revert EmptyPublicKey();
        }

        if (bytes(serverUrl).length == 0) {
            revert EmptyUrl();
        }

        address serverAddress = _deriveAddress(serverPublicKey);
        uint256 serverId = _serverAddressToId[serverAddress];

        // Check if server exists
        if (serverId == 0) {
            // Register server automatically
            serverId = ++serversCount;

            Server storage server = _servers[serverId];
            server.publicKey = serverPublicKey;
            server.url = serverUrl;

            _serverAddressToId[serverAddress] = serverId;

            emit ServerRegistered(serverId, serverAddress, serverUrl);
        } else {
            // Verify URL matches
            Server storage existingServer = _servers[serverId];
            if (keccak256(bytes(existingServer.url)) != keccak256(bytes(serverUrl))) {
                revert ServerUrlMismatch(existingServer.url, serverUrl);
            }
        }

        User storage user = _users[signer];

        // Add server to user's set
        user.trustedServerIds.add(serverId);

        emit ServerTrusted(signer, serverId, serverUrl);
    }

    function trustServerWithSignature(
        TrustServerInput calldata trustServerInput,
        bytes calldata signature
    ) external whenNotPaused {
        address signer = _extractSignerFromTrustServer(trustServerInput, signature);

        User storage user = _users[signer];

        if (trustServerInput.nonce != user.nonce) {
            revert InvalidNonce(user.nonce, trustServerInput.nonce);
        }

        // Increment user nonce
        ++user.nonce;

        _trustServer(trustServerInput.serverPublicKey, trustServerInput.serverUrl, signer);
    }

    function trustServer(bytes memory serverPublicKey, string memory serverUrl) external whenNotPaused {
        _trustServer(serverPublicKey, serverUrl, _msgSender());
    }

    function _untrustServer(uint256 serverId, address signer) internal {
        if (serverId == 0) {
            revert ServerNotFound();
        }

        User storage user = _users[signer];

        // Remove server from user's set
        if (!user.trustedServerIds.remove(serverId)) {
            revert ServerNotTrusted();
        }

        emit ServerUntrusted(signer, serverId);
    }

    function untrustServer(uint256 serverId) external whenNotPaused {
        _untrustServer(serverId, _msgSender());
    }

    function untrustServerWithSignature(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) external whenNotPaused {
        address signer = _extractSignerFromUntrustServer(untrustServerInput, signature);
        User storage user = _users[signer];

        if (untrustServerInput.nonce != user.nonce) {
            revert InvalidNonce(user.nonce, untrustServerInput.nonce);
        }

        // Increment nonce
        ++user.nonce;

        _untrustServer(untrustServerInput.serverId, signer);
    }

    /**
     * @notice Returns all server IDs trusted by a user
     *
     * @param user                              address of the user
     * @return uint256[]                        array of server IDs
     */
    function userServerIdsValues(address user) external view returns (uint256[] memory) {
        return _users[user].trustedServerIds.values();
    }

    /**
     * @notice Returns a server ID at a specific index for a user
     *
     * @param user                              address of the user
     * @param serverIndex                       index of the server
     * @return uint256                          server ID
     */
    function userServerIdsAt(address user, uint256 serverIndex) external view returns (uint256) {
        return _users[user].trustedServerIds.at(serverIndex);
    }

    /**
     * @notice Returns the number of servers trusted by a user
     *
     * @param user                              address of the user
     * @return uint256                          number of servers
     */
    function userServerIdsLength(address user) external view returns (uint256) {
        return _users[user].trustedServerIds.length();
    }

    /**
     * @notice Returns information about a server
     *
     * @param serverId                          id of the server
     * @return ServerInfo                       server information
     */
    function servers(uint256 serverId) public view returns (ServerInfo memory) {
        Server storage server = _servers[serverId];
        return
            ServerInfo({
                publicKey: server.publicKey,
                derivedAddress: server.publicKey.length > 0 ? _deriveAddress(server.publicKey) : address(0),
                url: server.url
            });
    }

    /**
     * @notice Returns information about a server by its derived address
     *
     * @param derivedAddress                    derived address of the server
     * @return ServerInfo                       server information
     */
    function serverByAddress(address derivedAddress) external view returns (ServerInfo memory) {
        return servers(_serverAddressToId[derivedAddress]);
    }

    /**
     * @notice Returns information about an application
     *
     * @param applicationId                     id of the application
     * @return ApplicationInfo                  application information
     */
    function applications(uint256 applicationId) public view returns (ApplicationInfo memory) {
        Application storage application = _applications[applicationId];
        return
            ApplicationInfo({
                publicKey: application.publicKey,
                derivedAddress: application.publicKey.length > 0 ? _deriveAddress(application.publicKey) : address(0),
                permissionIds: application.permissionIds.values()
            });
    }

    /**
     * @notice Returns information about an application by its derived address
     *
     * @param derivedAddress                    derived address of the application
     * @return ApplicationInfo                  application information
     */
    function applicationByAddress(address derivedAddress) external view returns (ApplicationInfo memory) {
        return applications(_applicationAddressToId[derivedAddress]);
    }

    /**
     * @notice Returns all permission IDs for a specific file
     *
     * @param fileId                            id of the file
     * @return uint256[]                        array of permission IDs
     */
    function filePermissionIds(uint256 fileId) external view returns (uint256[] memory) {
        return _filePermissions[fileId].values();
    }

    /**
     * @notice Returns all file IDs associated with a permission
     *
     * @param permissionId                      id of the permission
     * @return uint256[]                        array of file IDs
     */
    function permissionFileIds(uint256 permissionId) external view returns (uint256[] memory) {
        return _permissions[permissionId].fileIds.values();
    }

    /**
     * @notice Returns all permission IDs for an application
     *
     * @param applicationId                     id of the application
     * @return uint256[]                        array of permission IDs
     */
    function applicationPermissionIds(uint256 applicationId) external view returns (uint256[] memory) {
        return _applicationPermissions[applicationId].values();
    }
}
