// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPermissionStorageV1.sol";

contract DataPermissionImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    EIP712Upgradeable,
    DataPermissionStorageV1
{
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    string private constant SIGNING_DOMAIN = "VanaDataWallet";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant PERMISSION_TYPEHASH = keccak256("Permission(uint256 nonce,string grant)");

    /**
     * @notice Triggered when a permission has been added
     *
     * @param permissionId                      id of the permission
     * @param user                              address of the user
     * @param grant                             grant of the permission
     */
    event PermissionAdded(uint256 indexed permissionId, address indexed user, string grant);

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error GrantAlreadyUsed();
    error InvalidSignature();
    error EmptyGrant();

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
    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _trustedForwarder = trustedForwarderAddress;

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

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
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

    /**
     * @notice Returns information about a permission
     *
     * @param permissionId                      id of the permission
     * @return Permission                       permission information
     */
    function permissions(uint256 permissionId) external view returns (Permission memory) {
        return _permissions[permissionId];
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
        address signer = _extractSignatureSigner(permission, signature);
        return _addPermission(permission, signature, signer);
    }

    /**
     * @notice Extract the signer from the permission and signature using EIP-712
     *
     * @param permission                        permission input data
     * @param signature                         signature for the permission
     * @return address                          address of the signer
     */
    function _extractSignatureSigner(
        PermissionInput calldata permission,
        bytes calldata signature
    ) internal view returns (address) {
        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(PERMISSION_TYPEHASH, permission.nonce, keccak256(bytes(permission.grant)))
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature);
    }

    /**
     * @notice Internal function to add a permission
     *
     * @param permission                        permission input data
     * @param signature                         signature for the permission
     * @param user                              address of the user
     * @return uint256                          id of the created permission
     */
    function _addPermission(
        PermissionInput calldata permission,
        bytes calldata signature,
        address user
    ) internal returns (uint256) {
        // Validate grant is not empty
        if (bytes(permission.grant).length == 0) {
            revert EmptyGrant();
        }

        // Check if grant is already used
        bytes32 grantHash = keccak256(abi.encodePacked(permission.grant));
        if (_grantHashToPermissionId[grantHash] != 0) {
            revert GrantAlreadyUsed();
        }

        // Validate nonce
        if (permission.nonce != _users[user].nonce) {
            revert InvalidNonce(_users[user].nonce, permission.nonce);
        }

        // Validate signature by attempting to extract signer
        address extractedSigner = _extractSignatureSigner(permission, signature);
        if (extractedSigner != user) {
            revert InvalidSignature();
        }

        // Increment user nonce
        ++_users[user].nonce;

        // Create permission
        uint256 permissionId = ++permissionsCount;

        _permissions[permissionId] = Permission({
            user: user,
            nonce: permission.nonce,
            grant: permission.grant,
            signature: signature
        });

        // Index by grant hash
        _grantHashToPermissionId[grantHash] = permissionId;

        // Add to user's permission set
        _users[user].permissionIds.add(permissionId);

        emit PermissionAdded(permissionId, user, permission.grant);

        return permissionId;
    }
}
