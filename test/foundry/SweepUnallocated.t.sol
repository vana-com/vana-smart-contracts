// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {
    VanaPoolStakingImplementation
} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {
    VanaPoolEntityImplementation
} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {
    VanaPoolTreasuryImplementation
} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @notice Sweeping an APY entity's unallocated reward reserve behind a
///         one-way time-lock, without touching staker-owned funds.
contract SweepUnallocatedTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // admin + maintainer
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");
    address stranger = makeAddr("stranger");
    address recipient = makeAddr("recipient");
    address custody = makeAddr("custody");
    address splitter = makeAddr("splitter");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(
                    address(si),
                    abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, MIN_STAKE))
                ))
        );
        entity = VanaPoolEntityImplementation(
            payable(new VanaPoolEntityProxy(
                    address(ei),
                    abi.encodeCall(
                        VanaPoolEntityImplementation.initialize,
                        (owner, address(staking), MIN_REG_STAKE, MAX_APY_DEFAULT)
                    )
                ))
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(new VanaPoolTreasuryProxy(
                    address(ti), abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))
                ))
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        // the entity pulls VANA from the treasury for the sweep (as it does for commission)
        treasury.updateVanaPoolEntity(address(entity));
        vm.stopPrank();

        vm.deal(owner, 10_000 ether);
        vm.deal(staker, 10_000 ether);
    }

    /// @dev Create an APY entity and fund its locked reserve with `reward`.
    function _apyEntityWithReserve(uint256 reward) internal returns (uint256 id) {
        return _apyEntityWithReserveNamed(reward, "sweep-pool");
    }

    function _apyEntityWithReserveNamed(uint256 reward, string memory name) internal returns (uint256 id) {
        vm.startPrank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: name})
        );
        id = entity.entitiesCount();
        entity.addRewards{value: reward}(id); // funds lockedRewardPool
        vm.stopPrank();
    }

    function _locked(uint256 id) internal view returns (uint256) {
        return entity.entities(id).lockedRewardPool;
    }

    // ---- time-lock guards ----

    function test_sweepDisabledUntilArmed() public {
        uint256 id = _apyEntityWithReserve(100 ether);
        assertEq(entity.entitySweepableAfter(id), 0, "disabled by default");

        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.SweepNotUnlocked.selector);
        entity.sweepUnallocatedRewards(id, payable(recipient));
    }

    function test_sweepBlockedBeforeUnlock() public {
        uint256 id = _apyEntityWithReserve(100 ether);
        uint256 unlockAt = block.timestamp + 30 days;

        vm.prank(owner);
        entity.updateEntitySweepableAfter(id, unlockAt);

        // one second early
        vm.warp(unlockAt - 1);
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.SweepNotUnlocked.selector);
        entity.sweepUnallocatedRewards(id, payable(recipient));
    }

    function test_sweepableAfterOnlyMovesLater() public {
        uint256 id = _apyEntityWithReserve(100 ether);
        uint256 unlockAt = block.timestamp + 30 days;

        vm.startPrank(owner);
        entity.updateEntitySweepableAfter(id, unlockAt);

        // cannot pull earlier
        vm.expectRevert(VanaPoolEntityImplementation.InvalidSweepTime.selector);
        entity.updateEntitySweepableAfter(id, unlockAt - 1 days);

        // cannot set to the past
        vm.expectRevert(VanaPoolEntityImplementation.InvalidSweepTime.selector);
        entity.updateEntitySweepableAfter(id, block.timestamp);

        // can push later
        entity.updateEntitySweepableAfter(id, unlockAt + 10 days);
        assertEq(entity.entitySweepableAfter(id), unlockAt + 10 days, "pushed out");
        vm.stopPrank();
    }

    // ---- the sweep ----

    function test_sweepReclaimsReserveNotStakerFunds() public {
        uint256 id = _apyEntityWithReserve(100 ether);

        // a staker joins; their principal lives in activeRewardPool
        vm.prank(staker);
        staking.stake{value: 100 ether}(id, staker, 0);
        uint256 activeBefore = entity.entities(id).activeRewardPool;

        uint256 unlockAt = block.timestamp + 30 days;
        vm.prank(owner);
        entity.updateEntitySweepableAfter(id, unlockAt);

        vm.warp(unlockAt + 1);
        uint256 recipientBefore = recipient.balance;
        uint256 treasuryBefore = address(treasury).balance;

        vm.prank(owner);
        entity.sweepUnallocatedRewards(id, payable(recipient));

        // locked reserve reclaimed to recipient; treasury drops by the same
        assertEq(_locked(id), 0, "locked reserve emptied");
        uint256 swept = recipient.balance - recipientBefore;
        assertGt(swept, 0, "recipient received VANA");
        assertEq(treasuryBefore - address(treasury).balance, swept, "treasury debited exactly the swept amount");

        // stakers untouched: active pool only grew (final drip settled), never shrank
        assertGe(entity.entities(id).activeRewardPool, activeBefore, "staker-backing pool not reduced");
    }

    function test_sweepSettlesDripFirst_stakerKeepsEarned() public {
        uint256 id = _apyEntityWithReserve(100 ether);

        vm.prank(staker);
        staking.stake{value: 100 ether}(id, staker, 0);
        uint256 balBefore = staker.balance;

        uint256 unlockAt = block.timestamp + 30 days;
        vm.prank(owner);
        entity.updateEntitySweepableAfter(id, unlockAt);

        // 30 days of APY accrue, then sweep the remainder
        vm.warp(unlockAt + 1);
        vm.prank(owner);
        entity.sweepUnallocatedRewards(id, payable(recipient));

        // the staker still withdraws MORE than principal: the pre-sweep drip was credited
        uint256 shares = staking.stakerEntities(staker, id).shares;
        vm.prank(staker);
        staking.unstake(id, shares, 0);
        assertGt(
            int256(staker.balance) - int256(balBefore), int256(0), "staker kept the rewards earned before the sweep"
        );
    }

    function test_sweepAndSeedThreeDestinationsEqually() public {
        uint256 sourceId = _apyEntityWithReserve(100 ether + 2 wei);
        uint256[3] memory destinationIds = [
            _apyEntityWithReserveNamed(1 wei, "basalt-seed"),
            _apyEntityWithReserveNamed(1 wei, "quartz-seed"),
            _apyEntityWithReserveNamed(1 wei, "obsidian-seed")
        ];
        vm.prank(owner);
        entity.updateRewardSplitter(splitter);

        vm.prank(staker);
        staking.stake{value: 100 ether}(sourceId, staker, 0);
        uint256 splitterBalanceBefore = splitter.balance;

        uint256 unlockAt = block.timestamp + 30 days;
        vm.prank(owner);
        entity.updateEntitySweepableAfter(sourceId, unlockAt);
        vm.warp(unlockAt);

        uint256 sourceSharesAtCutoff = staking.stakerEntities(staker, sourceId).shares;
        IVanaPoolEntity.EntityInfo memory sourceAtCutoff = entity.entities(sourceId);
        uint256 expectedSourceActive = entity.previewActiveRewardPool(sourceId);
        uint256 expectedSourcePosition = (sourceSharesAtCutoff * expectedSourceActive) / sourceAtCutoff.totalShares;
        uint256 custodyBeforeSweep = custody.balance;
        vm.prank(owner);
        entity.sweepUnallocatedRewards(sourceId, payable(custody));
        uint256 sweptAmount = custody.balance - custodyBeforeSweep;
        uint256 creditPerPool = sweptAmount / 3;
        uint256 remainder = sweptAmount % 3;
        IVanaPoolEntity.EntityInfo memory sourceAfterSweep = entity.entities(sourceId);
        assertGt(sweptAmount, 0, "sweep transferred the remaining reserve");
        assertEq(sourceAfterSweep.lockedRewardPool, 0, "source locked reserve swept");
        assertEq(sourceAfterSweep.totalShares, sourceAtCutoff.totalShares, "source total shares unchanged");
        assertEq(
            staking.stakerEntities(staker, sourceId).shares, sourceSharesAtCutoff, "source staker shares unchanged"
        );
        assertEq(sourceAfterSweep.activeRewardPool, expectedSourceActive, "source settled to cutoff preview");
        assertEq(
            (sourceSharesAtCutoff * sourceAfterSweep.activeRewardPool) / sourceAfterSweep.totalShares,
            expectedSourcePosition,
            "source staker position equals cutoff-settled value"
        );

        for (uint256 i = 0; i < destinationIds.length; i++) {
            uint256 lockedBefore = entity.entities(destinationIds[i]).lockedRewardPool;
            vm.prank(custody);
            entity.addRewards{value: creditPerPool}(destinationIds[i]);
            assertEq(
                entity.entities(destinationIds[i]).lockedRewardPool - lockedBefore,
                creditPerPool,
                "destination received one equal credit"
            );
        }

        assertEq(custody.balance, custodyBeforeSweep + remainder, "only the division remainder stays in custody");
        assertEq(splitter.balance, splitterBalanceBefore, "initial seed did not fund the splitter");
    }

    // ---- model + access guards ----

    function test_sweepRejectedOnStreamEntity() public {
        uint256 id = _apyEntityWithReserve(100 ether);
        uint256 unlockAt = block.timestamp + 30 days;

        vm.startPrank(owner);
        entity.updateEntitySweepableAfter(id, unlockAt);
        entity.switchToStreamModel(id, uint64(block.timestamp), 60 days); // rolls reserve into a stream
        vm.stopPrank();

        vm.warp(unlockAt + 1);
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidRewardModel.selector);
        entity.sweepUnallocatedRewards(id, payable(recipient));
    }

    function test_onlyMaintainerCanArmAndSweep() public {
        uint256 id = _apyEntityWithReserve(100 ether);

        vm.prank(stranger);
        vm.expectRevert();
        entity.updateEntitySweepableAfter(id, block.timestamp + 30 days);

        vm.prank(owner);
        entity.updateEntitySweepableAfter(id, block.timestamp + 30 days);
        vm.warp(block.timestamp + 30 days + 1);

        vm.prank(stranger);
        vm.expectRevert();
        entity.sweepUnallocatedRewards(id, payable(recipient));
    }
}
