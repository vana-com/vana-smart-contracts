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

/// @notice NM-1052 [Info] re-review: minStakeAmount was enforced only on stake().
///         Now a partial unstake / unstakeVana leaves nothing or at least the
///         minimum, and a redelegation moves at least the minimum and leaves
///         nothing or at least the minimum behind. Absolute T0 timestamps.
contract MinStakeResidualTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address reg = makeAddr("registrant");
    address alice = makeAddr("alice");

    uint256 constant MIN = 1 ether; // minStakeAmount
    uint256 constant REG = 1 ether; // registration floor (>= MIN, as on both live chains)
    uint256 constant T0 = 1_000_000;
    uint256 constant BOND = 7 days;
    uint256 a;
    uint256 b;

    function setUp() public {
        vm.warp(T0);
        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        staking = VanaPoolStakingImplementation(payable(new VanaPoolStakingProxy(address(si),
            abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, MIN)))));
        entity = VanaPoolEntityImplementation(payable(new VanaPoolEntityProxy(address(ei),
            abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), REG, 6e18)))));
        treasury = VanaPoolTreasuryImplementation(payable(new VanaPoolTreasuryProxy(address(ti),
            abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking))))));
        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(BOND);
        vm.stopPrank();
        vm.deal(owner, 100 ether); vm.deal(reg, 100 ether); vm.deal(alice, 100 ether);
        a = _create("pool-a"); b = _create("pool-b");
        vm.prank(alice);
        staking.stake{value: 10 ether}(a, alice, 0); // price stays 1:1 (no rewards): 10e18 shares
        vm.warp(T0 + BOND + 1); // past the bond
    }

    function _create(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: REG}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: name}));
        id = entity.entitiesCount();
    }

    function _shares(address who, uint256 id) internal view returns (uint256) { return staking.stakerEntities(who, id).shares; }

    // ---- unstake ----

    function test_unstakeCannotLeaveADustResidual() public {
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InsufficientStakeAmount.selector);
        staking.unstake(a, 10 ether - 1, 0); // would leave 1 wei-share
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InsufficientStakeAmount.selector);
        staking.unstake(a, 9 ether + 1, 0); // would leave just under the minimum
    }

    function test_unstakeMayLeaveExactlyTheMinimumOrNothing() public {
        vm.prank(alice);
        staking.unstake(a, 9 ether, 0); // leaves exactly MIN
        assertEq(_shares(alice, a), 1 ether);
        vm.prank(alice);
        staking.unstake(a, 1 ether, 0); // full exit is always allowed
        assertEq(_shares(alice, a), 0);
    }

    function test_unstakeVanaInheritsTheRule() public {
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InsufficientStakeAmount.selector);
        staking.unstakeVana(a, 9.5 ether, 0, 0); // would leave 0.5 VANA
        vm.prank(alice);
        staking.unstakeVana(a, 9 ether, 0, 0); // leaves 1 VANA
        assertEq(_shares(alice, a), 1 ether);
    }

    // ---- redelegate ----

    function test_redelegateMustMoveAtLeastTheMinimum() public {
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InsufficientStakeAmount.selector);
        staking.redelegate(a, b, 0.5 ether, 0); // dust position would be minted in b
    }

    function test_redelegateCannotLeaveADustResidual() public {
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InsufficientStakeAmount.selector);
        staking.redelegate(a, b, 9.5 ether, 0); // 0.5 would remain in a
    }

    function test_redelegatePartialAndFullWithinTheRule() public {
        vm.prank(alice);
        staking.redelegate(a, b, 5 ether, 0); // 5 moved (>= MIN), 5 left (>= MIN)
        assertEq(_shares(alice, a), 5 ether);
        assertEq(_shares(alice, b), 5 ether);
        uint256 rest = _shares(alice, a);
        vm.prank(alice);
        staking.redelegate(a, b, rest, 0); // full move: residual zero
        assertEq(_shares(alice, a), 0);
    }

    // ---- registrant floor and the minimum coexist ----

    function test_registrantCanUnstakeDownToTheFloorWhenFloorCoversTheMinimum() public {
        vm.prank(reg);
        staking.stake{value: 4 ether}(a, reg, 0);
        vm.warp(block.timestamp + BOND + 1);
        uint256 above = _shares(reg, a) - staking.entityRegistrationShares(a);
        vm.prank(reg);
        staking.unstake(a, above, 0); // residual == floor (1 VANA) == MIN: allowed
        assertEq(_shares(reg, a), REG);
    }
}
