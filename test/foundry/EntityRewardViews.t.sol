// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

contract ViewsHarness is VanaPoolEntityImplementation {
    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }
}

contract EntityRewardViewsTest is Test {
    ViewsHarness h;
    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new ViewsHarness();
        vm.warp(START);
    }

    function _seed(
        IVanaPoolEntity.RewardModel model,
        uint256 locked,
        IVanaPoolEntity.RewardSchedule memory sched
    ) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: locked,
                activeRewardPool: 0,
                totalShares: 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: model,
                rewardSchedule: sched
            })
        );
    }

    function test_rewardModelView() public {
        _seed(IVanaPoolEntity.RewardModel.STREAM, 0, IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0));
        assertEq(uint256(h.entityRewardModel(ID)), uint256(IVanaPoolEntity.RewardModel.STREAM));
    }

    function test_rewardScheduleView() public {
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10_000 ether, START, 10 days, uint32(START), 20_000 ether, START + 10 days, 20 days);
        _seed(IVanaPoolEntity.RewardModel.STREAM, 30_000 ether, sched);

        IVanaPoolEntity.RewardSchedule memory s = h.entityRewardSchedule(ID);
        assertEq(s.scheduledValue, 10_000 ether);
        assertEq(s.start, START);
        assertEq(s.duration, 10 days);
        assertEq(s.nextScheduledValue, 20_000 ether);
        assertEq(s.nextStart, START + 10 days);
    }

    function test_committedRewards_activeUnvestedPlusQueued() public {
        // active 10k over [START, START+10d]; queued 20k
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10_000 ether, START, 10 days, uint32(START), 20_000 ether, START + 10 days, 20 days);
        _seed(IVanaPoolEntity.RewardModel.STREAM, 30_000 ether, sched);

        // at start: nothing vested → 10k active + 20k queued
        assertEq(h.committedRewards(ID), 30_000 ether, "at start");

        // halfway: 5k of active vested → 5k remaining + 20k queued
        vm.warp(START + 5 days);
        assertEq(h.committedRewards(ID), 25_000 ether, "halfway");

        // past active end: active fully vested → only 20k queued remains
        vm.warp(START + 10 days);
        assertEq(h.committedRewards(ID), 20_000 ether, "active ended");
    }

    function test_committedRewards_zeroForApyEntity() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0));
        assertEq(h.committedRewards(ID), 0, "APY entity owes nothing on a schedule");
    }
}
