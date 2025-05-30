// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITreasury} from "./ITreasury.sol";

abstract contract TreasuryStorageV1 is ITreasury {
    address public override custodian;
}
