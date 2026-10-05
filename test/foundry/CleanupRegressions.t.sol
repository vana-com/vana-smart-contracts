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

/// @notice Regressions for the NM-1052 cleanup batch: the staker-list
///         transition after the _removeStaker partial-withdrawal skip, and the
///         updateEntityPool gate after its redundant in-body check was removed.
contract CleanupRegressionsTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address reg = makeAddr("registrant");
    address alice = makeAddr("alice");
    address stranger = makeAddr("stranger");

    uint256 constant T0 = 1_000_000;
    uint256 constant BOND = 7 days;
    uint256 a;

    function setUp() public {
        vm.warp(T0);
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
        staking.updateBondingPeriod(BOND);
        vm.stopPrank();
        vm.deal(owner, 100 ether); vm.deal(alice, 100 ether);
        vm.prank(owner);
        entity.createEntity{value: 1 ether}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "pool-a"}));
        a = entity.entitiesCount();
    }

    /// @dev The scan is skipped on partial withdrawals; the observable list
    ///      behaviour must be unchanged: active while any position survives,
    ///      inactive only on the last full exit.
    function test_partialUnstakeKeepsStakerActive_fullExitDeactivates() public {
        vm.prank(alice);
        staking.stake{value: 10 ether}(a, alice, 0);
        uint256 activeBefore = staking.activeStakersListCount();
        uint256 inactiveBefore = staking.inactiveStakersListCount();
        vm.warp(T0 + BOND + 1);

        uint256 shares = staking.stakerEntities(alice, a).shares;
        vm.prank(alice);
        staking.unstake(a, shares / 2, 0); // partial: position survives
        assertEq(staking.activeStakersListCount(), activeBefore, "still active after a partial withdrawal");
        assertEq(staking.inactiveStakersListCount(), inactiveBefore);

        uint256 rest = staking.stakerEntities(alice, a).shares;
        vm.prank(alice);
        staking.unstake(a, rest, 0); // full exit: last position gone
        assertEq(staking.activeStakersListCount(), activeBefore - 1, "deactivated on the last full exit");
        assertEq(staking.inactiveStakersListCount(), inactiveBefore + 1);
    }

    /// @dev onlyRole(VANA_POOL_ROLE) alone gates updateEntityPool.
    function test_updateEntityPoolStillGatedWithoutTheRedundantCheck() public {
        vm.prank(stranger);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        entity.updateEntityPool(a, 1, 1, true);
    }
}
