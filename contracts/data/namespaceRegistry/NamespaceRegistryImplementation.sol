// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/NamespaceRegistryStorageV1.sol";

/**
 * @title NamespaceRegistryImplementation
 * @notice Registry for address-derived and named namespaces. UUPS upgradeable.
 */
contract NamespaceRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    NamespaceRegistryStorageV1
{
    /// @notice Role required to register named namespaces.
    bytes32 public constant NAMED_NAMESPACE_ROLE = keccak256("NAMED_NAMESPACE_ROLE");

    /// @dev Reverts unless `msg.sender` is the current owner of namespace `id`.
    modifier onlyNamespaceOwner(bytes32 id) {
        if (_namespaces[id].owner != msg.sender) revert NotNamespaceOwner(id, msg.sender);
        _;
    }

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

    // ====================== Views ======================

    function namespaces(bytes32 id) external view override returns (Namespace memory) {
        return _namespaces[id];
    }

    function namespaceName(bytes32 id) external view override returns (string memory) {
        Namespace storage ns = _namespaces[id];
        if (ns.status == Status.None) return "";
        if (bytes(ns.name).length > 0) return ns.name;
        // Address-derived: id encodes the address directly; synthesize canonical hex.
        return Strings.toHexString(address(uint160(uint256(id))));
    }

    function addressNamespaceId(address addr) public pure override returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function namedNamespaceId(string calldata name) public pure override returns (bytes32) {
        return keccak256(bytes(name));
    }

    // ====================== Registration ======================

    function registerAddressNamespace(address addr) external override whenNotPaused {
        if (addr == address(0)) revert ZeroAddress();
        if (msg.sender != addr) revert CallerNotAddress(addr, msg.sender);

        bytes32 id = addressNamespaceId(addr);
        if (_namespaces[id].status != Status.None) revert NamespaceAlreadyExists(id);

        _namespaces[id] = Namespace({id: id, owner: addr, status: Status.Active, name: ""});

        emit AddressNamespaceRegistered(id, addr);
    }

    // Admin convention: names registered here MUST NOT contain a slash.
    // ScopeRegistry derives scope ids as keccak256 over a string of the form
    //   AT-SIGN namespace SLASH scopeName
    // so distinct namespace names that overlap across the slash boundary
    // would alias to the same scope id. Worked example:
    //
    //   register namespace "vana"     -> owner Alice
    //   register namespace "vana/x"   -> owner Bob          <-- DON'T DO THIS
    //   Alice can then claim scope ("vana", "x/profile")
    //   Bob   can also claim scope ("vana/x", "profile")
    //   Both produce id = keccak256("@vana/x/profile") and squat each other.
    //
    // The invariant is enforced socially by the holder of NAMED_NAMESPACE_ROLE
    // (single source of truth) rather than on-chain, to keep registration
    // cheap. If you ever need to delegate this role widely, add a slash-reject
    // check below.
    function registerNamedNamespace(string calldata name, address owner)
        external
        override
        whenNotPaused
        onlyRole(NAMED_NAMESPACE_ROLE)
    {
        if (bytes(name).length == 0) revert EmptyName();
        if (owner == address(0)) revert ZeroAddress();

        bytes32 id = namedNamespaceId(name);
        if (_namespaces[id].status != Status.None) revert NamespaceAlreadyExists(id);

        _namespaces[id] = Namespace({id: id, owner: owner, status: Status.Active, name: name});

        emit NamedNamespaceRegistered(id, owner, name);
    }

    // ====================== Namespace ops ======================

    function transferOwnership(bytes32 id, address newOwner)
        external
        override
        whenNotPaused
        onlyNamespaceOwner(id)
    {
        if (newOwner == address(0)) revert ZeroAddress();

        Namespace storage ns = _namespaces[id];
        if (ns.status != Status.Active) revert NamespaceNotActive(id);

        address previousOwner = ns.owner;
        ns.owner = newOwner;

        emit NamespaceOwnershipTransferred(id, previousOwner, newOwner);
    }

    function deprecate(bytes32 id) external override whenNotPaused onlyNamespaceOwner(id) {
        Namespace storage ns = _namespaces[id];
        if (ns.status != Status.Active) revert NamespaceNotActive(id);

        ns.status = Status.Deprecated;

        emit NamespaceDeprecated(id);
    }
}
