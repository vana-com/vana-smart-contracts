// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IFeeRegistry
 * @author Vana Network
 * @notice Single source of truth for protocol fees, keyed by an opaque
 *         `bytes32 operation` identifier.
 *
 *         Other contracts read this registry to look up "what's the current
 *         fee for operation X?". The registry does not collect or move funds
 *         itself — it just answers questions. Charging happens in the
 *         contract performing the operation (escrow, permissions, etc.).
 *
 *         Operation keys are caller-defined. Convention: use
 *         `keccak256(bytes(name))` where `name` is a stable upper-snake string
 *         like `"GRANT_REGISTRATION"` or `"DATA_ACCESS_RECORD"`. The pure
 *         helper `operationKey(string)` does this for off-chain consumers
 *         that want a canonical derivation.
 *
 *         A fee with `enabled == false` is treated as "no charge", regardless
 *         of `amount`. A fee with `enabled == true` and `amount == 0` is a
 *         free operation that the registry still tracks (useful for
 *         distinguishing "free" from "not configured").
 *
 * @custom:security-contact security@vana.org
 */
interface IFeeRegistry {
    /// @notice Fee configuration for a single operation.
    /// @param amount  Fee amount in the smallest unit of `asset`.
    /// @param asset   ERC-20 token address; `address(0)` for native VANA.
    /// @param payee   Address that receives the fee.
    /// @param enabled If false, callers should treat the fee as absent regardless of `amount`.
    struct Fee {
        uint256 amount;
        address asset;
        address payee;
        bool enabled;
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error InvalidPayee(); // setting an enabled fee without a payee
    error FeeNotSet(bytes32 operation);

    // ====================== Events ======================

    event FeeSet(
        bytes32 indexed operation,
        uint256 amount,
        address indexed asset,
        address indexed payee,
        bool enabled
    );

    event FeeCleared(bytes32 indexed operation);

    // ====================== Pure helpers ======================

    function version() external pure returns (uint256);

    /// @notice Canonical derivation of an operation key from a human-readable name.
    ///         keccak256(bytes(name)).
    function operationKey(string calldata name) external pure returns (bytes32);

    // ====================== Views ======================

    /// @notice Full fee configuration for an operation. Returns the zero-valued
    ///         struct (`enabled: false`) if no fee has been set.
    function fees(bytes32 operation) external view returns (Fee memory);

    /// @notice True if a fee has ever been set (registered) for this operation,
    ///         even if currently disabled. Useful for distinguishing "configured
    ///         but disabled" from "never configured".
    function isFeeRegistered(bytes32 operation) external view returns (bool);

    /// @notice Convenience: the effective amount that a caller should charge.
    ///         Returns 0 if the fee is unregistered or disabled.
    function feeAmount(bytes32 operation) external view returns (uint256);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    /// @notice Create or update a fee for `operation`. If `enabled` is true,
    ///         `payee` must be non-zero.
    function setFee(
        bytes32 operation,
        uint256 amount,
        address asset,
        address payee,
        bool enabled
    ) external;

    /// @notice Convenience that hashes `name` and forwards to `setFee`.
    function setFeeByName(
        string calldata name,
        uint256 amount,
        address asset,
        address payee,
        bool enabled
    ) external returns (bytes32 operation);

    /// @notice Remove all configuration for `operation`. After this call
    ///         `isFeeRegistered(operation)` returns false and `fees(operation)`
    ///         returns the zero struct.
    function clearFee(bytes32 operation) external;
}
