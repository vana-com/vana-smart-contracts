// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IDataPortabilityPermissionsV2
 * @author Vana Network
 * @notice Registry of data-access permissions, content-addressed by a
 *         deterministic id derived from (domain, grantor, grantee):
 *
 *           grantId = keccak256(abi.encode(domainSeparator(), grantorAddress, granteeId))
 *
 *         where `domainSeparator()` is the EIP-712 domain separator returned
 *         by OpenZeppelin's `_domainSeparatorV4`:
 *
 *           domainSeparator = keccak256(abi.encode(
 *             keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
 *             keccak256("Vana Data Portability"),
 *             keccak256("1"),
 *             chainId,
 *             address(this)
 *           ))
 *
 *         The same domain separator is used for both the `addPermissionWithSignature`
 *         EIP-712 signature and the content-addressed `grantId`. Off-chain code
 *         that constructs the standard EIP-712 domain (e.g. viem's `hashDomain`)
 *         produces the same value.
 *
 *         Each Permission records:
 *           - grantorAddress: address that granted the permission
 *           - granteeId: opaque bytes32 identifier of the grantee
 *           - scopes: free-form scope strings agreed off-chain
 *           - grantVersion: schema/format version of this grant
 *           - expiresAt: unix timestamp after which the grant is invalid;
 *             `0` means perpetual
 *
 *         Semantics: each (grantor, grantee) pair has exactly one slot.
 *         Re-registration by the same grantor for the same grantee OVERWRITES
 *         the existing permission (upsert).
 *
 *         Replay & rollback protection: `grantVersion` doubles as a monotonic
 *         per-grant nonce. Every update must use a strictly larger
 *         `grantVersion` than the currently stored one — so signatures can't
 *         be replayed, and updates can't roll back the grant. First write
 *         requires `grantVersion >= 1`.
 *
 *         Two registration paths:
 *           - `addPermission`: direct call by the grantor (msg.sender)
 *           - `addPermissionWithSignature`: any submitter; the grantor's EIP-712
 *             signature authorizes the action
 *
 *         "Revocation" is achieved by upserting with `expiresAt` set to a past
 *         timestamp (and a higher `grantVersion`).
 *
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityPermissionsV2 {
    /// @notice On-chain permission record.
    struct Permission {
        address grantorAddress;
        bytes32 granteeId;
        string[] scopes;
        uint256 grantVersion;
        uint256 expiresAt;
    }

    /// @notice Caller-supplied input for registering a permission. Field order
    ///         matches the EIP-712 `GrantRegistration` type — see
    ///         `GRANT_REGISTRATION_TYPEHASH`.
    /// @dev `grantorAddress` is included in the signed payload (wallets display
    ///      it; the contract verifies that the recovered signer matches it).
    struct AddPermissionInput {
        address grantorAddress;
        bytes32 granteeId;
        string[] scopes;
        uint256 grantVersion;
        uint256 expiresAt;
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error ZeroGranteeId();
    error EmptyScopes();
    /// @dev Reverts when `providedVersion <= currentVersion`. For the first
    ///      write, `currentVersion` is 0 so `providedVersion` must be >= 1.
    error InvalidGrantVersion(uint256 currentVersion, uint256 providedVersion);
    error InvalidSignature();
    /// @dev Reverts when the claimed `grantorAddress` does not match the
    ///      actual authority (msg.sender for direct calls, recovered signer
    ///      for signature-based calls).
    error GrantorMismatch(address claimed, address actual);

    // ====================== Events ======================

    /// @notice Emitted when a permission is created OR updated (upsert).
    /// @dev Indexers can distinguish "new" from "update" by tracking whether the id
    ///      has been seen before in this event stream.
    event PermissionSet(
        bytes32 indexed id,
        address indexed grantorAddress,
        bytes32 indexed granteeId,
        string[] scopes,
        uint256 grantVersion,
        uint256 expiresAt
    );

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function permissions(bytes32 id) external view returns (Permission memory);

    /// @notice Returns true if the permission exists and has not expired.
    function isActive(bytes32 id) external view returns (bool);

    /// @notice The EIP-712 typehash used by `addPermissionWithSignature`.
    ///         Type: GrantRegistration(address grantorAddress,bytes32 granteeId,
    ///         string[] scopes,uint256 grantVersion,uint256 expiresAt)
    function GRANT_REGISTRATION_TYPEHASH() external view returns (bytes32);

    /// @notice EIP-712 domain separator. Used both as the signing-domain for
    ///         `addPermissionWithSignature` and as the namespace tag baked into
    ///         every `grantId`. Computed from the standard EIP-712 fields
    ///         (name, version, chainId, verifyingContract).
    function domainSeparator() external view returns (bytes32);

    /// @notice Deterministic id for a (grantor, grantee) pair.
    function grantId(address grantorAddress, bytes32 granteeId) external view returns (bytes32);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    // ====================== Registration ======================

    /// @notice Create or update a permission. `msg.sender` becomes the grantor.
    /// @return id The deterministic grant id.
    function addPermission(AddPermissionInput calldata input) external returns (bytes32 id);

    /// @notice Create or update a permission on behalf of the EIP-712 signer.
    ///         The submitter (msg.sender) pays gas; authority comes from the signature.
    /// @param input The permission data. `grantVersion` must be strictly greater
    ///        than the currently stored version for this (grantor, grantee) pair,
    ///        which doubles as nonce and rollback protection.
    /// @param signature EIP-712 signature over `input` by the grantor.
    /// @return id The deterministic grant id.
    function addPermissionWithSignature(
        AddPermissionInput calldata input,
        bytes calldata signature
    ) external returns (bytes32 id);
}
