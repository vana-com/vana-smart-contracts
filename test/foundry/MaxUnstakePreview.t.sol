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

/// @notice NM-1052 [Low] "The maximum unstake view simulates only the APY reward
///         model". getMaxUnstakeAmount must quote exactly what an unstake pays,
///         for either reward model and with commission. Absolute (T0-based)
///         timestamps: inline block.timestamp warps go stale under viaIR.
contract MaxUnstakePreviewTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer
    address reg = makeAddr("registrant"); // entity owner
    address alice = makeAddr("alice"); // plain staker

    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant BOND = 7 days;
    uint256 constant COMMISSION = 10e18; // 10%
    uint256 constant T0 = 1_000_000;

    uint256 apy;
    uint256 str;

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
                abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), MIN_REG_STAKE, 6e18))))
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(new VanaPoolTreasuryProxy(address(ti),
                abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))))
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(BOND);
        treasury.updateVanaPoolEntity(address(entity));
        vm.stopPrank();

        vm.deal(owner, 10_000 ether);
        vm.deal(reg, 10_000 ether);
        vm.deal(alice, 10_000 ether);

        apy = _createEntity("apy-entity", IVanaPoolEntity.RewardModel.APY);
        str = _createEntity("stream-entity", IVanaPoolEntity.RewardModel.STREAM);
        _setCommission(apy, COMMISSION);
        _setCommission(str, COMMISSION);
    }

    function _createEntity(string memory name, IVanaPoolEntity.RewardModel model) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: name}),
            model
        );
        id = entity.entitiesCount();
    }

    /// @dev Commission increases are two-phase: owner proposes, maintainer approves.
    function _setCommission(uint256 id, uint256 rate) internal {
        vm.prank(reg);
        entity.proposeCommissionRate(id, rate);
        vm.prank(owner);
        entity.approveCommissionRate(id);
    }

    /// @dev Quote alice's full exit, then perform it, and return both amounts.
    function _quoteThenUnstakeAll(uint256 id) internal returns (uint256 quoted, uint256 paid, uint256 factor) {
        uint256 shares = staking.stakerEntities(alice, id).shares;
        (uint256 maxVana, uint256 maxShares, uint256 lf, bool bonding) = staking.getMaxUnstakeAmount(alice, id);
        assertFalse(bonding, "past the bond");
        assertEq(maxShares, shares, "full position quoted");
        quoted = maxVana;
        factor = lf;

        uint256 before = alice.balance;
        vm.prank(alice);
        staking.unstake(id, shares, 0);
        paid = alice.balance - before;
    }

    function test_quoteMatchesPayout_streamEntityWithCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        // 100 ether streamed over 100 days from T0+1: ~1 ether/day
        vm.prank(reg);
        entity.distributeRewards{value: 100 ether}(str, 100 ether, uint64(T0 + 1), 100 days);

        // Past the bond with ~8 days of stream unsettled. Before the fix the view
        // ran the APY formula on this STREAM entity and ignored commission.
        vm.warp(T0 + 8 days);
        (uint256 quoted, uint256 paid, uint256 factor) = _quoteThenUnstakeAll(str);
        assertEq(factor, 0, "limited by the position itself");
        assertGt(paid, 106 ether, "the stream really vested (~8 days, 10% commission skimmed)");
        assertEq(quoted, paid, "quote == payout (STREAM + commission)");
    }

    function test_quoteMatchesPayout_apyEntityWithCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(reg);
        entity.addRewards{value: 100 ether}(apy);
        // crank the drip so the commission skim is not lost in dust
        vm.prank(owner);
        entity.updateEntityMaxAPY(apy, 100e18);

        // Before the fix the view credited the whole yield with no commission
        // deduction, so it overstated the payout.
        vm.warp(T0 + 8 days);
        (uint256 quoted, uint256 paid, uint256 factor) = _quoteThenUnstakeAll(apy);
        assertEq(factor, 0, "limited by the position itself");
        assertGt(paid, 101 ether, "the drip really vested");
        assertEq(quoted, paid, "quote == payout (APY + commission)");
    }
    // ---- previewActiveRewardPool == activeRewardPool right after processRewards ----

    function _assertPreviewMatchesSettlement(uint256 id) internal {
        uint256 previewed = entity.previewActiveRewardPool(id);
        entity.processRewards(id);
        assertEq(previewed, entity.entities(id).activeRewardPool, "preview == settled activeRewardPool");
    }

    function test_previewMatchesSettlement_apyWithCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(reg);
        entity.addRewards{value: 100 ether}(apy);
        vm.warp(T0 + 3 days);
        _assertPreviewMatchesSettlement(apy);
    }

    function test_previewMatchesSettlement_streamWithCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        vm.prank(reg);
        entity.distributeRewards{value: 100 ether}(str, 100 ether, uint64(T0 + 1), 100 days);
        vm.warp(T0 + 3 days);
        _assertPreviewMatchesSettlement(str);
    }

    /// @dev Both tracks at once: the owner's stream and the splitter's
    ///      owner-proof track vest on independent watermarks.
    function test_previewMatchesSettlement_streamPlusSplitterTrack() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        vm.prank(reg);
        entity.distributeRewards{value: 100 ether}(str, 100 ether, uint64(T0 + 1), 100 days);
        vm.prank(owner);
        entity.updateRewardSplitter(address(this)); // first-class wiring: grants REWARD_SPLITTER_ROLE
        entity.addStakerRewards{value: 50 ether}(str, true, 20 days);
        vm.warp(T0 + 3 days);
        _assertPreviewMatchesSettlement(str);
    }

    /// @dev The active entry has ended and a queued entry is part-way through:
    ///      the preview must include the head _vestStream promotes and vests.
    function test_previewMatchesSettlement_pendingQueuedPromotion() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        vm.startPrank(reg);
        entity.distributeRewards{value: 10 ether}(str, 10 ether, uint64(T0 + 1), 2 days);
        // starts exactly at the active entry's end, so it queues rather than replaces
        entity.distributeRewards{value: 20 ether}(str, 20 ether, uint64(T0 + 1 + 2 days), 10 days);
        vm.stopPrank();
        vm.warp(T0 + 5 days); // active fully elapsed, queued entry ~2 days in
        _assertPreviewMatchesSettlement(str);
    }

    function testFuzz_previewMatchesSettlement(uint32 dt) public {
        dt = uint32(bound(dt, 1, 400 days));
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        vm.startPrank(reg);
        entity.addRewards{value: 100 ether}(apy);
        entity.distributeRewards{value: 100 ether}(str, 100 ether, uint64(T0 + 1), 100 days);
        vm.stopPrank();
        vm.warp(T0 + dt);
        _assertPreviewMatchesSettlement(apy);
        _assertPreviewMatchesSettlement(str);
    }
}
