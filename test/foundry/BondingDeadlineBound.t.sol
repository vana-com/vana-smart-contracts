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

/// @notice NM-1052 [Low] "The computed bonding deadline is bounded by neither the
///         configured period nor its maximum". The value-weighted blends in
///         stake() and redelegate()'s destination wrote an unclamped quotient;
///         the partial-unstake and redelegate-source paths already cap theirs
///         at bondingPeriod. Absolute (T0-based) timestamps throughout.
contract BondingDeadlineBoundTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address reg = makeAddr("registrant");
    address alice = makeAddr("alice");

    uint256 constant T0 = 1_000_000;
    uint256 constant LONG = 30 days;
    uint256 constant SHORT = 7 days;

    uint256 a;
    uint256 b;

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
        staking.updateBondingPeriod(LONG);
        vm.stopPrank();

        vm.deal(owner, 1_000 ether);
        vm.deal(alice, 1_000 ether);

        a = _createEntity("pool-a");
        b = _createEntity("pool-b");
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: 1 ether}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: name}));
        id = entity.entitiesCount();
    }

    function _elig(uint256 id) internal view returns (uint256) {
        return staking.stakerEntities(alice, id).rewardEligibilityTimestamp;
    }

    /// @dev Governance shortens the period while alice still has ~29 days of a
    ///      30-day bond left. A top-up must not write a deadline beyond the
    ///      configured 7 days -- the same cap the unstake path already applies.
    function test_stakeTopUpDeadlineIsBoundedByConfiguredPeriod() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(a, alice, 0);
        assertEq(_elig(a), T0 + LONG, "fresh position bonds for the full period");

        vm.warp(T0 + 1 days);
        vm.prank(owner);
        staking.updateBondingPeriod(SHORT);

        vm.prank(alice);
        staking.stake{value: 1 ether}(a, alice, 0); // blend of 29d remaining and 7d new: ~28.8d

        uint256 elig = _elig(a);
        assertLe(elig, T0 + 1 days + SHORT, "deadline never exceeds the configured period");
        assertEq(elig, T0 + 1 days + SHORT, "clamped exactly to bondingPeriod");
        assertLe(elig - (T0 + 1 days), staking.MAX_BONDING_PERIOD(), "and never the hard ceiling");
    }

    /// @dev Same shape on the redelegate destination: both positions hold ~29
    ///      days of the old bond, so the blend is ~29 days against a 7-day period.
    function test_redelegateDestinationDeadlineIsBoundedByConfiguredPeriod() public {
        vm.startPrank(alice);
        staking.stake{value: 100 ether}(a, alice, 0);
        staking.stake{value: 100 ether}(b, alice, 0);
        vm.stopPrank();

        vm.warp(T0 + 1 days);
        vm.prank(owner);
        staking.updateBondingPeriod(SHORT);

        uint256 bShares = staking.stakerEntities(alice, b).shares; // read before pranking
        vm.prank(alice);
        staking.redelegate(b, a, bShares, 0);

        uint256 elig = _elig(a);
        assertLe(elig, T0 + 1 days + SHORT, "destination deadline never exceeds the configured period");
        assertEq(elig, T0 + 1 days + SHORT, "clamped exactly to bondingPeriod");
    }

    /// @dev Control: with the period unchanged the blend is below the cap and
    ///      must be written untouched -- the clamp is an upper bound only and
    ///      leaves the value-weighted (dilution) behaviour exactly as it is.
    function test_clampIsNoOpBelowTheConfiguredPeriod() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(a, alice, 0);

        vm.warp(T0 + 1 days);
        // no rewards funded, so the share price is exactly 1:1 and the blend is
        // reproducible: (100e18 * 29d + 1e18 * 30d) / 101e18
        uint256 expected = (100 ether * (LONG - 1 days) + 1 ether * LONG) / 101 ether;
        assertLt(expected, LONG, "blend is below the period in this case");

        vm.prank(alice);
        staking.stake{value: 1 ether}(a, alice, 0);
        assertEq(_elig(a), T0 + 1 days + expected, "unclamped blend written as-is");
    }
}
