// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Exercises the stake-seconds accumulator directly: a harness exposes the
///      internal checkpoint and a raw activeRewardPool setter, letting the test
///      drive the exact update-before-mutate sequence the real write sites use.
contract SSHarness is VanaPoolEntityImplementation {
    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function checkpoint(uint256 id) external {
        _checkpointStakeSeconds(_entities[id]);
    }

    function setActive(uint256 id, uint256 v) external {
        _entities[id].activeRewardPool = v;
    }

    function stored(uint256 id) external view returns (uint256 ss, uint256 updatedAt) {
        ss = _entities[id].stakeSeconds;
        updatedAt = _entities[id].stakeSecondsUpdatedAt;
    }
}

contract StakeSecondsTest is Test {
    SSHarness h;
    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new SSHarness();
        vm.warp(START);
    }

    function _seed(uint256 active, uint256 updatedAt, IVanaPoolEntity.EntityStatus status) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: status,
                name: "e",
                maxAPY: 0,
                lockedRewardPool: 0,
                activeRewardPool: active,
                totalShares: active,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0),
                commissionRate: 0,
                accruedCommission: 0,
                stakeSeconds: 0,
                stakeSecondsUpdatedAt: updatedAt
            })
        );
    }

    // ---- linear accrual ----

    function test_linearAccrual() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);
        vm.warp(START + 10);
        assertEq(h.stakeSecondsAt(ID), 100 * 10);
        vm.warp(START + 25);
        assertEq(h.stakeSecondsAt(ID), 100 * 25);
    }

    // ---- staircase: bank at the OLD rate on each change ----

    function test_staircaseMatchesHandComputedIntegral() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);

        // 10s at rate 100 -> checkpoint banks 1000, then rate -> 150
        vm.warp(START + 10);
        h.checkpoint(ID);
        h.setActive(ID, 150);

        // 15s at rate 150 -> checkpoint banks 2250 (total 3250), then rate -> 50
        vm.warp(START + 25);
        h.checkpoint(ID);
        h.setActive(ID, 50);

        // 5s at rate 50, read live (no checkpoint): 3250 + 250 = 3500
        vm.warp(START + 30);
        assertEq(h.stakeSecondsAt(ID), 1000 + 2250 + 250);
    }

    // ---- view is exact vs the stored value right after a checkpoint ----

    function test_viewEqualsStoredAfterCheckpoint() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);
        vm.warp(START + 10);
        h.checkpoint(ID);
        (uint256 ss, uint256 updatedAt) = h.stored(ID);
        assertEq(updatedAt, block.timestamp, "watermark advanced to now");
        assertEq(h.stakeSecondsAt(ID), ss, "no extrapolation when updatedAt == now");
        assertEq(ss, 1000, "banked the elapsed rectangle");
    }

    // ---- first touch initializes without integrating from the epoch ----

    function test_firstTouchStartsClockNoPhantom() public {
        _seed(100, 0, IVanaPoolEntity.EntityStatus.Active); // updatedAt == 0 sentinel
        vm.warp(START + 10);
        assertEq(h.stakeSecondsAt(ID), 0, "frozen until first checkpoint (no epoch integral)");

        h.checkpoint(ID); // first touch: start the clock, accrue nothing
        (uint256 ss, uint256 updatedAt) = h.stored(ID);
        assertEq(ss, 0, "no phantom stake-seconds");
        assertEq(updatedAt, block.timestamp, "clock started now");

        vm.warp(block.timestamp + 10);
        assertEq(h.stakeSecondsAt(ID), 100 * 10, "accrues from the initialized watermark");
    }

    // ---- non-Active entity is frozen (view + checkpoint agree) ----

    function test_nonActiveFrozen() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Removed);
        vm.warp(START + 10);
        assertEq(h.stakeSecondsAt(ID), 0, "view frozen while non-Active");

        h.checkpoint(ID);
        (uint256 ss, ) = h.stored(ID);
        assertEq(ss, 0, "checkpoint banks nothing while non-Active");
    }
}
