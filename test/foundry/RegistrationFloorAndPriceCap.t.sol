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
import {IVanaPoolStaking} from "../../contracts/vanaStaking/vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

/// @notice Foundry port of PR #82's hardhat coverage for the NM Critical
///         (share rounding): the registrant-bound registration floor, the
///         price-per-share cap that guards legacy entities with no floor
///         record, and the cost-basis / redelegate rounding fixes. Plain
///         single-division issuance is covered in VanaToShares.t.sol.
contract RegistrationFloorAndPriceCapTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer/admin
    address reg = makeAddr("registrant"); // entity owner == registrant
    address other = makeAddr("other"); // plain staker
    address depositor = makeAddr("depositor"); // the finding's victim
    address newOwner = makeAddr("newOwner");

    uint256 constant MIN_STAKE = 1;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;
    uint256 constant BOND = 7 days;
    uint256 constant ONE = 1e18;
    uint256 constant IRREGULAR = 12345678901234567; // drives the price off 1:1

    // VanaPoolStaking storage: 9 bondingPeriod (V2), 10 entityRegistrant,
    // 11 entityRegistrationShares (V3). Proven live in _forgetRegistration.
    uint256 constant SLOT_BONDING = 9;
    uint256 constant SLOT_REGISTRANT = 10;
    uint256 constant SLOT_REG_SHARES = 11;

    uint256 apy; // APY entity, owned by reg
    uint256 str; // STREAM entity, owned by reg (the model the finding needs)
    uint256 regShares;

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
        staking.updateBondingPeriod(BOND);
        vm.stopPrank();

        vm.deal(owner, 1_000_000 ether);
        vm.deal(reg, 1_000_000 ether);
        vm.deal(other, 1_000_000 ether);
        vm.deal(depositor, 1_000_000 ether);

        apy = _createEntity(reg, "apy-entity", IVanaPoolEntity.RewardModel.APY);
        str = _createEntity(reg, "stream-entity", IVanaPoolEntity.RewardModel.STREAM);
        regShares = _shares(reg, apy);
        assertEq(regShares, MIN_REG_STAKE, "seed shares == registration stake");
    }

    // ---------------------------------------------------------------- helpers

    function _createEntity(
        address entOwner,
        string memory name,
        IVanaPoolEntity.RewardModel model
    ) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entOwner, name: name}),
            model
        );
        id = entity.entitiesCount();
    }

    function _shares(address who, uint256 id) internal view returns (uint256) {
        return staking.stakerEntities(who, id).shares;
    }

    function _value(address who, uint256 id) internal view returns (uint256) {
        return (_shares(who, id) * entity.entityShareToVana(id)) / ONE;
    }

    /// @dev Treasury cash must cover every wei the entity books promise.
    function _assertSolvent() internal view {
        uint256 n = entity.entitiesCount();
        uint256 owed;
        for (uint256 i = 1; i <= n; i++) {
            IVanaPoolEntity.EntityInfo memory e = entity.entities(i);
            owed += e.activeRewardPool + e.lockedRewardPool;
            owed += entity.entityAccruedCommission(i);
            owed += entity.entityStakerLockedRewardPool(i);
        }
        assertGe(address(treasury).balance, owed, "treasury covers all booked pools");
    }

    /// @dev Drive an APY entity's price off 1:1 with NO remaining drip, so a
    ///      later processRewards does not move the price under the test.
    function _makeApyPriceIrregular(uint256 id) internal {
        vm.prank(other);
        entity.addRewards{value: IRREGULAR}(id);
        vm.warp(block.timestamp + 365 days);
        entity.processRewards(id);
        assertEq(entity.entities(id).lockedRewardPool, 0, "drip fully consumed");
    }

    /// @dev Owner parks `amount` into a STREAM entity's activeRewardPool without
    ///      minting shares (the finding's step 3): instant-vest and settle.
    function _park(uint256 id, uint256 amount) internal {
        vm.prank(reg);
        entity.distributeRewards{value: amount}(id, amount, uint64(block.timestamp + 1), 0);
        vm.warp(block.timestamp + 1);
        entity.processRewards(id);
    }

    function _makeStreamPriceIrregular(uint256 id) internal {
        _park(id, IRREGULAR);
        assertEq(entity.entities(id).lockedRewardPool, 0, "stream fully vested");
    }

    /// @dev Simulate a pre-upgrade (legacy) entity by clearing its registration
    ///      record. First proves the slot map by reading bondingPeriod at slot 9.
    function _forgetRegistration(uint256 id) internal {
        assertEq(uint256(vm.load(address(staking), bytes32(SLOT_BONDING))), BOND, "slot map: 9 == bondingPeriod");
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REGISTRANT)), bytes32(0));
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REG_SHARES)), bytes32(0));
        assertEq(staking.entityRegistrant(id), address(0), "registrant cleared");
        assertEq(staking.entityRegistrationShares(id), 0, "floor cleared");
    }

    // The two-step formula the finding exploited (rate floored, then scaled),
    // kept only to show the single-division result is never below it.
    function _oldMint(uint256 amount, uint256 S, uint256 P) internal pure returns (uint256) {
        return (((S * ONE) / P) * amount) / ONE;
    }

    function _newMint(uint256 amount, uint256 S, uint256 P) internal pure returns (uint256) {
        return (amount * S) / P;
    }

    // ============================================================ versions

    function test_versionBumpedOnBothContracts() public view {
        assertEq(staking.version(), 4);
        assertEq(entity.version(), 5);
    }

    // ============================ registration floor (removes the dust precondition)

    function test_recordsRegistrantAndSharesAtCreation() public view {
        assertEq(staking.entityRegistrant(apy), reg);
        assertEq(staking.entityRegistrationShares(apy), regShares);
        assertEq(staking.entityRegistrant(str), reg);
        assertEq(staking.entityRegistrationShares(str), regShares);
    }

    /// @dev The finding's step 2 on every exit path. The seed is unbonded from
    ///      birth in the old code and bonded now, but only the floor stops this.
    function test_registrantCannotDrainSeedToDust_onAnyExitPath() public {
        bytes4 sel = VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector;

        vm.startPrank(reg);
        vm.expectRevert(sel);
        staking.unstake(str, regShares - 2000, 0);
        vm.expectRevert(sel);
        staking.unstake(str, regShares, 0);
        vm.expectRevert(sel);
        staking.unstake(str, 1, 0);
        vm.expectRevert(sel);
        staking.unstakeVana(str, 1, 0, 0);
        vm.expectRevert(sel);
        staking.redelegate(str, apy, 1, 0); // redelegate-out was the bypass of the owner-bound check
        vm.stopPrank();

        assertEq(entity.entities(str).totalShares, regShares, "seed untouched");
    }

    function test_registrantWithdrawsEverythingAboveTheFloorAndNothingBelow() public {
        vm.prank(reg);
        staking.stake{value: 2 ether}(str, reg, 0);
        uint256 above = _shares(reg, str) - regShares;
        assertGt(above, 0);

        vm.prank(reg);
        vm.expectRevert(VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector);
        staking.unstake(str, above + 1, 0); // one share too many

        vm.prank(reg);
        staking.unstake(str, above, 0); // exactly the surplus
        assertEq(_shares(reg, str), regShares, "left exactly the floor");
        _assertSolvent();
    }

    function test_floorDoesNotRestrictOtherStakers() public {
        vm.prank(other);
        staking.stake{value: 3 ether}(str, other, 0);
        uint256 s = _shares(other, str);
        vm.prank(other);
        staking.unstake(str, s, 0);
        assertEq(_shares(other, str), 0, "plain staker fully exits");
    }

    /// @dev Ownership transfer was the other bypass of the owner-bound check:
    ///      the ex-owner stopped being "the owner" and pulled the seed. The
    ///      floor is bound to the registrant, so the transfer releases nothing.
    function test_floorStaysWithRegistrantAfterOwnershipTransfer() public {
        vm.prank(reg);
        entity.updateEntity(str, IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: newOwner, name: "stream-entity"}));
        assertEq(entity.entities(str).ownerAddress, newOwner, "ownership moved");

        vm.prank(reg);
        vm.expectRevert(VanaPoolStakingImplementation.CannotRemoveRegistrationStake.selector);
        staking.unstake(str, 1, 0); // ex-owner still holds, and still cannot pull, the seed
    }

    function test_getMaxUnstakeAmountReportsTheFloor() public {
        (uint256 maxVana, uint256 maxShares, uint256 factor, ) = staking.getMaxUnstakeAmount(reg, str);
        assertEq(maxVana, 0, "nothing above the floor yet");
        assertEq(maxShares, 0);
        assertEq(factor, 3, "limitingFactor 3 == registration floor");

        vm.prank(reg);
        staking.stake{value: 2 ether}(str, reg, 0);
        (, uint256 maxShares2, uint256 factor2, ) = staking.getMaxUnstakeAmount(reg, str);
        assertEq(maxShares2, _shares(reg, str) - regShares, "exactly the surplus is burnable");
        assertEq(factor2, 3);
    }

    /// @dev The invariant `minRegistrationStake > 0` is enforced at both
    ///      sources (setter and initializer), so createEntity's single
    ///      `msg.value != minRegistrationStake` check also rules out a
    ///      zero-stake entity with no separate zero clause.
    function test_zeroMinRegistrationStakeIsRejectedAtEverySource() public {
        // setter
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        entity.updateMinRegistrationStake(0);

        // initializer: the contract cannot even be born with 0
        VanaPoolEntityImplementation ei2 = new VanaPoolEntityImplementation();
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        new VanaPoolEntityProxy(
            address(ei2),
            abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), 0, MAX_APY_DEFAULT))
        );

        // and with min > 0 guaranteed, a zero-value registration is refused by
        // the exact-match check alone
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidRegistrationStake.selector);
        entity.createEntity{value: 0}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "no-floor"}),
            IVanaPoolEntity.RewardModel.APY
        );
    }

    // ==================== price-per-share cap (legacy entities with no floor record)

    function test_capRefusesMintOnDustPool_andExistingPositionsStillExit() public {
        _forgetRegistration(str);

        // Step 2 on a legacy entity: nothing stops the owner draining to 1 share.
        vm.prank(reg);
        staking.unstake(str, regShares - 1, 0);
        // Step 3: park 1000 VANA. Price is now ~1000 VANA per share.
        _park(str, 1000 ether);
        IVanaPoolEntity.EntityInfo memory e = entity.entities(str);
        assertGt(e.activeRewardPool, e.totalShares * entity.MAX_ACTIVE_POOL_PER_SHARE(), "over the cap");

        // Steps 4-5 are refused on both mint paths.
        vm.prank(depositor);
        vm.expectRevert(VanaPoolEntityImplementation.SharePriceOutOfRange.selector);
        staking.stake{value: 1999 ether}(str, depositor, 0);

        // A moved value worth several shares at this price reaches the cap
        // (a smaller one already fails on zero shares minted).
        vm.prank(depositor);
        staking.stake{value: 3000 ether}(apy, depositor, 0);
        vm.warp(block.timestamp + BOND);
        uint256 moved = _shares(depositor, apy); // read before pranking: a call in args eats the prank
        vm.prank(depositor);
        vm.expectRevert(VanaPoolEntityImplementation.SharePriceOutOfRange.selector);
        staking.redelegate(apy, str, moved, 0);

        // Positions already inside are not trapped: unstake never checks the
        // cap, so the last share exits and takes the parked balance with it.
        vm.prank(reg);
        staking.unstake(str, 1, 0);
        assertEq(entity.entities(str).totalShares, 0, "pool fully exited");
        _assertSolvent();
    }

    function test_capBoundsDepositorRoundingLossToOneShare() public {
        _forgetRegistration(str);
        // Drain to 2e9 shares, park 1000 VANA: 5e11 wei/share, just under the cap.
        uint256 keep = 2_000_000_000;
        vm.prank(reg);
        staking.unstake(str, regShares - keep, 0);
        _park(str, 1000 ether);
        IVanaPoolEntity.EntityInfo memory e = entity.entities(str);
        assertEq(e.totalShares, keep);
        uint256 pricePerShare = e.activeRewardPool / e.totalShares;
        assertLe(pricePerShare, entity.MAX_ACTIVE_POOL_PER_SHARE(), "still accepted");

        // The finding's 50% regime needs ~2 shares against the park; the cap
        // stops at ~2e9, where the old two-step formula still under-mints on
        // this deposit and the single division does not.
        uint256 seed = 1 ether;
        uint256 big = 1414 ether;
        assertLt(_oldMint(big, e.totalShares, e.activeRewardPool), _newMint(big, e.totalShares, e.activeRewardPool));

        vm.startPrank(depositor);
        staking.stake{value: seed}(str, depositor, 0);
        staking.stake{value: big}(str, depositor, 0);
        vm.stopPrank();
        assertGt(staking.stakerEntities(depositor, str).rewardEligibilityTimestamp, block.timestamp, "bonded");

        // Early exit refunds at most the burned shares' value.
        uint256 pos = _shares(depositor, str);
        uint256 before = depositor.balance;
        vm.prank(depositor);
        staking.unstake(str, pos, 0);
        uint256 refund = depositor.balance - before;
        assertLe(refund, seed + big, "never refunds more than deposited");
        uint256 loss = seed + big - refund;
        // At most two shares of rounding (one per deposit).
        assertLe(loss, 2 * (pricePerShare + 1), "loss bounded by the cap");
        _assertSolvent();

        // The owner's dust position gained only that dust.
        uint256 ownerValue = entity.sharesToVana(str, keep);
        assertLe(ownerValue - (1000 ether + keep), 2 * (pricePerShare + 1), "owner captured only dust");
    }

    // ================================== single-division conversions & cost basis

    function test_sharesToVanaAndVanaToSharesPrice1to1WithNoShares() public view {
        assertEq(entity.vanaToShares(99, 3 ether), 3 ether);
        assertEq(entity.sharesToVana(99, 3 ether), 3 ether);
    }

    function test_redelegateMintsInDestinationBySingleDivision() public {
        _makeApyPriceIrregular(apy);
        _makeStreamPriceIrregular(str);
        IVanaPoolEntity.EntityInfo memory e2 = entity.entities(str);
        IVanaPoolEntity.EntityInfo memory e1 = entity.entities(apy);

        // Pick a stake whose carried value mints a different share count under
        // the old two-step formula. Approximate off-chain, then verify on-chain.
        uint256 x = 3 ether;
        for (;;) {
            uint256 sh = _newMint(x, e2.totalShares, e2.activeRewardPool);
            uint256 v = (sh * (((e2.activeRewardPool + x) * ONE) / (e2.totalShares + sh))) / ONE;
            if (_oldMint(v, e1.totalShares, e1.activeRewardPool) != _newMint(v, e1.totalShares, e1.activeRewardPool)) break;
            x += 1;
        }

        vm.prank(depositor);
        staking.stake{value: x}(str, depositor, 0);
        vm.warp(block.timestamp + BOND);
        uint256 fromShares = _shares(depositor, str);
        IVanaPoolEntity.EntityInfo memory e2b = entity.entities(str);
        uint256 movedValue = (fromShares * ((e2b.activeRewardPool * ONE) / e2b.totalShares)) / ONE;
        uint256 expected = _newMint(movedValue, e1.totalShares, e1.activeRewardPool);
        assertGt(expected, _oldMint(movedValue, e1.totalShares, e1.activeRewardPool), "old formula under-mints here");

        vm.prank(depositor);
        staking.redelegate(str, apy, fromShares, expected); // minSharesOut == the single-division result
        assertEq(_shares(depositor, apy), expected);
        _assertSolvent();
    }

    /// @dev Move str -> apy with no rewards: principal carried == full value,
    ///      while the shares minted in apy are floor()'d and may be worth a
    ///      wei less. The move back then computed movedValue - movedCostBasis
    ///      unchecked and reverted with panic 0x11. Search until the dust case
    ///      actually occurs so the saturation path is exercised unconditionally.
    function test_redelegateDoesNotRevertWhenRoundingLeftPrincipalAWeiAboveValue() public {
        _makeApyPriceIrregular(apy);
        _makeStreamPriceIrregular(str);

        bool found;
        for (uint256 k = 0; k < 200 && !found; k++) {
            uint256 snap = vm.snapshotState();
            vm.prank(depositor);
            staking.stake{value: 3 ether + k}(str, depositor, 0);
            uint256 s2 = _shares(depositor, str);
            vm.prank(depositor);
            staking.redelegate(str, apy, s2, 0);
            IVanaPoolStaking.StakerEntity memory pos1 = staking.stakerEntities(depositor, apy);
            uint256 value1 = (pos1.shares * entity.entityShareToVana(apy)) / ONE;
            if (pos1.costBasis > value1) {
                found = true;
                assertLt(pos1.costBasis - value1, 1000, "only rounding dust");
                vm.prank(depositor);
                staking.redelegate(apy, str, pos1.shares, 0); // must not panic
                _assertSolvent();
            } else {
                vm.revertToState(snap);
            }
        }
        assertTrue(found, "the dust case must actually occur");
    }

    function test_unstakeVanaAfterBondBurnsSingleDivision() public {
        _makeApyPriceIrregular(apy);
        vm.prank(depositor);
        staking.stake{value: 5 ether + 3}(apy, depositor, 0);
        vm.warp(block.timestamp + BOND);
        IVanaPoolEntity.EntityInfo memory e = entity.entities(apy);

        uint256 want = 2 ether;
        while (_oldMint(want, e.totalShares, e.activeRewardPool) == _newMint(want, e.totalShares, e.activeRewardPool)) {
            want += 1;
        }
        uint256 expectedBurn = _newMint(want, e.totalShares, e.activeRewardPool);
        assertGt(expectedBurn, _oldMint(want, e.totalShares, e.activeRewardPool));

        uint256 before = _shares(depositor, apy);
        vm.prank(depositor);
        staking.unstakeVana(apy, want, expectedBurn, 0);
        assertEq(before - _shares(depositor, apy), expectedBurn, "burns floor(vana * S / P)");
    }

    /// @dev A bonded top-up is booked at the value of the shares actually
    ///      minted, not the raw deposit, so cost basis never exceeds position
    ///      value and the payout cap is never the binding constraint.
    function test_bondedTopUpBookedAtMintedShareValue() public {
        _makeApyPriceIrregular(apy);
        uint256 a1 = 1.5 ether + 11;
        uint256 a2 = 0.7 ether + 13;

        vm.prank(depositor);
        staking.stake{value: a1}(apy, depositor, 0);
        uint256 c1 = staking.stakerEntities(depositor, apy).costBasis;
        uint256 sharesBefore = _shares(depositor, apy);

        vm.prank(depositor);
        staking.stake{value: a2}(apy, depositor, 0);
        IVanaPoolStaking.StakerEntity memory pos = staking.stakerEntities(depositor, apy);
        uint256 issued2 = pos.shares - sharesBefore;

        // Reconstruct the price the top-up saw from the post-stake state: a
        // floor()'d mint nudges the price up by dust, so the live price after
        // the stake is not what the contract booked against.
        IVanaPoolEntity.EntityInfo memory e = entity.entities(apy);
        uint256 priceAt = ((e.activeRewardPool - a2) * ONE) / (e.totalShares - issued2);

        assertEq(pos.costBasis, c1 + (issued2 * priceAt) / ONE, "booked at minted-share value");
        assertLe(pos.costBasis, a1 + a2, "never above the raw deposits");
        assertLe(pos.costBasis, _value(depositor, apy), "never above position value");
    }
}
