// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./VanaPoolTreasuryStorageV1.sol";

/**
 * @title Storage for VanaPoolTreasury
 * @notice For future upgrades, do not change VanaPoolTreasuryStorageV2. Create a
 * new contract which implements VanaPoolTreasuryStorageV2.
 *
 * @dev Appended for the SPENDER_ROLE upgrade: proxy storage, only new slots after
 *      the V1 layout.
 */
abstract contract VanaPoolTreasuryStorageV2 is VanaPoolTreasuryStorageV1 {
    // The entity contract, held so its SPENDER_ROLE can be granted/rotated as a
    // first-class wiring step (it pays out commission and swept rewards).
    address public override vanaPoolEntity;
}
