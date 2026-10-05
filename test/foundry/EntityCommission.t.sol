// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev The commission skim is pure accounting inside processRewards (locked ->
///      active + accruedCommission), so a bare harness that seeds an entity is
///      enough. The claim path (treasury pull) is covered in the e2e test.
contract CommissionHarness is VanaPoolEntityImplementation {
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

contract EntityCommissionTest is Test {
    CommissionHarness h;

    address entityOwner = makeAddr("entityOwner");
    address maintainer = makeAddr("maintainer");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new CommissionHarness();
        h.grantMaintainer(maintainer);
        vm.warp(START);
    }

    function _empty() internal pure returns (IVanaPoolEntity.RewardSchedule memory) {
        return IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0);
    }

    function _seed(
        IVanaPoolEntity.RewardModel model,
        uint256 locked,
        uint256 active,
        uint256 commissionRate,
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
                totalShares: active > 0 ? active : 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: model,
                rewardSchedule: sched,
                commissionRate: commissionRate,
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

    // ---- skim: APY ----

    function test_apySkimSplitsAndConserves() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty()); // 10%
        vm.warp(START + 365 days);

        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);
        uint256 commission = toDistribute / 10;

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, commission, "10% skimmed");
        assertEq(e.activeRewardPool, 100 ether + (toDistribute - commission), "delegator remainder to active");
        assertEq(e.lockedRewardPool, 1_000 ether - toDistribute, "locked -= full distribution");
        assertEq(
            e.lockedRewardPool + e.activeRewardPool + e.accruedCommission,
            1_100 ether,
            "locked + active + commission conserved"
        );
    }

    // ---- skim: STREAM ----

    function test_streamSkimSplits() public {
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(100 ether, START, 10 days, 0, 0, 0, uint64(START));
        _seed(IVanaPoolEntity.RewardModel.STREAM, 100 ether, 0, 20e18, sched); // 20%

        vm.warp(START + 5 days); // half vests -> 50 ether distributed
        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, 10 ether, "20% of 50");
        assertEq(e.activeRewardPool, 40 ether, "80% to delegators");
        assertEq(e.lockedRewardPool, 50 ether, "half still locked");
    }

    // ---- zero commission == old behaviour ----

    function test_zeroCommission_allToDelegators() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.warp(START + 365 days);
        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, 0, "no commission");
        assertEq(e.activeRewardPool, 100 ether + toDistribute, "everything to delegators");
    }

    // ---- two-phase increases: approval settles at the old rate ----

    function test_approveCommission_settlesAtOldRateFirst() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty()); // 10%
        vm.warp(START + 365 days);
        uint256 pending = h.calculateYield(100 ether, 6e18, 365 days);

        vm.prank(entityOwner);
        h.proposeCommissionRate(ID, 20e18); // owner proposes 20%
        vm.prank(maintainer);
        h.approveCommissionRate(ID, 20e18); // maintainer approves -> applies, settling at old 10%

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.commissionRate, 20e18, "new rate applied");
        assertEq(e.pendingCommissionRate, 0, "proposal cleared");
        assertEq(e.accruedCommission, pending / 10, "pending settled at OLD 10%");
    }

    // ---- the approval commits to a value: a front-run proposal cannot swap it ----

    /// @dev NM-1052 [High] re-review: an owner could front-run the maintainer's
    ///      approveCommissionRate with a new proposal and have an unreviewed
    ///      value approved. The maintainer now states the rate they approve.
    function test_approveCommission_rejectsFrontRunProposal() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty()); // 10%
        vm.prank(entityOwner);
        h.proposeCommissionRate(ID, 20e18); // the maintainer reviews 20% ...

        // ... but the owner re-proposes 100% just before the approval lands
        vm.prank(entityOwner);
        h.proposeCommissionRate(ID, 100e18);
        assertEq(h.entityPendingCommissionRate(ID), 100e18, "pending swapped by the front-run");

        vm.prank(maintainer);
        vm.expectRevert(VanaPoolEntityImplementation.PendingCommissionMismatch.selector);
        h.approveCommissionRate(ID, 20e18); // approving what was reviewed fails safely

        assertEq(h.entityCommissionRate(ID), 10e18, "rate unchanged");
        assertEq(h.entityPendingCommissionRate(ID), 100e18, "the swapped proposal stays pending, visibly");
        // only an explicit approval of the swapped value applies it
        vm.prank(maintainer);
        h.approveCommissionRate(ID, 100e18);
        assertEq(h.entityCommissionRate(ID), 100e18);
    }

    function test_approveCommission_requiresTheExactPendingValue() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty());
        vm.prank(maintainer);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.approveCommissionRate(ID, 20e18); // nothing proposed yet

        vm.prank(entityOwner);
        h.proposeCommissionRate(ID, 20e18);
        vm.prank(maintainer);
        vm.expectRevert(VanaPoolEntityImplementation.PendingCommissionMismatch.selector);
        h.approveCommissionRate(ID, 25e18); // wrong value
        vm.prank(maintainer);
        h.approveCommissionRate(ID, 20e18); // exact value
        assertEq(h.entityCommissionRate(ID), 20e18);
        assertEq(h.entityPendingCommissionRate(ID), 0);
    }

    // ---- two-phase gating ----

    function test_proposeDoesNotApplyUntilApproved() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty());
        vm.prank(entityOwner);
        h.proposeCommissionRate(ID, 50e18);
        assertEq(h.entityCommissionRate(ID), 10e18, "rate unchanged until approved");
        assertEq(h.entityPendingCommissionRate(ID), 50e18, "proposal pending");
    }

    function test_ownerCannotApproveOwnIncrease() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty());
        vm.startPrank(entityOwner);
        h.proposeCommissionRate(ID, 50e18);
        vm.expectRevert(); // approveCommissionRate is MAINTAINER_ROLE-gated
        h.approveCommissionRate(ID, 50e18);
        vm.stopPrank();
    }

    function test_updateEntityCommissionCannotRaise() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty());
        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.updateEntityCommission(ID, 20e18); // increase must go through propose/approve
    }

    function test_decreaseIsImmediateAndCancelsPending() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 20e18, _empty());
        vm.startPrank(entityOwner);
        h.proposeCommissionRate(ID, 50e18); // pending increase
        h.updateEntityCommission(ID, 5e18); // immediate decrease
        vm.stopPrank();
        assertEq(h.entityCommissionRate(ID), 5e18, "decrease applied immediately");
        assertEq(h.entityPendingCommissionRate(ID), 0, "decrease cancels the pending increase");
    }

    // ---- access + bounds ----

    function test_onlyOwnerOrMaintainerSetsCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty());
        vm.prank(stranger);
        vm.expectRevert(VanaPoolEntityImplementation.NotEntityOwner.selector);
        h.updateEntityCommission(ID, 5e18);
    }

    function test_maintainerCanRaiseCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.startPrank(maintainer);
        h.proposeCommissionRate(ID, 15e18);
        h.approveCommissionRate(ID, 15e18);
        vm.stopPrank();
        assertEq(h.entityCommissionRate(ID), 15e18);
    }

    function test_rejectsAboveMaxCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.proposeCommissionRate(ID, 100e18 + 1); // > MAX_COMMISSION
    }

    function test_hundredPercentCommission_delegatorsGetNothing() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 100e18, _empty()); // 100%
        vm.warp(START + 365 days);
        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, toDistribute, "all to operator");
        assertEq(e.activeRewardPool, 100 ether, "nothing to delegators");
    }
}
