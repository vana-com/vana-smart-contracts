// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/FeeRegistryStorageV1.sol";

/**
 * @title FeeRegistryImplementation
 * @notice Single source of truth for protocol fees. UUPS upgradeable.
 *
 *         The registry does not collect or move funds — it just answers
 *         "what fee should I charge for operation X?". Consumers
 *         (escrow, permissions, etc.) read the current fee and charge it
 *         themselves via their own settlement path.
 */
contract FeeRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    FeeRegistryStorageV1
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    // ====================== Admin ======================

    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setFee(
        bytes32 operation,
        uint256 amount,
        address asset,
        address payee,
        bool enabled
    ) public override whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        if (enabled && payee == address(0)) revert InvalidPayee();

        _fees[operation] = Fee({amount: amount, asset: asset, payee: payee, enabled: enabled});
        _registeredOperations.add(operation);

        emit FeeSet(operation, amount, asset, payee, enabled);
    }

    function setFeeByName(
        string calldata name,
        uint256 amount,
        address asset,
        address payee,
        bool enabled
    ) external override returns (bytes32 operation) {
        operation = keccak256(bytes(name));
        setFee(operation, amount, asset, payee, enabled);
    }

    function clearFee(bytes32 operation) external override whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_registeredOperations.contains(operation)) revert FeeNotSet(operation);

        delete _fees[operation];
        _registeredOperations.remove(operation);

        emit FeeCleared(operation);
    }

    // ====================== Pure helpers ======================

    function operationKey(string calldata name) external pure override returns (bytes32) {
        return keccak256(bytes(name));
    }

    // ====================== Views ======================

    function fees(bytes32 operation) external view override returns (Fee memory) {
        return _fees[operation];
    }

    function isFeeRegistered(bytes32 operation) external view override returns (bool) {
        return _registeredOperations.contains(operation);
    }

    function feeAmount(bytes32 operation) external view override returns (uint256) {
        Fee storage f = _fees[operation];
        return f.enabled ? f.amount : 0;
    }
}
