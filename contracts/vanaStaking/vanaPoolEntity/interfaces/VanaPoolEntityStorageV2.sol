// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./VanaPoolEntityStorageV1.sol";

/**
 * @title Storage for VanaPoolEntity
 * @notice For future upgrades, do not change VanaPoolEntityStorageV2. Create a new
 * contract which implements VanaPoolEntityStorageV2
 */
abstract contract VanaPoolEntityStorageV2 is VanaPoolEntityStorageV1 {
    // The RewardSplitter currently holding REWARD_SPLITTER_ROLE. Recorded so
    // updateRewardSplitter can rotate the role off the previous splitter, and
    // so the wiring is first-class rather than a grantRole step a deployment
    // can forget (NM-1052 [High] follow-up: the role was granted nowhere, so
    // addStakerRewards reverted on a real deployment).
    address public override rewardSplitter;
}
