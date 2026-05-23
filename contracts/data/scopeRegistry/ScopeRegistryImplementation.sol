// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/ScopeRegistryStorageV1.sol";

/**
 * @title ScopeRegistryImplementation
 * @notice Registers scopes under a NamespaceRegistry-managed namespace.
 * @dev UUPS upgradeable.
 */
contract ScopeRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ScopeRegistryStorageV1
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address namespaceRegistryAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();
        if (namespaceRegistryAddress == address(0)) revert EmptyNamespaceRegistry();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        namespaceRegistry = INamespaceRegistry(namespaceRegistryAddress);

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

    function updateNamespaceRegistry(address newNamespaceRegistry)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newNamespaceRegistry == address(0)) revert EmptyNamespaceRegistry();
        address previous = address(namespaceRegistry);
        namespaceRegistry = INamespaceRegistry(newNamespaceRegistry);
        emit NamespaceRegistryUpdated(previous, newNamespaceRegistry);
    }

    // ====================== Views ======================

    function scopes(bytes32 id) external view override returns (Scope memory) {
        return _scopes[id];
    }

    function isRegistered(bytes32 id) external view override returns (bool) {
        return _scopes[id].status != Status.None;
    }

    function scopeStatus(bytes32 id) external view override returns (Status) {
        return _scopes[id].status;
    }

    function scopeId(string calldata namespaceName, string calldata scopeName)
        external
        pure
        override
        returns (bytes32)
    {
        return _scopeId(bytes(namespaceName), bytes(scopeName));
    }

    function fullScope(bytes32 id) external view override returns (string memory) {
        Scope storage s = _scopes[id];
        if (s.status == Status.None) return "";

        string memory nsName = namespaceRegistry.namespaceName(s.namespaceId);
        return string(abi.encodePacked(bytes1("@"), bytes(nsName), bytes1("/"), bytes(s.name)));
    }

    function namespaceScopesCount(bytes32 namespaceId) external view override returns (uint256) {
        return _scopesByNamespace[namespaceId].length();
    }

    function namespaceScopeIdAt(bytes32 namespaceId, uint256 index) external view override returns (bytes32) {
        return _scopesByNamespace[namespaceId].at(index);
    }

    function namespaceScopeIds(bytes32 namespaceId) external view override returns (bytes32[] memory) {
        return _scopesByNamespace[namespaceId].values();
    }

    // ====================== Registration ======================

    function register(string calldata namespaceName, string calldata scopeName) external override whenNotPaused {
        bytes calldata nsBytes = bytes(namespaceName);
        bytes calldata snBytes = bytes(scopeName);

        if (nsBytes.length == 0 || snBytes.length == 0) revert InvalidScopeFormat();

        // NOTE: scope-id collisions across distinct (namespace, scopeName) pairs
        // are prevented at the namespace boundary — the admin must not register
        // named namespaces whose names contain a slash. See NamespaceRegistry.
        bytes32 nsId = keccak256(nsBytes);
        bytes32 id = _scopeId(nsBytes, snBytes);

        if (_scopes[id].status != Status.None) revert ScopeAlreadyExists(id);

        INamespaceRegistry.Namespace memory ns = namespaceRegistry.namespaces(nsId);
        if (ns.status != INamespaceRegistry.Status.Active) revert NamespaceNotActiveOrMissing(nsId);
        if (ns.owner != msg.sender) revert NotNamespaceOwner(nsId, msg.sender);

        _scopes[id] = Scope({id: id, namespaceId: nsId, status: Status.Active, name: scopeName});
        _scopesByNamespace[nsId].add(id);

        emit ScopeRegistered(id, nsId, msg.sender, namespaceName, scopeName);
    }

    function deprecate(bytes32 id) external override whenNotPaused {
        Scope storage s = _scopes[id];
        if (s.status != Status.Active) revert ScopeNotActive(id);

        bytes32 nsId = s.namespaceId;
        INamespaceRegistry.Namespace memory ns = namespaceRegistry.namespaces(nsId);
        if (ns.owner != msg.sender) revert NotNamespaceOwner(nsId, msg.sender);

        s.status = Status.Deprecated;

        emit ScopeDeprecated(id);
    }

    // Canonical scope id: keccak256 over the packed bytes  AT-SIGN ns SLASH sn .
    function _scopeId(bytes memory ns, bytes memory sn) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1("@"), ns, bytes1("/"), sn));
    }
}
