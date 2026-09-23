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

/// @notice Reproduces the auditor's cross-entity treasury drain. Entity A (rigged
///         STREAM) and entity B (honest) share one treasury; the attack over-refunds
///         A during bonding and the shortfall is paid out of B's deposit.
contract TreasuryDrainAttackTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer/admin
    address attacker = makeAddr("attacker"); // entity A owner
    address attacker2 = makeAddr("attacker2"); // the depositing address D
    address honest = makeAddr("honest"); // stakes into entity B

    uint256 constant MIN_STAKE = 1;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

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

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(7 days); // precondition: non-zero bond
        vm.stopPrank();

        vm.deal(owner, 1_000_000 ether);
        vm.deal(attacker, 1_000_000 ether);
        vm.deal(attacker2, 1_000_000 ether);
        vm.deal(honest, 1_000_000 ether);
    }

    function _createEntity(address entOwner, string memory name, IVanaPoolEntity.RewardModel model) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entOwner, name: name}),
            model
        );
        id = entity.entitiesCount();
    }

    /// @dev treasury must be >= the sum of every entity's booked pools.
    function _totalBacking() internal view returns (uint256 sum) {
        uint256 n = entity.entitiesCount();
        for (uint256 i = 1; i <= n; i++) {
            IVanaPoolEntity.EntityInfo memory e = entity.entities(i);
            sum += e.activeRewardPool + e.lockedRewardPool;
            sum += entity.entityAccruedCommission(i);
            sum += entity.entityStakerLockedRewardPool(i);
        }
    }

    // ---- Fix 2: the registration floor (minRegistrationStake) blocks the rig ----

    /// @dev The attack needed totalShares at dust to skew the rate. The owner
    ///      cannot drain their seed below minRegistrationStake, so the precondition
    ///      is unreachable.
    function test_attackBlocked_cannotDrainRegistrationToDust() public {
        uint256 a = _createEntity(attacker, "rigged-A", IVanaPoolEntity.RewardModel.STREAM);
        uint256 ownerShares = staking.stakerEntities(attacker, a).shares; // == 1 VANA == floor

        vm.prank(attacker);
        vm.expectRevert(VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector);
        staking.unstake(a, ownerShares - 2000, 0); // the drain-to-dust step
    }

    function test_seedFlooredButExtraIsWithdrawable() public {
        uint256 a = _createEntity(attacker, "pool-A", IVanaPoolEntity.RewardModel.APY);
        uint256 floor = entity.minRegistrationStake(); // == MIN_REG_STAKE

        // owner stakes extra beyond the seed
        vm.prank(attacker);
        staking.stake{value: 500 ether}(a, attacker, 0);
        vm.warp(block.timestamp + 7 days); // clear the bond so the exit is clean

        uint256 shares = staking.stakerEntities(attacker, a).shares;
        // can withdraw everything above the floor
        vm.prank(attacker);
        staking.unstake(a, shares - floor, 0);
        assertEq(staking.stakerEntities(attacker, a).shares, floor, "left exactly the registration floor");

        // but not one wei-share more
        vm.prank(attacker);
        vm.expectRevert(VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector);
        staking.unstake(a, 1, 0);
    }

    function test_registrationSeedIsBonded() public {
        uint256 a = _createEntity(attacker, "pool-A", IVanaPoolEntity.RewardModel.APY);
        uint256 elig = staking.stakerEntities(attacker, a).rewardEligibilityTimestamp;
        assertEq(elig, block.timestamp + 7 days, "seed bonded at registration (was unbonded before)");
    }

    function test_normalStakerNotFlooredAndFullyExits() public {
        // entity owned by attacker; honest is a plain (non-owner) staker
        uint256 b = _createEntity(attacker, "pool-B", IVanaPoolEntity.RewardModel.APY);
        vm.prank(honest);
        staking.stake{value: 100 ether}(b, honest, 0);

        vm.warp(block.timestamp + 7 days);
        uint256 shares = staking.stakerEntities(honest, b).shares;
        vm.prank(honest);
        staking.unstake(b, shares, 0); // fully exits, no floor (not the owner)
        assertEq(staking.stakerEntities(honest, b).shares, 0, "normal staker fully exited");
    }
}
