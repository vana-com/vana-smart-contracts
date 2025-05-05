// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @dev All tokens are releasable immediately.
 */
contract NoVestingWallet is VestingWallet {
    constructor(address beneficiary)
        VestingWallet(beneficiary, uint64(block.timestamp), 1)
    {}

    function _vestingSchedule(
        uint256 totalAllocation,
        uint64  /* timestamp */
    ) internal pure override returns (uint256) {
        return totalAllocation; // 100 % vested from inception
    }
}
