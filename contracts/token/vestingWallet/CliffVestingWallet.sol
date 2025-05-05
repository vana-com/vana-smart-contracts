// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

error CliffTooLarge();

/**
 * @dev Nothing vests until the cliff has passed, then linearly.
 */
contract CliffVestingWallet is VestingWallet {
    uint64 public immutable cliff;   // timestamp


    constructor(
        address beneficiary,
        uint64  startTimestamp,
        uint64  cliffDuration,   // seconds after start
        uint64  totalDuration
    ) VestingWallet(beneficiary, startTimestamp, totalDuration) {
        if (cliffDuration >= totalDuration) revert CliffTooLarge();
        cliff = startTimestamp + cliffDuration;
    }

    function _vestingSchedule(
        uint256 totalAllocation,
        uint64  timestamp
    ) internal view override returns (uint256) {
        if (timestamp < cliff) return 0;
        return super._vestingSchedule(totalAllocation, timestamp);
    }
}
