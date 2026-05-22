// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title INamespaceRegistry
 * @author Vana Network
 * @notice Registry for two kinds of namespaces:
 *           - Address-derived: any EOA / contract can claim its own namespace
 *             (id = `bytes32(uint256(uint160(addr)))`, caller must equal `addr`).
 *           - Named: arbitrary string namespace gated by NAMED_NAMESPACE_ROLE
 *             (id = `keccak256(bytes(name))`).
 *
 *         Both share a single id space. The address-derived form only ever
 *         produces ids whose top 96 bits are zero, while named ids come from
 *         keccak256 — so accidental collision is cryptographically negligible.
 *
 * @custom:security-contact security@vana.org
 */
interface INamespaceRegistry {
    enum Status {
        None,
        Active,
        Deprecated
    }

    struct Namespace {
        bytes32 id;
        address owner;
        Status status;
        /// @dev Human-readable name. Set for named namespaces; empty for
        ///      address-derived namespaces (the address is recoverable from `id`).
        string name;
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error EmptyName();
    error CallerNotAddress(address expected, address caller);
    error NamespaceAlreadyExists(bytes32 id);
    error NamespaceNotActive(bytes32 id);
    error NotNamespaceOwner(bytes32 id, address caller);

    // ====================== Events ======================

    event AddressNamespaceRegistered(bytes32 indexed id, address indexed owner);

    event NamedNamespaceRegistered(bytes32 indexed id, address indexed owner, string name);

    event NamespaceOwnershipTransferred(
        bytes32 indexed id,
        address indexed previousOwner,
        address indexed newOwner
    );

    event NamespaceDeprecated(bytes32 indexed id);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function namespaces(bytes32 id) external view returns (Namespace memory);

    /// @notice Canonical human-readable name of a namespace.
    ///           - For named namespaces, returns the registered string.
    ///           - For address-derived namespaces, returns the address in
    ///             canonical lowercase 0x-prefixed hex (length 42).
    ///           - For unregistered ids, returns the empty string.
    function namespaceName(bytes32 id) external view returns (string memory);

    /// @notice id for an address-derived namespace.
    function addressNamespaceId(address addr) external pure returns (bytes32);

    /// @notice id for a named namespace.
    function namedNamespaceId(string calldata name) external pure returns (bytes32);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    // ====================== Registration ======================

    /// @notice Claim the namespace derived from `addr`. Caller must be `addr`.
    function registerAddressNamespace(address addr) external;

    /// @notice Register a named namespace; restricted to NAMED_NAMESPACE_ROLE.
    /// @param name  Human-readable name (will be hashed to derive the id)
    /// @param owner Address that will own the new namespace
    function registerNamedNamespace(string calldata name, address owner) external;

    // ====================== Namespace ops ======================

    /// @notice Transfer ownership of a namespace. Caller must be the current owner.
    function transferOwnership(bytes32 id, address newOwner) external;

    /// @notice Mark a namespace as deprecated. Caller must be the current owner.
    ///         Deprecated namespaces are frozen — no further transfers, and the
    ///         id cannot be re-registered.
    function deprecate(bytes32 id) external;
}
