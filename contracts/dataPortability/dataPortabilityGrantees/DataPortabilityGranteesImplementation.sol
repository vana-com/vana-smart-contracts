// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DataPortabilityGranteesStorageV1.sol";

/**
 * @title DataPortabilityGranteesImplementation
 * @notice Implementation contract for data portability grantee management
 * @dev Implements IDataPortabilityGrantees interface with UUPS upgradeability
 * @custom:see IDataPortabilityGrantees For complete interface documentation
 */
contract DataPortabilityGranteesImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC2771ContextUpgradeable,
    DataPortabilityGranteesStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant PERMISSION_MANAGER_ROLE = keccak256("PERMISSION_MANAGER_ROLE");

    error ZeroAddress();
    error EmptyPublicKey();
    error GranteeAlreadyRegistered();
    error GranteeNotFound();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _trustedForwarder = trustedForwarderAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(PERMISSION_MANAGER_ROLE, ownerAddress);
    }

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

    function trustedForwarder()
        public
        view
        virtual
        override(ERC2771ContextUpgradeable, IDataPortabilityGrantees)
        returns (address)
    {
        return _trustedForwarder;
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external override onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function registerGrantee(
        address owner,
        address granteeAddress,
        string memory publicKey
    ) external override whenNotPaused returns (uint256) {
        if (bytes(publicKey).length == 0) {
            revert EmptyPublicKey();
        }

        if (granteeAddress == address(0)) {
            revert ZeroAddress();
        }

        if (owner == address(0)) {
            revert ZeroAddress();
        }

        if (granteeAddressToId[granteeAddress] != 0) {
            revert GranteeAlreadyRegistered();
        }

        uint256 granteeId = ++granteesCount;

        Grantee storage granteeData = _grantees[granteeId];
        granteeData.owner = owner;
        granteeData.granteeAddress = granteeAddress;
        granteeData.publicKey = publicKey;

        granteeAddressToId[granteeAddress] = granteeId;

        emit GranteeRegistered(granteeId, owner, granteeAddress, publicKey);

        return granteeId;
    }

    function grantees(uint256 granteeId) external view override returns (GranteeInfo memory) {
        Grantee storage granteeData = _grantees[granteeId];
        return
            GranteeInfo({
                owner: granteeData.owner,
                granteeAddress: granteeData.granteeAddress,
                publicKey: granteeData.publicKey,
                permissionIds: _granteePermissions[granteeId].values()
            });
    }

    function granteeInfo(uint256 granteeId) external view override returns (GranteeInfo memory) {
        Grantee storage granteeData = _grantees[granteeId];
        return
            GranteeInfo({
                owner: granteeData.owner,
                granteeAddress: granteeData.granteeAddress,
                publicKey: granteeData.publicKey,
                permissionIds: _granteePermissions[granteeId].values()
            });
    }

    function granteeByAddress(address granteeAddress) external view override returns (GranteeInfo memory) {
        uint256 granteeId = granteeAddressToId[granteeAddress];
        Grantee storage granteeData = _grantees[granteeId];
        return
            GranteeInfo({
                owner: granteeData.owner,
                granteeAddress: granteeData.granteeAddress,
                publicKey: granteeData.publicKey,
                permissionIds: _granteePermissions[granteeId].values()
            });
    }

    function granteePermissionIds(uint256 granteeId) external view override returns (uint256[] memory) {
        return _granteePermissions[granteeId].values();
    }

    function granteePermissions(uint256 granteeId) external view override returns (uint256[] memory) {
        return _granteePermissions[granteeId].values();
    }

    function addPermissionToGrantee(
        uint256 granteeId,
        uint256 permissionId
    ) external override onlyRole(PERMISSION_MANAGER_ROLE) {
        if (granteeId == 0 || granteeId > granteesCount) {
            revert GranteeNotFound();
        }
        _granteePermissions[granteeId].add(permissionId);
    }

    function removePermissionFromGrantee(
        uint256 granteeId,
        uint256 permissionId
    ) external override onlyRole(PERMISSION_MANAGER_ROLE) {
        if (granteeId == 0 || granteeId > granteesCount) {
            revert GranteeNotFound();
        }
        _granteePermissions[granteeId].remove(permissionId);
    }
}
