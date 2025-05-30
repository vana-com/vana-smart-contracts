// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataAccessTreasury.sol";

/**
 * @title Storage for DataAccessTreasury
 * @notice For future upgrades, do not change DataAccessTreasuryStorageV1.
 * Create a new contract which implements DataAccessTreasuryStorageV1
 */
abstract contract DataAccessTreasuryStorageV1 is IDataAccessTreasury {
    address public override custodian;
}
