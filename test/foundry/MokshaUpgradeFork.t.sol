// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";
import {IVanaPoolStaking} from "../../contracts/vanaStaking/vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

/// @notice Rehearses PR #75 against a pinned Moksha snapshot. All writes stay on the local fork.
/// @dev RUN_MOKSHA_FORK=true forge test --match-path test/foundry/MokshaUpgradeFork.t.sol -vv
contract MokshaUpgradeForkTest is Test {
    address constant STAKING = 0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e;
    address constant ENTITY = 0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30;
    address constant EXISTING_STAKER = 0x334E8bBf9c7811fc3f66B22cB0d8eE48c5a4b5Ce;
    address constant MAINTAINER = 0x2AC93684679a5bdA03C6160def908CdB8D46792f;
    uint256 constant ENTITY_ID = 1;
    uint256 constant FORK_BLOCK = 9_172_987;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function test_upgradePreservesExistingPositionAndAllowsExit() public {
        vm.skip(!vm.envOr("RUN_MOKSHA_FORK", false));
        vm.createSelectFork("https://rpc.moksha.vana.org", FORK_BLOCK);

        VanaPoolStakingImplementation staking = VanaPoolStakingImplementation(payable(STAKING));
        VanaPoolEntityImplementation entity = VanaPoolEntityImplementation(payable(ENTITY));

        assertEq(address(staking.vanaPoolEntity()), ENTITY, "staking proxy points to expected entity");
        assertEq(staking.version(), 2, "expected pre-upgrade staking version");
        assertEq(entity.version(), 2, "expected pre-upgrade entity version");

        IVanaPoolStaking.StakerEntity memory positionBefore = staking.stakerEntities(EXISTING_STAKER, ENTITY_ID);
        uint256 sharesBefore = positionBefore.shares;
        uint256 poolBefore = entity.entities(ENTITY_ID).activeRewardPool;
        uint256 totalSharesBefore = entity.entities(ENTITY_ID).totalShares;
        assertGt(sharesBefore, 0, "selected existing position has shares");
        assertEq(positionBefore.costBasis, 0, "selected position is in the legacy zero-cost-basis cohort");
        assertEq(positionBefore.rewardEligibilityTimestamp, 0, "legacy position has no bond");

        // Replace only the EIP-1967 implementation pointers on the local fork.
        // This isolates storage and behavior compatibility; it bypasses upgrade
        // authorization, governance transaction execution, and role provisioning.
        address newEntity = address(new VanaPoolEntityImplementation());
        address newStaking = address(new VanaPoolStakingImplementation());
        vm.store(ENTITY, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(newEntity))));
        vm.store(STAKING, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(newStaking))));

        assertEq(staking.version(), 3, "entity upgrade exposes PR75 staking logic");
        assertEq(entity.version(), 3, "entity upgrade exposes PR75 entity logic");
        assertEq(staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).shares, sharesBefore, "position shares preserved");
        assertEq(staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).costBasis, 0, "legacy cost basis preserved");
        assertEq(
            staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).rewardEligibilityTimestamp,
            0,
            "legacy bond preserved"
        );
        assertEq(entity.entities(ENTITY_ID).activeRewardPool, poolBefore, "active pool preserved");
        assertEq(entity.entities(ENTITY_ID).totalShares, totalSharesBefore, "entity shares preserved");

        entity.processRewards(ENTITY_ID);
        assertEq(entity.stakeSecondsAt(ENTITY_ID), 0, "legacy entity starts checkpoint at first touch");
        vm.warp(block.timestamp + 1 days);
        entity.processRewards(ENTITY_ID);
        assertGt(entity.stakeSecondsAt(ENTITY_ID), 0, "existing pool accrues after checkpoint");

        uint256 balanceBefore = EXISTING_STAKER.balance;
        vm.prank(EXISTING_STAKER);
        uint256 paid = staking.unstake(ENTITY_ID, sharesBefore, 0);
        assertGt(paid, 0, "existing position exits");
        assertEq(EXISTING_STAKER.balance - balanceBefore, paid, "settlement return equals transfer");
        assertEq(staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).shares, 0, "all shares burned");
        assertEq(
            staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).realizedRewards,
            0,
            "legacy principal not booked as reward"
        );
    }

    function test_existingPositionCanRedelegateAndExitOnLocalFork() public {
        vm.skip(!vm.envOr("RUN_MOKSHA_FORK", false));
        vm.createSelectFork("https://rpc.moksha.vana.org", FORK_BLOCK);

        VanaPoolStakingImplementation staking = VanaPoolStakingImplementation(payable(STAKING));
        VanaPoolEntityImplementation entity = VanaPoolEntityImplementation(payable(ENTITY));
        assertEq(entity.entitiesCount(), 1, "snapshot has one entity; create destination only on the fork");

        vm.store(ENTITY, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(address(new VanaPoolEntityImplementation())))));
        vm.store(STAKING, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(address(new VanaPoolStakingImplementation())))));

        assertTrue(entity.hasRole(entity.MAINTAINER_ROLE(), MAINTAINER), "known maintainer retains role");
        assertTrue(staking.hasRole(staking.DEFAULT_ADMIN_ROLE(), MAINTAINER), "known admin retains role");
        bytes32 entityRole = staking.VANA_POOL_ENTITY_ROLE();
        assertFalse(staking.hasRole(entityRole, ENTITY), "current proxy lacks entity registration role");
        // Provision the missing role only on this fork so a second entity can be
        // registered. The release manifest must explicitly account for this grant.
        vm.prank(MAINTAINER);
        staking.grantRole(entityRole, ENTITY);
        uint256 registrationStake = entity.minRegistrationStake();
        vm.deal(MAINTAINER, registrationStake);
        vm.prank(MAINTAINER);
        entity.createEntity{value: registrationStake}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: MAINTAINER, name: "fork-only-destination"})
        );
        uint256 destination = entity.entitiesCount();

        uint256 sourceShares = staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).shares;
        vm.prank(EXISTING_STAKER);
        (uint256 movedValue, uint256 issuedShares) = staking.redelegate(ENTITY_ID, destination, sourceShares, 0);
        assertGt(movedValue, 0, "existing value moved");
        assertGt(issuedShares, 0, "destination shares issued");
        assertEq(staking.stakerEntities(EXISTING_STAKER, ENTITY_ID).shares, 0, "source emptied");
        assertEq(staking.stakerEntities(EXISTING_STAKER, destination).shares, issuedShares, "destination credited");

        uint256 balanceBefore = EXISTING_STAKER.balance;
        vm.prank(EXISTING_STAKER);
        uint256 paid = staking.unstake(destination, issuedShares, 0);
        assertGt(paid, 0, "migrated position exits");
        assertEq(EXISTING_STAKER.balance - balanceBefore, paid, "exit return equals transfer");
    }
}
