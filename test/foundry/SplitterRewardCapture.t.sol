// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {RewardSplitterImplementation} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";
import {RewardSplitterProxy} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @notice Proves the fix for the "entity owner captures/withholds splitter
///         rewards" finding: splitter rewards are credited to delegators directly
///         via addStakerRewards, bypassing lockedRewardPool, the owner-controlled
///         release, and any owner-spiked commission rate.
contract SplitterRewardCaptureTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;
    RewardSplitterImplementation splitter;

    address owner = makeAddr("owner"); // admin + maintainer everywhere
    address entityOwner = makeAddr("entityOwner"); // the potentially-malicious operator
    address delegator = makeAddr("delegator");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;
    uint256 constant STAKE = 100 ether;
    uint256 constant X = 100 ether; // the splitter budget per payout round

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        RewardSplitterImplementation ri = new RewardSplitterImplementation();

        staking = VanaPoolStakingImplementation(
            payable(
                new VanaPoolStakingProxy(
                    address(si),
                    abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, MIN_STAKE))
                )
            )
        );
        entity = VanaPoolEntityImplementation(
            payable(
                new VanaPoolEntityProxy(
                    address(ei),
                    abi.encodeCall(
                        VanaPoolEntityImplementation.initialize,
                        (owner, address(staking), MIN_REG_STAKE, MAX_APY_DEFAULT)
                    )
                )
            )
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(
                new VanaPoolTreasuryProxy(
                    address(ti),
                    abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))
                )
            )
        );
        splitter = RewardSplitterImplementation(
            payable(
                new RewardSplitterProxy(
                    address(ri),
                    abi.encodeCall(RewardSplitterImplementation.initialize, (owner, address(entity)))
                )
            )
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        treasury.updateVanaPoolEntity(address(entity)); // commission claims
        entity.updateRewardSplitter(address(splitter)); // first-class wiring: grants REWARD_SPLITTER_ROLE
        splitter.updateRewardVestingDuration(7 days);
        vm.stopPrank();

        vm.deal(owner, 100_000 ether);
        vm.deal(delegator, 100_000 ether);
        vm.deal(address(splitter), 10_000 ether);
    }

    function _entityWithDelegator() internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: "operator-pool"})
        );
        id = entity.entitiesCount();
        vm.prank(delegator);
        staking.stake{value: STAKE}(id, delegator, 0);
    }

    /// @dev Two splitter rounds: first-seen baseline (pays nothing), then payout
    ///      of `amount` to the (single) entity.
    function _deliverReward(uint256 id, uint256 amount) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        splitter.distribute(amount, ids); // baseline
        vm.warp(block.timestamp + 10 days);
        vm.prank(owner);
        splitter.distribute(amount, ids); // payout -> entity gets `amount`
    }

    function _active(uint256 id) internal view returns (uint256) {
        return entity.entities(id).activeRewardPool;
    }

    // ---- the attack, neutralized ----

    function test_unilateralCommissionSpikeCannotCaptureSplitterReward() public {
        uint256 id = _entityWithDelegator();

        // owner tries to arm 100% commission -- but can only PROPOSE; no approval
        vm.prank(entityOwner);
        entity.proposeCommissionRate(id, 100e18);
        assertEq(entity.entityCommissionRate(id), 0, "rate not raised without maintainer");

        uint256 delBalBefore = delegator.balance;
        _deliverReward(id, X); // reward credited to delegators at the live rate (0%)

        // owner cannot skim it: nothing accrued, and the staging paths are empty
        assertEq(entity.entityAccruedCommission(id), 0, "no commission captured");
        vm.prank(entityOwner);
        vm.expectRevert(); // nothing to claim
        entity.claimCommission(id);
        vm.prank(entityOwner);
        vm.expectRevert(); // APY entity / no lockedRewardPool residue to instant-release
        entity.distributeRewards(id, X, uint64(block.timestamp), 0);

        // once the reward has vested, the delegator holds it and can withdraw it
        vm.warp(block.timestamp + 7 days); // full vesting span
        uint256 shares = staking.stakerEntities(delegator, id).shares;
        vm.prank(delegator);
        staking.unstake(id, shares, 0); // unstake settles the vesting
        assertGt(delegator.balance - delBalBefore, STAKE, "delegator received principal + reward");
    }

    function test_noRetroactiveSkimAfterLaterRateIncrease() public {
        uint256 id = _entityWithDelegator();
        _deliverReward(id, X); // paid at 0% -> all to delegators

        // later, owner raises the rate with maintainer approval
        vm.prank(entityOwner);
        entity.proposeCommissionRate(id, 100e18);
        vm.prank(owner);
        entity.approveCommissionRate(id, 100e18);

        // the already-paid reward is untouched: it vests on the splitter track,
        // which carries no commission, so a later 100% rate cannot skim it
        assertEq(entity.entityAccruedCommission(id), 0, "past reward not retroactively skimmed");
        uint256 delBalBefore = delegator.balance;
        vm.warp(block.timestamp + 7 days);
        uint256 shares = staking.stakerEntities(delegator, id).shares;
        vm.prank(delegator);
        staking.unstake(id, shares, 0);
        assertEq(entity.entityAccruedCommission(id), 0, "vesting splitter reward carried no commission");
        assertGt(delegator.balance - delBalBefore, STAKE, "delegator keeps the earlier reward");
    }

    function test_noWithholding_committedImmediately() public {
        uint256 id = _entityWithDelegator();
        uint256 lockedBefore = entity.entities(id).lockedRewardPool;

        _deliverReward(id, X);

        // committed to the owner-proof track at once (owner cannot withhold it),
        // and the owner's own locked pool is untouched
        assertGt(entity.entityStakerLockedRewardPool(id), 0, "reward committed to the splitter track");
        assertEq(entity.entities(id).lockedRewardPool, lockedBefore, "nothing staged in the owner's locked pool");

        // it vests to delegators without any owner action
        uint256 activeBefore = _active(id);
        vm.warp(block.timestamp + 7 days);
        entity.processRewards(id);
        assertGt(_active(id), activeBefore, "vested to delegators without owner action");
    }

    function test_addStakerRewardsOnlyCallableBySplitter() public {
        uint256 id = _entityWithDelegator();
        vm.deal(entityOwner, 1 ether);
        vm.prank(entityOwner);
        vm.expectRevert(); // missing REWARD_SPLITTER_ROLE
        entity.addStakerRewards{value: 1 ether}(id, true, 7 days);
    }

    // ---- scheduled (not instant) vesting ----

    function test_vestsGraduallyOverDuration() public {
        uint256 id = _entityWithDelegator();
        _deliverReward(id, X); // X committed, vesting over 7 days from now
        assertApproxEqAbs(entity.entityStakerLockedRewardPool(id), X, 1e12, "full X committed, none vested yet");

        // midpoint: ~half vested
        vm.warp(block.timestamp + 3 days + 12 hours);
        entity.processRewards(id);
        assertApproxEqRel(entity.entityStakerLockedRewardPool(id), X / 2, 1e16, "~half still locked at the midpoint");

        // end of window: fully vested
        vm.warp(block.timestamp + 4 days);
        entity.processRewards(id);
        assertEq(entity.entityStakerLockedRewardPool(id), 0, "fully vested at the end");
    }

    function test_overlappingRoundsRebaseAndFullyVest() public {
        uint256 id = _entityWithDelegator();
        _deliverReward(id, X); // round 1: X vesting over 7 days

        // 3 days in, a second (overlapping) round arrives
        vm.warp(block.timestamp + 3 days);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner);
        splitter.distribute(X, ids);

        // remaining round-1 balance + round-2 re-vest over a fresh window
        assertGt(entity.entityStakerLockedRewardPool(id), X, "remaining round1 + round2 committed");

        // after a full fresh window, everything vests
        vm.warp(block.timestamp + 7 days);
        entity.processRewards(id);
        assertEq(entity.entityStakerLockedRewardPool(id), 0, "all rebased rewards fully vest");
    }

    // ---- commission still works when governance approves it ----

    function test_commissionPaidAtomically_whenApproved() public {
        uint256 id = _entityWithDelegator();

        // governance approves a 20% cut
        vm.prank(entityOwner);
        entity.proposeCommissionRate(id, 20e18);
        vm.prank(owner);
        entity.approveCommissionRate(id, 20e18);

        _deliverReward(id, X);

        // owner earns exactly 20% of the payout round, atomically; 80% to delegators
        assertEq(entity.entityAccruedCommission(id), (X * 20e18) / 100e18, "owner accrued 20% of X");
    }

    function test_payEntityCommissionFalse_allToDelegatorsEvenAt100() public {
        uint256 id = _entityWithDelegator();

        // even a maintainer-approved 100% rate is bypassed when the splitter is
        // configured not to pay entity commission
        vm.prank(entityOwner);
        entity.proposeCommissionRate(id, 100e18);
        vm.prank(owner);
        entity.approveCommissionRate(id, 100e18);
        vm.prank(owner);
        splitter.updatePayEntityCommission(false);

        _deliverReward(id, X);
        assertEq(entity.entityAccruedCommission(id), 0, "no commission when payEntityCommission is off");
    }
}
