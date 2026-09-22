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

/// @dev Forces a real position into the V1 legacy state (costBasis 0, no bond)
///      that the V1->V2 migration left behind, and exposes its cost basis.
contract LegacyHealHarness is VanaPoolStakingImplementation {
    function forceLegacy(address staker, uint256 entityId) external {
        StakerEntity storage se = _stakers[staker].entities[entityId];
        se.costBasis = 0;
        se.rewardEligibilityTimestamp = 0;
    }

    function positionCostBasis(address staker, uint256 entityId) external view returns (uint256) {
        return _stakers[staker].entities[entityId].costBasis;
    }
}

/// @notice A legacy zero-costBasis position is healed to its full current value
///         the first time stake/unstake/redelegate reads it, so its principal is
///         never mis-booked as reward nor under-valued during a bond.
contract LegacyCostBasisHealTest is Test {
    LegacyHealHarness staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;

    function setUp() public {
        vm.warp(1_000_000);

        LegacyHealHarness si = new LegacyHealHarness();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = LegacyHealHarness(
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

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        vm.stopPrank();

        vm.deal(owner, 10_000 ether);
        vm.deal(staker, 10_000 ether);
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: name})
        );
        id = entity.entitiesCount();
    }

    function _shares(uint256 id) internal view returns (uint256) {
        return staking.stakerEntities(staker, id).shares;
    }

    // ---- unstake: legacy principal is not reported as reward, full value paid ----

    function test_healOnUnstake_fullValueNoRewardInflation() public {
        uint256 id = _createEntity("legacy-pool");
        vm.prank(staker);
        staking.stake{value: 100 ether}(id, staker, 0);

        // simulate the V1 leftover
        staking.forceLegacy(staker, id);
        assertEq(staking.positionCostBasis(staker, id), 0, "starts legacy (costBasis 0)");

        uint256 balBefore = staker.balance;
        uint256 shares = _shares(id);
        vm.prank(staker);
        staking.unstake(id, shares, 0);

        // full principal returned, and none of it booked as realized reward
        assertApproxEqAbs(staker.balance - balBefore, 100 ether, 1e12, "full value paid out");
        assertEq(staking.stakerEntities(staker, id).realizedRewards, 0, "principal not counted as reward");
    }

    // ---- redelegate into a fresh entity: real cost basis carries, not zero ----

    function test_healOnRedelegate_carriesRealCostBasis() public {
        uint256 a = _createEntity("from-pool");
        uint256 b = _createEntity("to-pool");
        vm.prank(staker);
        staking.stake{value: 100 ether}(a, staker, 0);
        staking.forceLegacy(staker, a);

        uint256 shares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, shares, 0);

        // the moved principal arrives as real cost basis, not the stale zero
        assertApproxEqAbs(staking.positionCostBasis(staker, b), 100 ether, 1e12, "cost basis carried, not 0");
        assertEq(_shares(a), 0, "left the source");
    }

    // ---- the trap: redelegate a legacy position into a still-bonded position ----

    function test_healOnRedelegate_bondedDestinationNoPrincipalLoss() public {
        vm.prank(owner);
        staking.updateBondingPeriod(5 days);

        uint256 a = _createEntity("from-pool");
        uint256 b = _createEntity("to-pool");

        // an existing, still-bonding position in B (small)
        vm.prank(staker);
        staking.stake{value: 1 ether}(b, staker, 0);

        // a large legacy position in A
        vm.prank(staker);
        staking.stake{value: 100 ether}(a, staker, 0);
        staking.forceLegacy(staker, a);

        // migrate A -> B; the merged B position is bonded (inherits B's bond)
        uint256 shares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, shares, 0);

        // exit B DURING the bond, in the same block: bonding pays proportional
        // cost basis. Without the heal this would be ~1 ether (the 100 migrated
        // is lost); with the heal the migrated principal is recoverable.
        uint256 balBefore = staker.balance;
        uint256 bShares = _shares(b);
        vm.prank(staker);
        staking.unstake(b, bShares, 0);

        uint256 payout = staker.balance - balBefore;
        assertGe(payout, 100 ether, "migrated principal recoverable during bond");
        assertApproxEqAbs(payout, 101 ether, 1e15, "recovers existing + migrated principal");
    }
}
