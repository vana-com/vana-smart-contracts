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

/// @notice NM-1052 [Medium] "Rounding dust left by the final unstake disables an
///         entity". The last holder's exit is computed through floor divisions,
///         so when the share supply does not divide the pool a wei is stranded
///         while totalShares reaches zero. Before the fix vanaToEntityShare
///         branched on the pool size, quoted 0 for that state, every stake
///         minted zero shares and reverted, and the entity was dead with its
///         lockedRewardPool stranded. Both conversions now key the empty entity
///         on the share supply and quote the 1:1 bootstrap price. Reachable only
///         for legacy entities (no registration floor). Absolute T0 timestamps.
contract DustBootstrapTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address reg = makeAddr("registrant");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address other = makeAddr("other");

    uint256 constant T0 = 1_000_000;
    uint256 constant BOND = 7 days;
    uint256 constant IRREGULAR = 12345678901234567;
    uint256 constant ONE = 1e18;
    uint256 constant SLOT_BONDING = 9;
    uint256 constant SLOT_REGISTRANT = 10;
    uint256 constant SLOT_REG_SHARES = 11;

    uint256 a; // the entity that will be emptied
    uint256 b; // a second entity, source for a redelegate-in

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
        vm.deal(owner, 1_000 ether); vm.deal(reg, 1_000 ether); vm.deal(alice, 1_000 ether); vm.deal(bob, 1_000 ether); vm.deal(other, 1_000 ether);

        a = _createEntity("pool-a");
        b = _createEntity("pool-b");
        // legacy entity: no registration record, so the registrant can fully exit
        assertEq(uint256(vm.load(address(staking), bytes32(SLOT_BONDING))), BOND, "slot map");
        vm.store(address(staking), keccak256(abi.encode(a, SLOT_REGISTRANT)), bytes32(0));
        vm.store(address(staking), keccak256(abi.encode(a, SLOT_REG_SHARES)), bytes32(0));
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: 1 ether}(IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: name}));
        id = entity.entitiesCount();
    }

    function _solvent() internal view {
        uint256 owed;
        for (uint256 i = 1; i <= entity.entitiesCount(); i++) {
            IVanaPoolEntity.EntityInfo memory e = entity.entities(i);
            owed += e.activeRewardPool + e.lockedRewardPool + entity.entityAccruedCommission(i) + entity.entityStakerLockedRewardPool(i);
        }
        assertGe(address(treasury).balance, owed, "treasury covers all booked pools");
    }

    /// @dev Reach the auditor's state: every holder exits, floors strand dust,
    ///      totalShares == 0 while activeRewardPool > 0.
    function _emptyWithStrandedDust() internal returns (uint256 dust) {
        vm.prank(alice);
        staking.stake{value: 2 ether}(a, alice, 0); // 3e18 shares against 3e18 wei
        // an irregular drip makes the share supply not divide the pool
        vm.prank(other);
        entity.addRewards{value: IRREGULAR}(a);
        vm.warp(T0 + 365 days); // past the bond, drip fully consumed
        entity.processRewards(a);
        assertEq(entity.entities(a).lockedRewardPool, 0);

        uint256 regShares = staking.stakerEntities(reg, a).shares;
        uint256 aliceShares = staking.stakerEntities(alice, a).shares;
        vm.prank(reg);
        staking.unstake(a, regShares, 0);
        vm.prank(alice);
        staking.unstake(a, aliceShares, 0);

        IVanaPoolEntity.EntityInfo memory e = entity.entities(a);
        assertEq(e.totalShares, 0, "no shares outstanding");
        dust = e.activeRewardPool;
        assertGt(dust, 0, "the final exit stranded rounding dust");
        assertLt(dust, 10, "only dust");
    }

    function test_emptyEntityWithDustQuotesTheBootstrapPrice() public {
        _emptyWithStrandedDust();
        // Both conversions agree on "empty == no shares" and quote 1:1.
        assertEq(entity.entityShareToVana(a), ONE, "share -> VANA bootstrap");
        assertEq(entity.vanaToEntityShare(a), ONE, "VANA -> share bootstrap (was 0 before the fix)");
        assertEq(entity.vanaToShares(a, 5 ether), 5 ether, "single-division mint is 1:1");
    }

    function test_stakeIntoDustEntitySucceedsAndRevivesIt() public {
        uint256 dust = _emptyWithStrandedDust();
        // Before the fix: zero shares issued -> InsufficientStakeAmount, forever.
        vm.prank(bob);
        staking.stake{value: 5 ether}(a, bob, 0);
        assertEq(staking.stakerEntities(bob, a).shares, 5 ether, "minted 1:1");
        // the stranded dust is simply absorbed by the reviving deposit
        IVanaPoolEntity.EntityInfo memory e = entity.entities(a);
        assertEq(e.totalShares, 5 ether);
        assertEq(e.activeRewardPool, 5 ether + dust);
        _solvent();
    }

    function test_redelegateIntoDustEntitySucceeds() public {
        _emptyWithStrandedDust();
        vm.prank(bob);
        staking.stake{value: 5 ether}(b, bob, 0);
        vm.warp(T0 + 365 days + BOND + 1);
        uint256 shares = staking.stakerEntities(bob, b).shares; // read before pranking
        // Before the fix the destination minted zero shares and the slippage
        // check reverted, so the share supply could never become non-zero again.
        vm.prank(bob);
        staking.redelegate(b, a, shares, 1);
        assertGt(staking.stakerEntities(bob, a).shares, 0, "destination revived by redelegation");
        _solvent();
    }

    function test_lockedRewardsAreNotStrandedByTheDustState() public {
        _emptyWithStrandedDust();
        // rewards routed to the empty entity (e.g. a splitter round) stay reachable
        vm.prank(other);
        entity.addRewards{value: 10 ether}(a);
        vm.prank(bob);
        staking.stake{value: 5 ether}(a, bob, 0);
        vm.warp(T0 + 365 days + 30 days);
        entity.processRewards(a);
        assertLt(entity.entities(a).lockedRewardPool, 10 ether, "the drip vests to the reviving holder");
        _solvent();
    }
}
