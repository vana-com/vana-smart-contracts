// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../namespaceRegistry/interfaces/INamespaceRegistry.sol";

/**
 * @title IScopeRegistry
 * @author Vana Network
 * @notice Registry for scopes nested under a namespace.
 *
 *         Callers pass the namespace name and the local scope name separately
 *         (no parsing). The canonical scope id is keccak256 over the packed
 *         bytes  AT-SIGN  namespace  SLASH  scopeName  — equivalent to hashing
 *         the joined string. The namespace id is keccak256(bytes(namespace))
 *         and must reference an Active named namespace whose owner is the
 *         caller.
 *
 *         Collision safety relies on an upstream invariant: NamespaceRegistry
 *         must not contain named namespaces whose names include a slash. See
 *         that contract's docs for the rationale and worked example.
 *
 *         Address-derived namespaces are not supported in this version.
 *
 * @custom:security-contact security@vana.org
 */
interface IScopeRegistry {
    enum Status {
        None,
        Active,
        Deprecated
    }

    struct Scope {
        bytes32 id;
        bytes32 namespaceId;
        Status status;
        /// @dev Local scope name only (e.g. "instagram.profile"). The full
        ///      canonical form is reconstructable via `fullScope(id)`.
        string name;
    }

    // ====================== Errors ======================

    error InvalidScopeFormat();
    error EmptyNamespaceRegistry();
    error ZeroAddress();
    error ScopeAlreadyExists(bytes32 id);
    error ScopeNotActive(bytes32 id);
    error NamespaceNotActiveOrMissing(bytes32 namespaceId);
    error NotNamespaceOwner(bytes32 namespaceId, address caller);

    // ====================== Events ======================

    event ScopeRegistered(
        bytes32 indexed id,
        bytes32 indexed namespaceId,
        address indexed owner,
        string namespaceName,
        string scopeName
    );

    event ScopeDeprecated(bytes32 indexed id);

    event NamespaceRegistryUpdated(address indexed previous, address indexed current);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function namespaceRegistry() external view returns (INamespaceRegistry);

    function scopes(bytes32 id) external view returns (Scope memory);

    function isRegistered(bytes32 scopeId) external view returns (bool);

    /// @notice Compute the on-chain id for a (namespace, scopeName) pair.
    function scopeId(string calldata namespaceName, string calldata scopeName) external pure returns (bytes32);

    /// @notice Returns the full canonical scope string (form: at-sign namespace
    ///         slash scopeName) by joining the namespace's name (looked up in
    ///         NamespaceRegistry) with the local scope name. Returns the empty
    ///         string for ids that aren't registered.
    function fullScope(bytes32 id) external view returns (string memory);

    /// @notice Number of scopes (Active + Deprecated) registered under `namespaceId`.
    function namespaceScopesCount(bytes32 namespaceId) external view returns (uint256);

    /// @notice Scope id at `index` within the namespace's set. Order is insertion-stable
    ///         until something is removed; we never remove, so it's effectively registration order.
    function namespaceScopeIdAt(bytes32 namespaceId, uint256 index) external view returns (bytes32);

    /// @notice All scope ids ever registered under `namespaceId`.
    /// @dev    Gas-unbounded — intended for off-chain reads. On-chain callers
    ///         should paginate via `namespaceScopesCount` + `namespaceScopeIdAt`.
    function namespaceScopeIds(bytes32 namespaceId) external view returns (bytes32[] memory);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    function updateNamespaceRegistry(address newNamespaceRegistry) external;

    // ====================== Registration ======================

    /// @notice Register a new scope under `namespaceName`. Caller must own the
    ///         referenced named namespace. `namespaceName` must not contain a
    ///         slash; both inputs must be non-empty.
    function register(string calldata namespaceName, string calldata scopeName) external;

    /// @notice Mark a scope as deprecated. Caller must own the parent namespace.
    ///         Deprecated scopes are frozen; the id cannot be re-registered.
    function deprecate(bytes32 id) external;
}
