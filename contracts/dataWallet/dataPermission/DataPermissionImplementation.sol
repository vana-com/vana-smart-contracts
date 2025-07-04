// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
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

    bytes32 private constant PERMISSION_TYPEHASH =
        keccak256(
            "Permission(address application,uint256[] files,string operation,string grant,string parameters,uint256 nonce)"
        );
    event PermissionAdded(
        uint256 indexed permissionId,
        address indexed signer,
        address indexed application,
        uint256[] files,
        string operation,
        string grant,
        string parameters
    );

    error InvalidNonce(uint256 nonce);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
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

    function userPermissionIdsValues(address user) external view returns (uint256[] memory) {
        return _users[user].permissionIds.values();
    }

    function userPermissionIdsAt(address user, uint256 permissionIndex) external view returns (uint256) {
        return _users[user].permissionIds.at(permissionIndex);
    }

    function userPermissionIdsLength(address user) external view returns (uint256) {
        return _users[user].permissionIds.length();
    }

    function applicationPermissionIdsValues(address application) external view returns (uint256[] memory) {
        return _applications[application].permissionIds.values();
    }

    function applicationPermissionIdsAt(address application, uint256 permissionIndex) external view returns (uint256) {
        return _applications[application].permissionIds.at(permissionIndex);
    }

    function applicationPermissionIdsLength(address application) external view returns (uint256) {
        return _applications[application].permissionIds.length();
    }

    function permissions(uint256 id) external view returns (Permission memory) {
        return _permissions[id];
    }

    function userNonce(address user) external view returns (uint256) {
        return _users[user].nonce;
    }

    function addPermission(PermissionInput calldata permission, bytes calldata signature) external {
        address signer = _extractSignatureSigner(permission, signature);

        if (permission.nonce != _users[signer].nonce) {
            revert InvalidNonce(_users[signer].nonce);
        }

        ++_users[signer].nonce;

        // Store permission
        uint256 permissionId = ++permissionsCount;
        _permissions[permissionId] = Permission({
            user: signer,
            application: permission.application,
            files: permission.files,
            operation: permission.operation,
            grant: permission.grant,
            parameters: permission.parameters
        });

        _applications[permission.application].permissionIds.add(permissionId);
        _users[signer].permissionIds.add(permissionId);

        emit PermissionAdded(
            permissionId,
            signer,
            permission.application,
            permission.files,
            permission.operation,
            permission.grant,
            permission.parameters
        );
    }

    function _extractSignatureSigner(
        PermissionInput calldata permission,
        bytes calldata signature
    ) internal view returns (address) {
        // Hash array separately
        bytes32 filesHash = keccak256(abi.encodePacked(permission.files));

        // Build struct hash
        bytes32 structHash = keccak256(
            abi.encode(
                PERMISSION_TYPEHASH,
                permission.application,
                filesHash,
                keccak256(bytes(permission.operation)),
                keccak256(bytes(permission.grant)),
                keccak256(bytes(permission.parameters)),
                permission.nonce
            )
        );

        return _hashTypedDataV4(structHash).recover(signature);
    }
}
