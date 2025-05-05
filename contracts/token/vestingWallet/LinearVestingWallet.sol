// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @dev Linear release from `start` to `start + duration`.
 *      No additional code – inherits OZ implementation.
 */
contract LinearVestingWallet is VestingWallet {
    constructor(
        address beneficiary,
        uint64  startTimestamp,
        uint64  durationSeconds
    ) VestingWallet(beneficiary, startTimestamp, durationSeconds) {}
}
