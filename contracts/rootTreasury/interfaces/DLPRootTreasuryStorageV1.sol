// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootTreasury.sol";
import "../../veVANA/interfaces/IVeVANAVault.sol";

/**
 * @title Storage for DLPRootTreasury
 * @notice For future upgrades, do not change DLPRootTreasuryStorageV1. Create a new
 * contract which implements DLPRootTreasuryStorageV1
 */
abstract contract DLPRootTreasuryStorageV1 is IDLPRootTreasury {
    IDLPRoot public override dlpRoot;
    IVeVANAVault public override veVANAVault;
}
