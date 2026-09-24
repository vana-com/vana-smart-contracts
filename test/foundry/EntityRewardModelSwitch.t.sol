// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev switchToStreamModel and processRewards touch only entity storage and
///      pure math (calculateYield / _vestStream) -- no VanaPoolStaking or
///      treasury -- so a bare harness that seeds an entity and grants the
///      maintainer role is enough to test the switch in isolation.
contract SwitchHarness is VanaPoolEntityImplementation {
    function grantMaintainer(address who) external {
        _grantRole(MAINTAINER_ROLE, who);
    }

    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function getEntity(uint256 id) external view returns (IVanaPoolEntity.Entity memory) {
        return _entities[id];
    }
}

contract EntityRewardModelSwitchTest is Test {
    SwitchHarness h;

    address maintainer = makeAddr("maintainer");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ENTITY_ID = 1;

    function setUp() public {
        h = new SwitchHarness();
        h.grantMaintainer(maintainer);
        vm.warp(START);
    }

    function _emptySchedule() internal pure returns (IVanaPoolEntity.RewardSchedule memory) {
        return IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0);
    }

    function _seedApy(uint256 locked, uint256 active, uint256 maxAPY) internal {
        h.setEntity(
            ENTITY_ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: maxAPY,
                lockedRewardPool: locked,
                activeRewardPool: active,
                totalShares: active, // share price 1.0; nonzero so vesting can occur
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: _emptySchedule(),
                commissionRate: 0,
                accruedCommission: 0,
                stakedPrincipal: 0,
                principalSeconds: 0,
                principalSecondsUpdatedAt: 0,
                stakingBlocked: false,
                sweepableAfter: 0,
                pendingCommissionRate: 0,
                stakerLockedRewardPool: 0,
                stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
            })
        );
    }

    // ---- access control ----

    function test_onlyMaintainerCanSwitch() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        // read the role BEFORE pranking: an external call here would otherwise
        // consume the prank and the target call would run as the default sender.
        bytes32 role = h.MAINTAINER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                role
            )
        );
        h.switchToStreamModel(ENTITY_ID, uint64(block.timestamp), 60 days);
    }

    function test_nonActiveEntityReverts() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        // flip status to Removed
        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        e.status = IVanaPoolEntity.EntityStatus.Removed;
        h.setEntity(ENTITY_ID, e);

        vm.prank(maintainer);
        vm.expectRevert(); // InvalidEntityStatus
        h.switchToStreamModel(ENTITY_ID, uint64(block.timestamp), 60 days);
    }

    // ---- switchToStreamModel: roll residue into a linear stream ----

    function test_switchToStreamModel_rollsResidueIntoStream() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        vm.warp(START + 30 days);
        uint256 dripped = h.calculateYield(100 ether, 6e18, 30 days);
        uint256 residue = 1_000 ether - dripped;

        uint64 start = uint64(block.timestamp);
        vm.prank(maintainer);
        h.switchToStreamModel(ENTITY_ID, start, 60 days);

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(uint256(e.rewardModel), uint256(IVanaPoolEntity.RewardModel.STREAM), "flipped to STREAM");
        assertEq(e.activeRewardPool, 100 ether + dripped, "APY settled before the roll");
        assertEq(e.rewardSchedule.scheduledValue, residue, "residue scheduled");
        assertEq(e.rewardSchedule.start, start, "stream start");
        assertEq(e.rewardSchedule.duration, 60 days, "stream duration");
        assertEq(e.lockedRewardPool, residue, "residue stays locked, backing the stream");
        assertEq(h.committedRewards(ENTITY_ID), residue, "fully committed to the stream");
        assertEq(e.lockedRewardPool + e.activeRewardPool, 1_100 ether, "conserved");
    }

    function test_switchToStreamModel_thenVestsLinearly() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        uint64 start = uint64(block.timestamp);
        vm.prank(maintainer);
        h.switchToStreamModel(ENTITY_ID, start, 100 days); // no APY dripped (timeElapsed 0), residue = 1000

        vm.warp(start + 50 days); // half the stream
        h.processRewards(ENTITY_ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(e.activeRewardPool, 100 ether + 500 ether, "half the residue vested");
        assertEq(e.lockedRewardPool, 500 ether, "half still locked");
    }

    function test_switchToStreamModel_clearsStaleSchedule() public {
        // APY entity carrying stale schedule fields (e.g. from a prior STREAM phase)
        IVanaPoolEntity.RewardSchedule memory stale =
            IVanaPoolEntity.RewardSchedule(999 ether, START, 5 days, 10 days, 777 ether, START + 5 days, uint64(START));
        h.setEntity(
            ENTITY_ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: 500 ether,
                activeRewardPool: 100 ether,
                totalShares: 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: stale,
                commissionRate: 0,
                accruedCommission: 0,
                stakedPrincipal: 0,
                principalSeconds: 0,
                principalSecondsUpdatedAt: 0,
                stakingBlocked: false,
                sweepableAfter: 0,
                pendingCommissionRate: 0,
                stakerLockedRewardPool: 0,
                stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
            })
        );

        uint64 start = uint64(block.timestamp);
        vm.prank(maintainer);
        h.switchToStreamModel(ENTITY_ID, start, 30 days);

        IVanaPoolEntity.RewardSchedule memory s = h.getEntity(ENTITY_ID).rewardSchedule;
        assertEq(s.scheduledValue, 500 ether, "fresh stream = residue, not the stale 999");
        assertEq(s.duration, 30 days, "fresh duration");
        assertEq(s.nextScheduledValue, 0, "stale queue cleared");
    }

    function test_switchToStreamModel_rejectsNonApy() public {
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10 ether, START, 10 days, 0, 0, 0, uint64(START));
        h.setEntity(
            ENTITY_ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: 10 ether,
                activeRewardPool: 100 ether,
                totalShares: 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.STREAM,
                rewardSchedule: sched,
                commissionRate: 0,
                accruedCommission: 0,
                stakedPrincipal: 0,
                principalSeconds: 0,
                principalSecondsUpdatedAt: 0,
                stakingBlocked: false,
                sweepableAfter: 0,
                pendingCommissionRate: 0,
                stakerLockedRewardPool: 0,
                stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
            })
        );

        vm.prank(maintainer);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidRewardModel.selector);
        h.switchToStreamModel(ENTITY_ID, uint64(block.timestamp), 60 days);
    }

    function test_switchToStreamModel_zeroResidue_parksInStreamNoSchedule() public {
        _seedApy(0, 100 ether, 6e18); // nothing to roll
        vm.prank(maintainer);
        h.switchToStreamModel(ENTITY_ID, uint64(block.timestamp), 60 days);

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(uint256(e.rewardModel), uint256(IVanaPoolEntity.RewardModel.STREAM), "flipped to STREAM");
        assertEq(e.rewardSchedule.scheduledValue, 0, "no schedule");
        assertEq(h.committedRewards(ENTITY_ID), 0, "nothing committed; fund later via distributeRewards");
    }
}
