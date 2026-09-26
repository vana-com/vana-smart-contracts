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

/// @notice Blocking new stake into an entity: stake and redelegate-in are
///         rejected while blocked; unstake and redelegate-out stay open so no
///         position is ever trapped.
contract EntityStakeBlockTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // admin + maintainer
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");
    address stranger = makeAddr("stranger");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;
    uint256 constant STAKE = 100 ether;

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

    function _stake(uint256 id, uint256 amount) internal {
        vm.prank(staker);
        staking.stake{value: amount}(id, staker, 0);
    }

    function _shares(uint256 id) internal view returns (uint256) {
        return staking.stakerEntities(staker, id).shares;
    }

    // ---- blocking new stake ----

    function test_blockRejectsNewStaker() public {
        uint256 id = _createEntity("pool");

        vm.prank(entityOwner);
        entity.updateEntityStakingBlocked(id, true);
        assertTrue(entity.entityStakingBlocked(id), "blocked");

        vm.prank(staker);
        vm.expectRevert(VanaPoolStakingImplementation.StakingBlocked.selector);
        staking.stake{value: STAKE}(id, staker, 0);
    }

    function test_blockRejectsExistingStakerTopUp() public {
        uint256 id = _createEntity("pool");
        _stake(id, STAKE); // staker already in before the block

        vm.prank(entityOwner);
        entity.updateEntityStakingBlocked(id, true);

        // an existing staker cannot add more either
        vm.prank(staker);
        vm.expectRevert(VanaPoolStakingImplementation.StakingBlocked.selector);
        staking.stake{value: STAKE}(id, staker, 0);
    }

    // ---- exits stay open while blocked ----

    function test_unstakeStillWorksWhileBlocked() public {
        uint256 id = _createEntity("pool");
        _stake(id, STAKE);

        vm.prank(entityOwner);
        entity.updateEntityStakingBlocked(id, true);

        uint256 balBefore = staker.balance;
        uint256 shares = _shares(id);
        vm.prank(staker);
        staking.unstake(id, shares, 0); // not blocked
        assertGt(staker.balance, balBefore, "unstake returned VANA");
        assertEq(_shares(id), 0, "position fully exited");
    }

    function test_redelegateOutOfBlockedEntityWorks() public {
        uint256 from = _createEntity("from-pool");
        uint256 to = _createEntity("to-pool");
        _stake(from, STAKE);

        vm.prank(entityOwner);
        entity.updateEntityStakingBlocked(from, true); // block the source

        uint256 shares = _shares(from);
        vm.prank(staker);
        staking.redelegate(from, to, shares, 0); // moving OUT is allowed

        assertEq(_shares(from), 0, "left the blocked entity");
        assertGt(_shares(to), 0, "arrived in the open entity");
    }

    function test_redelegateIntoBlockedEntityRejected() public {
        uint256 from = _createEntity("from-pool");
        uint256 to = _createEntity("to-pool");
        _stake(from, STAKE);

        vm.prank(entityOwner);
        entity.updateEntityStakingBlocked(to, true); // block the destination

        uint256 shares = _shares(from);
        vm.prank(staker);
        vm.expectRevert(VanaPoolStakingImplementation.StakingBlocked.selector);
        staking.redelegate(from, to, shares, 0); // moving IN is new stake -> blocked
    }

    // ---- unblock restores staking ----

    function test_unblockRestoresStaking() public {
        uint256 id = _createEntity("pool");

        vm.startPrank(entityOwner);
        entity.updateEntityStakingBlocked(id, true);
        entity.updateEntityStakingBlocked(id, false);
        vm.stopPrank();
        assertFalse(entity.entityStakingBlocked(id), "unblocked");

        _stake(id, STAKE); // succeeds again
        assertGt(_shares(id), 0, "stake accepted after unblock");
    }

    // ---- access control ----

    function test_maintainerCanBlock() public {
        uint256 id = _createEntity("pool");
        vm.prank(owner); // owner holds MAINTAINER_ROLE
        entity.updateEntityStakingBlocked(id, true);
        assertTrue(entity.entityStakingBlocked(id));
    }

    function test_strangerCannotBlock() public {
        uint256 id = _createEntity("pool");
        vm.prank(stranger);
        vm.expectRevert(); // NotEntityOwner
        entity.updateEntityStakingBlocked(id, true);
    }
}
