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

/// @notice backfillRegistration: the one-time migration that gives entities
///         created before the registrant floor (Moksha entity 1, mainnet
///         entity 1) the same non-removable seed as new entities.
contract RegistrationBackfillTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer
    address reg = makeAddr("registrant");
    address stranger = makeAddr("stranger");
    uint256 constant SLOT_BONDING = 9;
    uint256 constant SLOT_REGISTRANT = 10;
    uint256 constant SLOT_REG_SHARES = 11;
    uint256 constant SEED = 1 ether;
    uint256 a;

    function setUp() public {
        vm.warp(1_000_000);
        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        staking = VanaPoolStakingImplementation(payable(new VanaPoolStakingProxy(address(si),
            abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1e15)))));
        entity = VanaPoolEntityImplementation(payable(new VanaPoolEntityProxy(address(ei),
            abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), SEED, 6e18)))));
        treasury = VanaPoolTreasuryImplementation(payable(new VanaPoolTreasuryProxy(address(ti),
            abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking))))));
        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(7 days);
        vm.stopPrank();
        vm.deal(owner, 100 ether); vm.deal(reg, 100 ether);
        vm.prank(owner);
        entity.createEntity{value: SEED}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "pool-a"}));
        a = entity.entitiesCount();
        // make it a legacy entity: wipe the record the upgrade would not have
        assertEq(uint256(vm.load(address(staking), bytes32(SLOT_BONDING))), 7 days, "slot map");
        vm.store(address(staking), keccak256(abi.encode(a, SLOT_REGISTRANT)), bytes32(0));
        vm.store(address(staking), keccak256(abi.encode(a, SLOT_REG_SHARES)), bytes32(0));
        assertEq(staking.entityRegistrant(a), address(0));
    }

    function test_backfillRecordsAndEnforcesTheFloor() public {
        // legacy: the seed is fully withdrawable
        (, uint256 maxSharesBefore, , ) = staking.getMaxUnstakeAmount(reg, a);
        assertEq(maxSharesBefore, SEED, "no floor before the backfill");

        vm.expectEmit(true, true, false, true, address(staking));
        emit VanaPoolStakingImplementation.RegistrationStakeRecorded(a, reg, SEED);
        vm.prank(owner);
        staking.backfillRegistration(a, reg, SEED);

        assertEq(staking.entityRegistrant(a), reg);
        assertEq(staking.entityRegistrationShares(a), SEED);
        vm.prank(reg);
        vm.expectRevert(VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector);
        staking.unstake(a, 1, 0);
        (, uint256 maxSharesAfter, uint256 factor, ) = staking.getMaxUnstakeAmount(reg, a);
        assertEq(maxSharesAfter, 0, "floor binds");
        assertEq(factor, 3);
    }

    function test_backfillIsOneShot() public {
        vm.startPrank(owner);
        staking.backfillRegistration(a, reg, SEED);
        vm.expectRevert(VanaPoolStakingImplementation.RegistrationAlreadyRecorded.selector);
        staking.backfillRegistration(a, reg, SEED);
        vm.stopPrank();
    }

    function test_backfillRejectsBadInputs() public {
        vm.startPrank(owner);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAddress.selector);
        staking.backfillRegistration(a, address(0), SEED);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.backfillRegistration(a, reg, 0);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.backfillRegistration(a, reg, SEED + 1); // more than the registrant holds
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.backfillRegistration(a, stranger, SEED); // holds nothing there
        vm.expectRevert(VanaPoolStakingImplementation.InvalidEntity.selector);
        staking.backfillRegistration(99, reg, SEED);
        vm.stopPrank();
    }

    function test_backfillOnlyMaintainer() public {
        vm.prank(stranger);
        vm.expectRevert();
        staking.backfillRegistration(a, reg, SEED);
    }

    function test_backfillCannotOverrideAFreshEntityRecord() public {
        vm.prank(owner);
        entity.createEntity{value: SEED}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "pool-b"}));
        uint256 b = entity.entitiesCount();
        assertEq(staking.entityRegistrant(b), reg, "created with a record");
        vm.prank(owner);
        vm.expectRevert(VanaPoolStakingImplementation.RegistrationAlreadyRecorded.selector);
        staking.backfillRegistration(b, stranger, SEED);
    }
}
