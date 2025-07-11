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

    bytes32 private constant PERMISSION_TYPEHASH = keccak256("Permission(uint256 nonce,string grant,uint256[] fileIds)");
    bytes32 private constant REVOKE_PERMISSION_TYPEHASH =
        keccak256("RevokePermission(uint256 nonce,uint256 permissionId)");
    bytes32 private constant TRUST_SERVER_TYPEHASH =
        keccak256("TrustServer(uint256 nonce,address serverId,string serverUrl)");
    bytes32 private constant UNTRUST_SERVER_TYPEHASH = keccak256("UntrustServer(uint256 nonce,address serverId)");

    /**
     * @notice Triggered when a permission has been added
     *
     * @param permissionId                      id of the permission
     * @param user                              address of the user
     * @param grant                             grant of the permission
     */
    event PermissionAdded(uint256 indexed permissionId, address indexed user, string grant, uint256[] fileIds);
    event PermissionRevoked(uint256 indexed permissionId);
    event ServerAdded(address indexed serverId, string url);
    event ServerTrusted(address indexed user, address indexed serverId, string serverUrl);
    event ServerUntrusted(address indexed user, address indexed serverId);

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error GrantAlreadyUsed();
    error InvalidSignature();
    error EmptyGrant();
    error EmptyUrl();
    error ZeroAddress();
    error ServerUrlMismatch(string existingUrl, string providedUrl);
    error ServerNotFound();
    error ServerAlreadyRegistered();
    error ServerNotTrusted();
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
    function initialize(address trustedForwarderAddress, address ownerAddress, IDataRegistry dataRegistryAddress) external initializer {
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
            abi.encode(PERMISSION_TYPEHASH, permission.nonce, keccak256(bytes(permission.grant)), keccak256(abi.encodePacked(permission.fileIds)))
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
                trustServerInput.serverId,
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
        permission.grant = permissionInput.grant;
        permission.signature = signature;
        permission.isActive = true;
        
        uint256 fileIdsLength = permissionInput.fileIds.length;
        for (uint256 i = 0; i < fileIdsLength;) {
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

        emit PermissionAdded(permissionId, signer, permissionInput.grant, permissionInput.fileIds);

        return permissionId;
    }

    function isActivePermission(uint256 permissionId) external view returns (bool) {
        return _permissions[permissionId].isActive;
    }

    function revokePermission(uint256 permissionId) external whenNotPaused {
        _revokePermission(permissionId, _msgSender());
    }

    function revokePermissionWithSignature(RevokePermissionInput calldata revokePermissionInput, bytes calldata signature) external whenNotPaused {
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

    function _trustServer(address serverId, string memory serverUrl, address signer) internal {
        if (serverId == address(0)) {
            revert ZeroAddress();
        }

        if (bytes(serverUrl).length == 0) {
            revert EmptyUrl();
        }

        Server storage server = _servers[serverId];

        // Check if server exists
        if (bytes(server.url).length == 0) {
            // Create server (cannot be changed after creation)
            server.url = serverUrl;
            emit ServerAdded(serverId, serverUrl);
        }

        if (keccak256(bytes(server.url)) != keccak256(bytes(serverUrl))) {
            revert ServerUrlMismatch(server.url, serverUrl);
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

        _trustServer(trustServerInput.serverId, trustServerInput.serverUrl, signer);
    }

    function trustServer(address serverId, string memory serverUrl) external whenNotPaused {
        _trustServer(serverId, serverUrl, _msgSender());
    }

    function _untrustServer(address serverId, address signer) internal {
        if (serverId == address(0)) {
            revert ZeroAddress();
        }

        User storage user = _users[signer];

        // Remove server from user's set
        if (!user.trustedServerIds.remove(serverId)) {
            revert ServerNotTrusted();
        }

        emit ServerUntrusted(signer, serverId);
    }

    function untrustServer(address serverId) external whenNotPaused {
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
     * @return address[]                        array of server IDs
     */
    function userServerIdsValues(address user) external view returns (address[] memory) {
        return _users[user].trustedServerIds.values();
    }

    /**
     * @notice Returns a server ID at a specific index for a user
     *
     * @param user                              address of the user
     * @param serverIndex                       index of the server
     * @return address                          server ID
     */
    function userServerIdsAt(address user, uint256 serverIndex) external view returns (address) {
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
     * @return Server                           server information
     */
    function servers(address serverId) external view returns (Server memory) {
        return _servers[serverId];
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
}
