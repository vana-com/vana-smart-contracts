// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVanaPoolTreasury} from "./IVanaPoolTreasury.sol";

/**
 * @title Storage for DLPRootTreasury
 * @notice For future upgrades, do not change DLPRootTreasuryStorageV1. Create a new
 * contract which implements DLPRootTreasuryStorageV1
 */
abstract contract VanaPoolTreasuryStorageV1 is IVanaPoolTreasury {
    address public override vanaPool;
}
