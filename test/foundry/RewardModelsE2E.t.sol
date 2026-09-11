// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @notice End-to-end through the real proxy stack (staking + entity + treasury):
///         create an entity, fund/schedule rewards under each model, stake,
///         let rewards accrue, unstake, and assert the staker earned. bondingPeriod
///         defaults to 0, so unstake pays full value immediately.
contract RewardModelsE2ETest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // admin + maintainer on all three
    address entityOwner = makeAddr("entityOwner"); // holds the registration stake
    address staker = makeAddr("staker");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether; // createEntity requires exactly this
    uint256 constant MAX_APY_DEFAULT = 6e18; // 6%
    uint256 constant STAKE = 100 ether;

    function setUp() public {
        vm.warp(1_000_000);

        // implementations
        VanaPoolStakingImplementation stakingImpl = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation entityImpl = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation treasuryImpl = new VanaPoolTreasuryImplementation();

        // staking proxy (no cross-refs in init)
        staking = VanaPoolStakingImplementation(
            payable(
                new VanaPoolStakingProxy(
                    address(stakingImpl),
                    abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, MIN_STAKE))
                )
            )
        );

        // entity proxy (init wires staking + grants it VANA_POOL_ROLE)
        entity = VanaPoolEntityImplementation(
            payable(
                new VanaPoolEntityProxy(
                    address(entityImpl),
                    abi.encodeCall(
                        VanaPoolEntityImplementation.initialize,
                        (owner, address(staking), MIN_REG_STAKE, MAX_APY_DEFAULT)
                    )
                )
            )
        );

        // treasury proxy (init grants DEFAULT_ADMIN to staking so it can pay out)
        treasury = VanaPoolTreasuryImplementation(
            payable(
                new VanaPoolTreasuryProxy(
                    address(treasuryImpl),
                    abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))
                )
            )
        );

        // complete the graph: staking -> entity (grants VANA_POOL_ENTITY_ROLE) + treasury
        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        // let the entity pull commission from the treasury (commission upgrade wiring)
        treasury.grantRole(treasury.DEFAULT_ADMIN_ROLE(), address(entity));
        vm.stopPrank();

        vm.deal(owner, 10_000 ether);
        vm.deal(staker, 1_000 ether);
    }

    function _createEntity() internal returns (uint256 entityId) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: "pool"})
        );
        entityId = entity.entitiesCount();
    }

    /// @dev Stake as `staker`, hold while rewards accrue, unstake all, return net gain.
    function _stakeEarnUnstake(uint256 entityId, uint256 warpBy) internal returns (int256 net) {
        uint256 priceBefore = entity.entityShareToVana(entityId);
        assertApproxEqAbs(priceBefore, 1e18, 1, "price ~1.0 before rewards");

        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(entityId, staker, 0);

        // let rewards accrue, then realize them into the share price
        vm.warp(block.timestamp + warpBy);
        entity.processRewards(entityId);

        assertGt(entity.entityShareToVana(entityId), 1e18, "price rose after rewards");

        // unstake the staker's full position
        uint256 shares = _stakerShares(entityId);
        vm.prank(staker);
        staking.unstake(entityId, shares, 0);

        net = int256(staker.balance) - int256(balBefore);
    }

    function _stakerShares(uint256 entityId) internal view returns (uint256) {
        return staking.stakerEntities(staker, entityId).shares;
    }

    // ---- APY model ----

    function test_apyModel_stakerEarnsAndWithdraws() public {
        uint256 entityId = _createEntity();

        // fund the APY drip
        vm.prank(owner);
        entity.addRewards{value: 100 ether}(entityId);

        // entity is APY by default
        assertEq(uint256(entity.entityRewardModel(entityId)), uint256(IVanaPoolEntity.RewardModel.APY));

        int256 net = _stakeEarnUnstake(entityId, 365 days);
        assertGt(net, 0, "staker earned APY rewards");
    }

    // ---- STREAM model ----

    function test_streamModel_stakerEarnsAndWithdraws() public {
        uint256 entityId = _createEntity();

        // switch to STREAM and schedule a stream funded now
        vm.startPrank(owner);
        entity.updateEntityRewardModel(entityId, IVanaPoolEntity.RewardModel.STREAM);
        entity.distributeRewards{value: 100 ether}(entityId, 100 ether, uint64(block.timestamp), 365 days);
        vm.stopPrank();

        assertEq(uint256(entity.entityRewardModel(entityId)), uint256(IVanaPoolEntity.RewardModel.STREAM));

        int256 net = _stakeEarnUnstake(entityId, 365 days);
        assertGt(net, 0, "staker earned STREAM rewards");
    }

    // ---- STREAM model x bonding period ----

    /// @dev A STREAM entity with a `bonding`-second bonding period and a stream
    ///      of `amount` over `duration`, funded now.
    function _streamWithBonding(
        uint256 bonding,
        uint256 amount,
        uint32 duration
    ) internal returns (uint256 entityId) {
        vm.prank(owner);
        staking.updateBondingPeriod(bonding);

        entityId = _createEntity();
        vm.startPrank(owner);
        entity.updateEntityRewardModel(entityId, IVanaPoolEntity.RewardModel.STREAM);
        entity.distributeRewards{value: amount}(entityId, amount, uint64(block.timestamp), duration);
        vm.stopPrank();
    }

    function test_streamBonding_earlyExitForfeitsRewards() public {
        // 30-day bond, 100 VANA streamed over 30 days
        uint256 entityId = _streamWithBonding(30 days, 100 ether, 30 days);

        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(entityId, staker, 0); // eligibility = now + 30 days

        // vest half the stream, lifting the price
        vm.warp(block.timestamp + 15 days);
        entity.processRewards(entityId);
        assertGt(entity.entityShareToVana(entityId), 1e18, "stream lifted the price");

        uint256 lockedBefore = entity.entities(entityId).lockedRewardPool;

        // unstake DURING bonding -> principal only; the appreciation is forfeited
        // (read shares before pranking: an external call would consume the prank)
        uint256 shares = _stakerShares(entityId);
        vm.prank(staker);
        staking.unstake(entityId, shares, 0);

        int256 net = int256(staker.balance) - int256(balBefore);
        assertApproxEqAbs(net, 0, 1e12, "early exit returns principal only");

        // forfeited stream rewards were returned to locked (as STREAM residue)
        assertGt(
            entity.entities(entityId).lockedRewardPool,
            lockedBefore,
            "forfeited rewards -> locked residue"
        );
    }

    function test_streamBonding_lateExitCollectsRewards() public {
        uint256 entityId = _streamWithBonding(30 days, 100 ether, 30 days);

        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(entityId, staker, 0);

        // wait past bonding; the stream fully vests
        vm.warp(block.timestamp + 31 days);
        entity.processRewards(entityId);

        uint256 shares = _stakerShares(entityId);
        vm.prank(staker);
        staking.unstake(entityId, shares, 0);

        int256 net = int256(staker.balance) - int256(balBefore);
        assertGt(net, 0, "late exit collects the stream rewards it earned");
    }

    // ---- commission ----

    function test_commission_delegatorEarnsPostCut_ownerClaims() public {
        uint256 entityId = _createEntity();

        // 20% commission, fund the APY drip
        vm.startPrank(owner);
        entity.updateEntityCommission(entityId, 20e18);
        entity.addRewards{value: 100 ether}(entityId);
        vm.stopPrank();
        assertEq(entity.entityCommissionRate(entityId), 20e18);

        // delegator earns the post-commission remainder
        int256 net = _stakeEarnUnstake(entityId, 365 days);
        assertGt(net, 0, "delegator earned post-commission rewards");

        // owner claims the accrued commission out of the treasury
        uint256 accrued = entity.entityAccruedCommission(entityId);
        assertGt(accrued, 0, "commission accrued to the operator");

        uint256 ownerBalBefore = entityOwner.balance;
        vm.prank(owner);
        entity.claimCommission(entityId);

        assertEq(entityOwner.balance - ownerBalBefore, accrued, "owner received the commission");
        assertEq(entity.entityAccruedCommission(entityId), 0, "accrued reset after claim");
    }

    // ---- launch: capped bootstrap, then roll leftover into linear ----

    function test_launchHandoff_cappedThenRollToStream() public {
        uint256 entityId = _createEntity();

        // capped phase: fund the whole pot, run a higher bootstrap APY
        vm.startPrank(owner);
        entity.updateEntityMaxAPY(entityId, 40e18); // 40%
        entity.addRewards{value: 1_000 ether}(entityId); // the pot
        vm.stopPrank();

        // a migrator stakes in
        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(entityId, staker, 0);

        // 14 days of capped APY
        vm.warp(block.timestamp + 14 days);
        entity.processRewards(entityId);
        uint256 residue = entity.entities(entityId).lockedRewardPool;
        assertGt(residue, 0, "pot has leftover after the capped phase");

        // day 14: ONE call rolls the leftover into a 60-day linear stream
        vm.prank(owner);
        entity.switchToStreamModel(entityId, uint64(block.timestamp), 60 days);
        assertEq(uint256(entity.entityRewardModel(entityId)), uint256(IVanaPoolEntity.RewardModel.STREAM));
        assertEq(entity.committedRewards(entityId), residue, "leftover rolled into the stream");

        // linear phase runs; staker earns across both phases
        vm.warp(block.timestamp + 60 days);
        entity.processRewards(entityId);

        uint256 shares = _stakerShares(entityId);
        vm.prank(staker);
        staking.unstake(entityId, shares, 0);

        assertGt(int256(staker.balance) - int256(balBefore), 0, "staker earned across capped + linear");
    }
}
