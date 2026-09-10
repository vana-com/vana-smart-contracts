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

contract RedelegationTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");

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

        vm.deal(owner, 100_000 ether);
        vm.deal(staker, 1_000 ether);
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: name})
        );
        id = entity.entitiesCount();
    }

    function _shares(uint256 entityId) internal view returns (uint256) {
        return staking.stakerEntities(staker, entityId).shares;
    }

    function _position(uint256 entityId) internal view returns (uint256 shares, uint256 costBasis, uint256 elig) {
        (shares, costBasis, elig, , ) = _read(entityId);
    }

    function _read(
        uint256 entityId
    ) internal view returns (uint256, uint256, uint256, uint256, uint256) {
        // StakerEntity: shares, costBasis, rewardEligibilityTimestamp, realizedRewards, vestedRewards
        return (
            staking.stakerEntities(staker, entityId).shares,
            staking.stakerEntities(staker, entityId).costBasis,
            staking.stakerEntities(staker, entityId).rewardEligibilityTimestamp,
            0,
            0
        );
    }

    // ---- basic move (no bonding) ----

    function test_redelegate_movesValueNoVanaLeavesTreasury() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");

        // fund A's APY drip so rewards accrue
        vm.prank(owner);
        entity.addRewards{value: 100 ether}(a);

        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0);

        // accrue a year of APY in A -> A share price rises
        vm.warp(block.timestamp + 365 days);
        entity.processRewards(a);
        uint256 aPrice = entity.entityShareToVana(a);
        uint256 movedValue = (_shares(a) * aPrice) / 1e18; // full value incl. rewards
        assertGt(movedValue, STAKE, "A position worth more than principal after rewards");

        uint256 treasuryBefore = address(treasury).balance;
        uint256 stakerBalBefore = staker.balance;

        uint256 moveShares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, moveShares, 0);

        // A emptied, B holds a position worth ~movedValue
        assertEq(_shares(a), 0, "A position moved out");
        assertGt(_shares(b), 0, "B position created");
        uint256 bValue = (_shares(b) * entity.entityShareToVana(b)) / 1e18;
        assertApproxEqAbs(bValue, movedValue, 1e6, "full value carried to B");

        // no VANA left the treasury, none reached the staker
        assertEq(address(treasury).balance, treasuryBefore, "treasury unchanged (pure accounting)");
        assertEq(staker.balance, stakerBalBefore, "staker received no payout");
    }

    // ---- bond carries; rewards kept only if the carried bond is served ----

    function test_redelegate_midBond_carriesBondAndRewards() public {
        vm.prank(owner);
        staking.updateBondingPeriod(30 days);

        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");

        vm.prank(owner);
        entity.addRewards{value: 100 ether}(a);

        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0); // A eligibility = now + 30 days

        // 10 days in: still bonding (20 left), A has accrued some rewards
        vm.warp(block.timestamp + 10 days);
        entity.processRewards(a);

        uint256 moveShares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, moveShares, 0);

        // B inherits the remaining ~20-day bond (not a fresh 30)
        (, , uint256 bElig) = _position(b);
        assertApproxEqAbs(bElig, block.timestamp + 20 days, 2, "carried remaining bond, not reset");

        // B cost basis is the principal only (reward portion rides above it)
        (, uint256 bCost, ) = _position(b);
        assertApproxEqAbs(bCost, STAKE, 1e6, "principal carried as cost basis");
        uint256 bValue = (_shares(b) * entity.entityShareToVana(b)) / 1e18;
        assertGt(bValue, bCost, "reward portion is unrealized gain above cost basis");
    }

    function test_redelegate_completeBondInB_keepsRewards() public {
        vm.prank(owner);
        staking.updateBondingPeriod(30 days);

        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(owner);
        entity.addRewards{value: 100 ether}(a);

        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0);

        vm.warp(block.timestamp + 10 days);
        entity.processRewards(a);
        uint256 moveShares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, moveShares, 0);

        // serve the remaining carried bond in B, then exit
        vm.warp(block.timestamp + 21 days); // past the carried ~20-day bond
        uint256 s = _shares(b);
        vm.prank(staker);
        staking.unstake(b, s, 0);

        // net positive: the A rewards were kept (bond completed), not forfeited
        assertGt(int256(staker.balance) - int256(balBefore), 0, "kept rewards after serving the carried bond");
    }

    function test_redelegate_earlyExitFromB_forfeitsRewardPortion() public {
        vm.prank(owner);
        staking.updateBondingPeriod(30 days);

        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(owner);
        entity.addRewards{value: 100 ether}(a);

        uint256 balBefore = staker.balance;
        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0);

        vm.warp(block.timestamp + 10 days);
        entity.processRewards(a);
        uint256 moveShares = _shares(a);
        vm.prank(staker);
        staking.redelegate(a, b, moveShares, 0);

        // exit B DURING the carried bond -> principal only, reward portion forfeited
        uint256 s = _shares(b);
        vm.prank(staker);
        staking.unstake(b, s, 0);

        // got back ~principal (STAKE), no more: rewards forfeited exactly as in A
        assertApproxEqAbs(int256(staker.balance) - int256(balBefore), int256(0), 1e12, "principal only on early exit");
    }

    // ---- guards ----

    function test_redelegate_rejectsSameEntity() public {
        uint256 a = _createEntity("pool-a");
        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0);

        uint256 s = _shares(a);
        vm.prank(staker);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidEntity.selector);
        staking.redelegate(a, a, s, 0);
    }

    function test_redelegate_rejectsMoreThanOwned() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(staker);
        staking.stake{value: STAKE}(a, staker, 0);

        uint256 s = _shares(a);
        vm.prank(staker);
        vm.expectRevert(VanaPoolStakingImplementation.InvalidAmount.selector);
        staking.redelegate(a, b, s + 1, 0);
    }
}
