// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

contract CRHarness is VanaPoolEntityImplementation {
    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external { _entities[id] = e; }
}

/// @notice NM-1052 [Info]: committedRewards() must report what the schedule still
///         owes -- what still has to leave lockedRewardPool -- regardless of when
///         it is read. Settlement moves escrow; the clock alone does not.
contract CommittedRewardsViewTest is Test {
    CRHarness h;
    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;
    uint128 constant VALUE = 100 ether;
    uint32 constant DURATION = 100 days;

    function setUp() public { h = new CRHarness(); vm.warp(START); }

    function _install(uint128 nextValue, uint64 nextStart, uint32 nextDuration) internal {
        h.setEntity(ID, IVanaPoolEntity.Entity({
            ownerAddress: address(0xE), status: IVanaPoolEntity.EntityStatus.Active, name: "e", maxAPY: 0,
            lockedRewardPool: uint256(VALUE) + nextValue, activeRewardPool: 1000 ether, totalShares: 1000 ether,
            lastUpdateTimestamp: START, totalDistributedRewards: 0,
            rewardModel: IVanaPoolEntity.RewardModel.STREAM,
            rewardSchedule: IVanaPoolEntity.RewardSchedule({scheduledValue: VALUE, start: START, duration: DURATION,
                nextDuration: nextDuration, nextScheduledValue: nextValue, nextStart: nextStart, lastUpdate: START}),
            commissionRate: 0, accruedCommission: 0, stakedPrincipal: 1000 ether, principalSeconds: 0,
            principalSecondsUpdatedAt: START, stakingBlocked: false, sweepableAfter: 0, pendingCommissionRate: 0,
            stakerLockedRewardPool: 0, stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
        }));
    }

    function test_unsettledMidWindow_reportsWhatStillHasToLeaveEscrow() public {
        _install(0, 0, 0);
        vm.warp(START + 50 days); // half elapsed, NOT settled: nothing has left the locked pool yet
        assertEq(h.committedRewards(ID), VALUE, "still owed in full until settlement moves it");
        h.processRewards(ID); // settles 50
        assertEq(h.committedRewards(ID), VALUE / 2, "half remains after settlement");
        assertEq(h.entities(ID).lockedRewardPool, VALUE / 2, "and that is exactly what the locked pool still holds");
    }

    function test_unsettledEndedEntry_isNotReportedAsZero() public {
        _install(0, 0, 0);
        vm.warp(START + DURATION + 10 days); // ended, not settled
        assertEq(h.committedRewards(ID), VALUE, "ended but unpromoted: all of it still owed (was 0)");
        h.processRewards(ID);
        assertEq(h.committedRewards(ID), 0, "settled and promoted: nothing owed");
        assertEq(h.entities(ID).lockedRewardPool, 0);
    }

    function test_queuedEntryAlwaysCountsInFullUntilPromoted() public {
        _install(50 ether, START + DURATION, 10 days);
        vm.warp(START + DURATION + 5 days); // active ended, queued window half way -- nothing settled
        assertEq(h.committedRewards(ID), VALUE + 50 ether, "active remainder + whole queued entry");
        h.processRewards(ID); // vests the active remainder and the promoted entry's first 5 days
        assertEq(h.committedRewards(ID), 25 ether, "promoted entry's remainder");
        assertEq(h.entities(ID).lockedRewardPool, 25 ether, "view == escrow still held");
    }

    /// @dev The view equals the escrow still held at every point of a settled-or-not
    ///      timeline: locked - committed is the unscheduled residue and never negative.
    function testFuzz_viewNeverExceedsTheLockedPool(uint32 dt, bool settle) public {
        _install(30 ether, START + DURATION, 20 days);
        vm.warp(START + uint256(bound(dt, 1, 200 days)));
        if (settle) h.processRewards(ID);
        assertLe(h.committedRewards(ID), h.entities(ID).lockedRewardPool, "escrow always covers what is owed");
    }
}
