// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IVeVANAVault.sol";
import "./IVeVANA.sol";

/**
 * @title Storage for veVANAVault
 * @notice For future upgrades, do not change veVANAVaultStorageV1. 
 * Create a new contract which implements veVANAVaultStorageV1
 */
abstract contract VeVANAVaultStorageV1 is IVeVANAVault {
    IVeVANA public override token;
}
