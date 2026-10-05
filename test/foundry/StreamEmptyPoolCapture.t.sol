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

/// @notice NM-1052 [Low] "A one wei deposit can capture an entire elapsed reward
///         stream". Reproduces the auditor's PoC end to end on a legacy STREAM
///         entity (the registrant floor keeps new entities from ever being
///         empty, so this state is reachable only for pre-upgrade entities).
///
///         Timestamps are absolute (T0-based). Do NOT warp with inline
///         `block.timestamp + x`: under viaIR the optimizer treats
///         block.timestamp as call-invariant, so a repeated read can go stale
///         across vm.warp and a "later" warp lands on the same instant.
contract StreamEmptyPoolCaptureTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer
    address reg = makeAddr("registrant"); // entity owner
    address attacker = makeAddr("attacker");

    uint256 constant MIN_STAKE = 1; // the finding needs a 1 wei deposit
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant BOND = 7 days;
    uint256 constant STREAM_VALUE = 100 ether;
    uint32 constant STREAM_DURATION = 100 days; // 1 ether / day
    uint256 constant T0 = 1_000_000;

    uint256 constant SLOT_BONDING = 9;
    uint256 constant SLOT_REGISTRANT = 10;
    uint256 constant SLOT_REG_SHARES = 11;

    uint256 id;

    function setUp() public {
        vm.warp(T0);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(address(si),
                abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, MIN_STAKE))))
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
        vm.stopPrank();

        vm.deal(owner, 1_000 ether);
        vm.deal(reg, 1_000 ether);
        vm.deal(attacker, 1 ether);

        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: "stream-entity"}),
            IVanaPoolEntity.RewardModel.STREAM
        );
        id = entity.entitiesCount();

        // Legacy entity: no registration record, so the owner can empty it.
        assertEq(uint256(vm.load(address(staking), bytes32(SLOT_BONDING))), BOND, "slot map");
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REGISTRANT)), bytes32(0));
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REG_SHARES)), bytes32(0));
    }

    function _value(address who) internal view returns (uint256) {
        return (staking.stakerEntities(who, id).shares * entity.entityShareToVana(id)) / 1e18;
    }

    /// @dev At T0: schedule a 100-day stream starting at T0+1, then have the
    ///      owner exit in the same block, so the pool holds a live schedule
    ///      and zero shares before anything has vested.
    function _emptyPoolWithLiveStream() internal {
        vm.prank(reg);
        entity.distributeRewards{value: STREAM_VALUE}(id, STREAM_VALUE, uint64(T0 + 1), STREAM_DURATION);

        uint256 seed = staking.stakerEntities(reg, id).shares;
        vm.prank(reg);
        staking.unstake(id, seed, 0);
        assertEq(entity.entities(id).totalShares, 0, "pool is empty");
        assertEq(entity.entities(id).lockedRewardPool, STREAM_VALUE, "stream fully escrowed");
    }

    function test_oneWeiDepositDoesNotCaptureTheElapsedStream() public {
        _emptyPoolWithLiveStream();

        // 50 days elapse with nobody staked: 50 ether of the stream "matures".
        vm.warp(T0 + 50 days);

        // The finding: a 1 wei deposit bootstraps the empty pool at 1:1, so it
        // mints exactly one share and the depositor is the sole holder.
        vm.prank(attacker);
        staking.stake{value: 1}(id, attacker, 0);
        assertEq(staking.stakerEntities(attacker, id).shares, 1, "one share");

        // Settle one second later (same-block settlement is a no-op).
        vm.warp(T0 + 50 days + 1);
        entity.processRewards(id);

        // Before the fix the preserved 50-day interval vested to that single
        // share and the attacker's 1 wei was worth ~50 ether. After it, only
        // the one second since the deposit vests.
        uint256 captured = _value(attacker);
        assertGt(captured, 1, "time advanced: one second of the stream vested");
        assertLt(captured, 0.001 ether, "1 wei must not capture the backlog");

        // The backlog was not burned: it stays in the locked pool as residue.
        assertGe(entity.entities(id).lockedRewardPool, 49 ether, "elapsed portion retained as residue");
    }

    function test_streamKeepsVestingLinearlyAfterTheEmptyInterval() public {
        _emptyPoolWithLiveStream();
        vm.warp(T0 + 50 days);

        vm.prank(attacker);
        staking.stake{value: 1}(id, attacker, 0);

        // From here the stream must vest at its normal rate to the holder: the
        // watermark advanced (and nothing underflowed) while the pool sat empty.
        vm.warp(T0 + 51 days);
        entity.processRewards(id);
        uint256 dayOne = _value(attacker);
        assertApproxEqRel(dayOne, 1 ether, 1e12, "~1 ether/day vests going forward");

        vm.warp(T0 + 52 days);
        entity.processRewards(id);
        assertApproxEqRel(_value(attacker) - dayOne, 1 ether, 1e12, "linear, not a lump");
    }

    /// @dev The elapsed portion is retained, not burned: after the empty
    ///      interval the owner can put the ENTIRE locked balance back on a
    ///      schedule with no new funds, and it then vests out completely.
    function test_ownerCanRescheduleTheRetainedResidue() public {
        _emptyPoolWithLiveStream();
        vm.warp(T0 + 50 days);

        // Settling while empty moves the elapsed 50 ether out of the committed
        // stream and into unscheduled residue; the locked balance is unchanged.
        entity.processRewards(id);
        uint256 locked = entity.entities(id).lockedRewardPool;
        assertEq(locked, STREAM_VALUE, "nothing left the locked pool");
        assertGe(locked - entity.committedRewards(id), 49 ether, "~50 ether of residue");

        // Re-schedule everything that is locked (msg.value optional: the
        // residue backs the amount). A start before the live entry's end
        // replaces it, so the whole balance is now one fresh 10-day schedule.
        vm.prank(reg);
        entity.distributeRewards{value: 0}(id, locked, uint64(T0 + 50 days + 1), 10 days);
        assertEq(entity.committedRewards(id), locked, "every retained wei is scheduled again");

        // And it all reaches the next holder: nothing is stranded.
        vm.prank(attacker);
        staking.stake{value: 1}(id, attacker, 0);
        vm.warp(T0 + 61 days);
        entity.processRewards(id);
        assertEq(entity.entities(id).lockedRewardPool, 0, "fully vested out");
        assertEq(_value(attacker), locked + 1, "holder received the whole retained balance");
    }
}
