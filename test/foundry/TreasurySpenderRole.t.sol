// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";

/// @notice transferVana is gated by a narrow SPENDER_ROLE, not DEFAULT_ADMIN, so
///         the staking and entity contracts can pay out (unstakes, commission)
///         without holding admin over the treasury that custodies all principal.
contract TreasurySpenderRoleTest is Test {
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // DEFAULT_ADMIN
    address staking = makeAddr("staking"); // granted SPENDER at init
    address entity = makeAddr("entity"); // granted SPENDER post-deploy
    address recipient = makeAddr("recipient");

    function setUp() public {
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        treasury = VanaPoolTreasuryImplementation(
            payable(
                new VanaPoolTreasuryProxy(
                    address(ti),
                    abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, staking))
                )
            )
        );
        vm.deal(address(treasury), 100 ether);
    }

    function test_stakingHasSpenderNotAdmin() public view {
        assertTrue(treasury.hasRole(treasury.SPENDER_ROLE(), staking), "staking is a spender");
        assertFalse(treasury.hasRole(treasury.DEFAULT_ADMIN_ROLE(), staking), "staking is NOT admin");
        assertTrue(treasury.hasRole(treasury.DEFAULT_ADMIN_ROLE(), owner), "owner is admin");
    }

    function test_spenderCanTransfer() public {
        vm.prank(staking);
        bool ok = treasury.transferVana(payable(recipient), 1 ether);
        assertTrue(ok, "spender transfer succeeds");
        assertEq(recipient.balance, 1 ether);
    }

    function test_nonSpenderCannotTransfer() public {
        // owner holds DEFAULT_ADMIN but not SPENDER
        vm.prank(owner);
        vm.expectRevert();
        treasury.transferVana(payable(recipient), 1 ether);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        treasury.transferVana(payable(recipient), 1 ether);
    }

    function test_adminGrantsSpenderToEntity() public {
        // the commission-claim fix: the entity gets SPENDER and can then pay out
        // (read the role before pranking; an external call in args consumes the prank)
        bytes32 spenderRole = treasury.SPENDER_ROLE();
        vm.prank(owner);
        treasury.grantRole(spenderRole, entity);

        vm.prank(entity);
        assertTrue(treasury.transferVana(payable(recipient), 2 ether));
        assertEq(recipient.balance, 2 ether);
    }

    function test_updateVanaPoolEntityGrantsAndRotates() public {
        // first-class wiring: sets the entity and grants it SPENDER
        vm.prank(owner);
        treasury.updateVanaPoolEntity(entity);
        assertEq(treasury.vanaPoolEntity(), entity, "entity recorded");
        assertTrue(treasury.hasRole(treasury.SPENDER_ROLE(), entity), "entity is a spender");
        vm.prank(entity);
        assertTrue(treasury.transferVana(payable(recipient), 1 ether), "entity can pay out");

        // rotating to a new entity moves the role off the old one
        address newEntity = makeAddr("newEntity");
        vm.prank(owner);
        treasury.updateVanaPoolEntity(newEntity);
        assertFalse(treasury.hasRole(treasury.SPENDER_ROLE(), entity), "old entity lost spender");
        assertTrue(treasury.hasRole(treasury.SPENDER_ROLE(), newEntity), "new entity gained spender");
    }

    function test_updateVanaPoolRotatesSpender() public {
        address newStaking = makeAddr("newStaking");
        vm.prank(owner);
        treasury.updateVanaPool(newStaking);

        assertFalse(treasury.hasRole(treasury.SPENDER_ROLE(), staking), "old staking lost spender");
        assertTrue(treasury.hasRole(treasury.SPENDER_ROLE(), newStaking), "new staking gained spender");
    }
}
