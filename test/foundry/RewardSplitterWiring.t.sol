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

/// @notice NM-1052 [High] follow-up ("partially fixed"): REWARD_SPLITTER_ROLE was
///         granted nowhere outside test setUps, so addStakerRewards reverted on a
///         real deployment. updateRewardSplitter is the first-class wiring.
contract RewardSplitterWiringTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer
    address reg = makeAddr("registrant");
    address stranger = makeAddr("stranger");
    address splitterA = makeAddr("splitterA");
    address splitterB = makeAddr("splitterB");

    uint256 id;

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(address(si),
                abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1e15))))
        );
        entity = VanaPoolEntityImplementation(
            payable(new VanaPoolEntityProxy(address(ei),
                abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), 1 ether, 6e18))))
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(new VanaPoolTreasuryProxy(address(ti),
                abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))))
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        vm.stopPrank();

        vm.deal(owner, 100 ether);
        vm.deal(splitterA, 100 ether);
        vm.deal(splitterB, 100 ether);

        vm.prank(owner);
        entity.createEntity{value: 1 ether}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "pool-a"}));
        id = entity.entitiesCount();
    }

    function _pay(address splitter) internal {
        vm.prank(splitter);
        entity.addStakerRewards{value: 1 ether}(id, true, 7 days);
    }

    /// @dev Nethermind's observation, verbatim: nothing grants the role, so the
    ///      splitter's payout path reverts.
    function test_unwiredSplitterCannotPay() public {
        assertEq(entity.rewardSplitter(), address(0), "nothing wired after initialize");
        assertFalse(entity.hasRole(entity.REWARD_SPLITTER_ROLE(), splitterA));
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        _pay(splitterA);
    }

    function test_wiringGrantsRoleRecordsAddressAndEnablesPayout() public {
        vm.expectEmit(true, true, false, true, address(entity));
        emit VanaPoolEntityImplementation.RewardSplitterUpdated(address(0), splitterA);
        vm.prank(owner);
        entity.updateRewardSplitter(splitterA);

        assertEq(entity.rewardSplitter(), splitterA, "recorded");
        assertTrue(entity.hasRole(entity.REWARD_SPLITTER_ROLE(), splitterA), "granted");
        uint256 before = entity.entityStakerLockedRewardPool(id);
        _pay(splitterA);
        assertGt(entity.entityStakerLockedRewardPool(id), before, "splitter track funded");
    }

    function test_rotationRevokesThePreviousSplitter() public {
        vm.startPrank(owner);
        entity.updateRewardSplitter(splitterA);
        entity.updateRewardSplitter(splitterB);
        vm.stopPrank();

        assertEq(entity.rewardSplitter(), splitterB);
        assertFalse(entity.hasRole(entity.REWARD_SPLITTER_ROLE(), splitterA), "old splitter revoked");
        assertTrue(entity.hasRole(entity.REWARD_SPLITTER_ROLE(), splitterB), "new splitter granted");
        vm.expectRevert();
        _pay(splitterA);
        _pay(splitterB); // succeeds
    }

    function test_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidAddress.selector);
        entity.updateRewardSplitter(address(0));
    }

    function test_onlyMaintainerCanWire() public {
        vm.prank(stranger);
        vm.expectRevert();
        entity.updateRewardSplitter(splitterA);
    }
}
