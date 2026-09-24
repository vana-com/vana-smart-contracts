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

/// @notice NM-1052 [Low] "The VANA denominated unstake disables the minimum
///         output check". unstakeVana now forwards a caller-supplied
///         vanaAmountMin (as unstake() always did) and reverts on an oversized
///         request instead of silently clamping it. Absolute T0 timestamps.
contract UnstakeVanaMinOutTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address reg = makeAddr("registrant");
    address alice = makeAddr("alice");
    address other = makeAddr("other");

    uint256 constant T0 = 1_000_000;
    uint256 constant BOND = 7 days;
    uint256 constant IRREGULAR = 12345678901234567;
    uint256 constant ONE = 1e18;

    uint256 id;

    function setUp() public {
        vm.warp(T0);
        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(address(si),
                abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1))))
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
        vm.deal(owner, 1_000 ether); vm.deal(alice, 1_000 ether); vm.deal(other, 1_000 ether);

        vm.prank(owner);
        entity.createEntity{value: 1 ether}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "pool-a"}));
        id = entity.entitiesCount();

        // Irregular, stable price (drip fully consumed): every rounding edge is live.
        vm.prank(other);
        entity.addRewards{value: IRREGULAR}(id);
        vm.warp(T0 + 365 days);
        entity.processRewards(id);
        assertEq(entity.entities(id).lockedRewardPool, 0);
    }

    function _stakeEligible() internal {
        vm.prank(alice);
        staking.stake{value: 100 ether}(id, alice, 0);
        vm.warp(T0 + 365 days + BOND + 1);
        entity.processRewards(id);
    }

    function _stakeBonded() internal {
        vm.prank(alice);
        staking.stake{value: 100 ether}(id, alice, 0);
        vm.warp(T0 + 365 days + 1 days);
        entity.processRewards(id);
    }

    function _unstakeVana(uint256 want, uint256 minOut) internal returns (uint256 paid) {
        uint256 before = alice.balance;
        vm.prank(alice);
        staking.unstakeVana(id, want, 0, minOut);
        paid = alice.balance - before;
    }

    // ---- the floor is enforced, and a dust-tolerant floor always holds ----

    function testFuzz_eligible_dustTolerantFloorHolds(uint256 want) public {
        _stakeEligible();
        want = bound(want, 1e15, 50 ether);
        uint256 paid = _unstakeVana(want, want - 2);
        assertGe(paid, want - 2, "floor honoured");
        assertLe(paid, want, "never more than requested");
    }

    function testFuzz_bonded_dustTolerantFloorHolds(uint256 want) public {
        _stakeBonded();
        want = bound(want, 1e15, staking.stakerEntities(alice, id).costBasis / 2);
        uint256 paid = _unstakeVana(want, want - 2);
        assertGe(paid, want - 2, "floor honoured");
        assertLe(paid, want, "never more than requested");
    }

    function test_floorAboveWhatWillBePaidReverts() public {
        _stakeEligible();
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidSlippage.selector);
        staking.unstakeVana(id, 10 ether, 0, 10 ether + 1); // payout <= request < floor
    }

    /// @dev Why the floor must carry tolerance: shares are floored from the
    ///      request and valued by a floored rate, so the payout can be a few
    ///      wei short. Search for a request with a real shortfall on this pool
    ///      and show that `vanaAmount` itself as the floor reverts.
    function test_exactRequestAsFloorRevertsOnRoundingDust() public {
        _stakeEligible();
        IVanaPoolEntity.EntityInfo memory e = entity.entities(id);
        uint256 price = entity.entityShareToVana(id);
        uint256 want = 10 ether;
        for (;;) {
            uint256 sh = (want * e.totalShares) / e.activeRewardPool;
            if ((sh * price) / ONE < want) break; // genuine shortfall found
            want += 1;
        }
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidSlippage.selector);
        staking.unstakeVana(id, want, 0, want);
    }

    // ---- zero skips the floor (documented), and behaves as before ----

    function test_zeroFloorSkipsTheCheck() public {
        _stakeEligible();
        uint256 want = 10 ether;
        uint256 paid = _unstakeVana(want, 0);
        assertGe(paid + 2, want, "within rounding dust of the request");
        assertLe(paid, want);
    }

    // ---- an oversized request reverts instead of being silently clamped ----

    function test_oversizedRequestRevertsEligible() public {
        _stakeEligible();
        uint256 value = (staking.stakerEntities(alice, id).shares * entity.entityShareToVana(id)) / ONE;
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.unstakeVana(id, value + 1 ether, 0, 0); // before: quietly reduced to the whole position
    }

    function test_oversizedRequestRevertsBonded() public {
        _stakeBonded();
        uint256 costBasis = staking.stakerEntities(alice, id).costBasis;
        vm.prank(alice);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.unstakeVana(id, costBasis + 1, 0, 0);
    }
}
