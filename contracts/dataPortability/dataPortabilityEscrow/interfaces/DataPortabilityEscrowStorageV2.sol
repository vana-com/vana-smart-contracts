// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataPortabilityEscrowStorageV1.sol";

/**
 * @title Storage for DataPortabilityEscrow, version 2
 * @notice Appends to DataPortabilityEscrowStorageV1. Do not change it;
 * create a new contract which implements DataPortabilityEscrowStorageV2.
 */
abstract contract DataPortabilityEscrowStorageV2 is DataPortabilityEscrowStorageV1 {
    /// @dev FeeRegistry whose per-operation payee every settlement must pay.
    ///      Set via `setFeeRegistry`. While unset, settle paths revert with
    ///      `FeeRegistryNotSet`.
    IFeeRegistry public override feeRegistry;
}
