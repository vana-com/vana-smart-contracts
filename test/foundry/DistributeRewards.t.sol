// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev distributeRewards only calls vanaPoolStaking (the treasury forward) when
///      msg.value > 0, and processRewards touches no external contracts. So the
///      whole scheduling path is testable with msg.value == 0, drawing from
///      pre-seeded locked residue -- no treasury mock needed.
contract ScheduleHarness is VanaPoolEntityImplementation {
    function grantMaintainer(address who) external {
        _grantRole(MAINTAINER_ROLE, who);
    }

    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function getEntity(uint256 id) external view returns (IVanaPoolEntity.Entity memory) {
        return _entities[id];
    }

    function committed(uint256 id) external view returns (uint256) {
        return _committedRewards(_entities[id].rewardSchedule);
    }
}

contract DistributeRewardsTest is Test {
    ScheduleHarness h;

    address maintainer = makeAddr("maintainer");
    address entityOwner = makeAddr("entityOwner");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new ScheduleHarness();
        h.grantMaintainer(maintainer);
        vm.warp(START);
    }

    function _empty() internal pure returns (IVanaPoolEntity.RewardSchedule memory) {
        return IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0);
    }

    /// @dev Seed a STREAM entity with `locked` residue, `active`, `shares`, and a schedule.
    function _seed(
        uint256 locked,
        uint256 active,
        uint256 shares,
        IVanaPoolEntity.RewardSchedule memory sched
    ) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: entityOwner,
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: locked,
                activeRewardPool: active,
                totalShares: shares,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.STREAM,
                rewardSchedule: sched
            })
        );
    }

    // ---- replace / install ----

    function test_installsActiveWhenNoneExists() public {
        _seed(10_000 ether, 0, 100 ether, _empty());

        vm.prank(entityOwner);
        h.distributeRewards(ID, 10_000 ether, START, 10 days);

        IVanaPoolEntity.RewardSchedule memory s = h.getEntity(ID).rewardSchedule;
        assertEq(s.scheduledValue, 10_000 ether, "scheduled");
        assertEq(s.start, START, "start");
        assertEq(s.duration, 10 days, "duration");
        assertEq(s.lastUpdate, 0, "watermark reset");
        assertEq(h.committed(ID), 10_000 ether, "all committed");
    }

    function test_replaceOnOverlap_cancelsRemainderToResidue() public {
        // active 10k over [START, START+10d]; funded to cover it
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10_000 ether, START, 10 days, uint32(START), 0, 0, 0);
        _seed(15_000 ether, 0, 100 ether, sched);

        vm.warp(START + 5 days); // half of the active vested
        // new stream starts before active ends (overlap) -> replace
        vm.prank(maintainer);
        h.distributeRewards(ID, 8_000 ether, uint64(START + 5 days), 10 days);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.rewardSchedule.scheduledValue, 8_000 ether, "active replaced");
        assertEq(e.rewardSchedule.nextScheduledValue, 0, "queue cleared");
        assertEq(e.activeRewardPool, 5_000 ether, "old half settled into active before replace");
        // locked: 15k - 5k settled = 10k; committed = new 8k (unvested)
        assertEq(e.lockedRewardPool, 10_000 ether, "locked reduced by settle only");
        assertEq(h.committed(ID), 8_000 ether, "new active committed; old remainder is residue");
    }

    // ---- queue ----

    function test_queuesWhenStartsAtOrAfterActiveEnd() public {
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10_000 ether, START, 10 days, uint32(START), 0, 0, 0);
        _seed(30_000 ether, 0, 100 ether, sched);

        // starts exactly at active end -> contiguous, queues
        vm.prank(entityOwner);
        h.distributeRewards(ID, 20_000 ether, uint64(START + 10 days), 20 days);

        IVanaPoolEntity.RewardSchedule memory s = h.getEntity(ID).rewardSchedule;
        assertEq(s.scheduledValue, 10_000 ether, "active untouched");
        assertEq(s.nextScheduledValue, 20_000 ether, "queued");
        assertEq(s.nextStart, START + 10 days, "queued start");
        assertEq(h.committed(ID), 30_000 ether, "active remaining + queued");
    }

    // ---- escrow invariant ----

    function test_revertsWhenUnderfunded() public {
        _seed(5_000 ether, 0, 100 ether, _empty());
        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InsufficientRewardFunds.selector);
        h.distributeRewards(ID, 10_000 ether, START, 10 days);
    }

    function test_allowsSchedulingFromResidue_msgValueZero() public {
        // locked residue already covers the schedule; msg.value == 0
        _seed(10_000 ether, 0, 100 ether, _empty());
        vm.prank(entityOwner);
        h.distributeRewards(ID, 10_000 ether, START, 10 days); // no value sent
        assertEq(h.committed(ID), 10_000 ether);
    }

    // ---- access control / guards ----

    function test_onlyOwnerOrMaintainer() public {
        _seed(10_000 ether, 0, 100 ether, _empty());
        vm.prank(stranger);
        vm.expectRevert(VanaPoolEntityImplementation.NotEntityOwner.selector);
        h.distributeRewards(ID, 10_000 ether, START, 10 days);
    }

    function test_requiresStreamModel() public {
        _seed(10_000 ether, 0, 100 ether, _empty());
        // flip to APY
        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        e.rewardModel = IVanaPoolEntity.RewardModel.APY;
        h.setEntity(ID, e);

        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidRewardModel.selector);
        h.distributeRewards(ID, 10_000 ether, START, 10 days);
    }

    function test_rejectsBackdatedStartAndZeroAmount() public {
        _seed(10_000 ether, 0, 100 ether, _empty());

        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.distributeRewards(ID, 10_000 ether, uint64(START - 1), 10 days); // backdated

        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.distributeRewards(ID, 0, START, 10 days); // zero amount
    }

    // ---- end-to-end: schedule then vest ----

    function test_scheduledStreamVestsThroughProcessRewards() public {
        _seed(10_000 ether, 0, 100 ether, _empty());
        vm.prank(entityOwner);
        h.distributeRewards(ID, 10_000 ether, START, 10 days);

        vm.warp(START + 5 days);
        h.processRewards(ID); // permissionless

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.activeRewardPool, 5_000 ether, "half vested into active");
        assertEq(e.lockedRewardPool, 5_000 ether, "half still locked");
    }
}
