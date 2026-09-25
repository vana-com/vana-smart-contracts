// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {
    VanaPoolStakingImplementation
} from "../../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {
    VanaPoolEntityImplementation
} from "../../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {
    VanaPoolTreasuryImplementation
} from "../../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {
    RewardSplitterImplementation
} from "../../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";
import {IVanaPoolEntity} from "../../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";
import {IVanaPoolStaking} from "../../../contracts/vanaStaking/vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

/// @notice End-to-end scenario against the UPGRADED Moksha contracts (real bytecode
///         and state, forked at a pinned pre-cutoff block; nothing is broadcast). Run with:
///           MOKSHA_FORK=1 forge test --match-path test/foundry/fork/MokshaE2E.t.sol -vv
///         Skipped otherwise so the default suite stays network-free.
///
///         Scenario: three new entities at 40% APY with 10% commission; entity 1
///         blocked for new stake; every live staker of entity 1 migrates (redelegate)
///         into the new entities; entity 1's unallocated APY reserve is swept
///         (time-locked) to an address and re-sent by three manual addRewards calls
///         to the new pools; the splitter is funded, burns 10%, and distributes to
///         the new entities; stakers, owners (commission on both tracks) and the
///         burn all receive what the books say; treasury stays solvent throughout.
contract MokshaE2ETest is Test {
    // Moksha (chainId 14800), post-upgrade 2026-09-24
    VanaPoolStakingImplementation constant staking =
        VanaPoolStakingImplementation(payable(0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e));
    VanaPoolEntityImplementation constant entity =
        VanaPoolEntityImplementation(payable(0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30));
    VanaPoolTreasuryImplementation constant treasury =
        VanaPoolTreasuryImplementation(payable(0x143BE72CF2541604A7691933CAccd6D9cC17c003));
    RewardSplitterImplementation constant splitter =
        RewardSplitterImplementation(payable(0x7A7B89b6925A8156b9A51E520327c0701023b344));
    address constant admin = 0x2AC93684679a5bdA03C6160def908CdB8D46792f; // maintainer everywhere, entity-1 owner, splitter distributor
    uint256 constant OLD = 1;

    uint256 constant TARGET_APY = 40e18; // 40%
    uint256 constant COMMISSION = 10e18; // 10%
    uint256 constant BURN_RATE = 10e18; // 10%
    uint256 constant BUDGET = 100 ether; // splitter round budget
    uint256 constant ONE = 1e18;
    uint256 constant MOKSHA_FORK_BLOCK = 9_189_108;
    uint256 constant MOKSHA_FORK_TIMESTAMP = 1_790_293_302;
    uint256 constant SEED_CUTOFF = 1_793_404_800; // 2026-10-31 00:00 UTC

    uint256[3] newIds;
    address[3] owners;

    function setUp() public {
        if (!vm.envOr("MOKSHA_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("MOKSHA_RPC_URL", string("https://rpc.moksha.vana.org")), MOKSHA_FORK_BLOCK);
        console.log("forked Moksha at block", block.number);
        assertEq(block.timestamp, MOKSHA_FORK_TIMESTAMP, "pinned fork timestamp changed");
        assertLt(block.timestamp, SEED_CUTOFF, "pinned fork must precede the seed cutoff");
        // sanity: this is the upgraded system
        assertEq(staking.version(), 4);
        assertEq(entity.version(), 4);
        assertEq(treasury.version(), 2);
        assertEq(entity.rewardSplitter(), address(splitter), "splitter wired");
        owners[0] = makeAddr("owner-alpha");
        owners[1] = makeAddr("owner-bravo");
        owners[2] = makeAddr("owner-charlie");
        vm.deal(admin, 100_000 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _value(address who, uint256 id) internal view returns (uint256) {
        return (staking.stakerEntities(who, id).shares * entity.entityShareToVana(id)) / ONE;
    }

    function _owed() internal view returns (uint256 sum) {
        uint256 n = entity.entitiesCount();
        for (uint256 i = 1; i <= n; i++) {
            IVanaPoolEntity.EntityInfo memory e = entity.entities(i);
            sum += e.activeRewardPool + e.lockedRewardPool + entity.entityAccruedCommission(i)
            + entity.entityStakerLockedRewardPool(i);
        }
    }

    function _assertSolvent(string memory at) internal view {
        assertGe(address(treasury).balance, _owed(), string.concat("treasury covers all books: ", at));
    }

    function _ids() internal view returns (uint256[] memory ids) {
        ids = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = newIds[i];
        }
    }

    // ------------------------------------------------------------------ scenario

    function test_e2e_migrateToNewEntitiesAndDistribute() public {
        _assertSolvent("start");

        // ---- 1. three new entities: 40% APY, 10% commission, APY pool funded ----
        string[3] memory names = ["e2e-basalt", "e2e-quartz", "e2e-obsidian"];
        uint256 reg = entity.minRegistrationStake();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(admin);
            entity.createEntity{value: reg}(
                IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: owners[i], name: names[i]})
            );
            newIds[i] = entity.entitiesCount();
            vm.prank(admin);
            entity.updateEntityMaxAPY(newIds[i], TARGET_APY);
            vm.prank(owners[i]);
            entity.proposeCommissionRate(newIds[i], COMMISSION);
            vm.prank(admin);
            entity.approveCommissionRate(newIds[i]);
            assertEq(entity.entities(newIds[i]).maxAPY, TARGET_APY);
            assertEq(entity.entityCommissionRate(newIds[i]), COMMISSION);
            assertEq(staking.entityRegistrant(newIds[i]), owners[i], "registrant floor recorded at creation");
        }
        console.log("new entities:", newIds[0], newIds[1], newIds[2]);
        _assertSolvent("after entity creation");

        // ---- 2. sweep entity 1's unallocated APY reserve and seed Basalt, Quartz, and Obsidian ----
        address custody = makeAddr("reserve-custody");
        vm.warp(SEED_CUTOFF - 1);
        vm.prank(admin);
        entity.updateEntitySweepableAfter(OLD, SEED_CUTOFF);
        uint256 splitterBeforeSeed = address(splitter).balance;
        uint256 custodyBeforeSweep = custody.balance;
        vm.warp(SEED_CUTOFF);
        uint256 sourceSharesAtCutoff = staking.stakerEntities(admin, OLD).shares;
        IVanaPoolEntity.EntityInfo memory sourceAtCutoff = entity.entities(OLD);
        uint256 expectedSourceActive = entity.previewActiveRewardPool(OLD);
        uint256 expectedSourcePosition = (sourceSharesAtCutoff * expectedSourceActive) / sourceAtCutoff.totalShares;
        vm.prank(admin);
        entity.sweepUnallocatedRewards(OLD, payable(custody));

        uint256 sweptAmount = custody.balance - custodyBeforeSweep;
        uint256 creditPerPool = sweptAmount / 3;
        uint256 remainder = sweptAmount % 3;
        IVanaPoolEntity.EntityInfo memory sourceAfterSweep = entity.entities(OLD);
        assertGt(sweptAmount, 0, "custody received the source reserve");
        assertEq(sourceAfterSweep.lockedRewardPool, 0, "source locked reserve swept");
        assertEq(sourceAfterSweep.totalShares, sourceAtCutoff.totalShares, "source total shares unchanged");
        assertEq(staking.stakerEntities(admin, OLD).shares, sourceSharesAtCutoff, "source registrant shares unchanged");
        assertEq(sourceAfterSweep.activeRewardPool, expectedSourceActive, "source settled to cutoff preview");
        assertEq(
            (sourceSharesAtCutoff * sourceAfterSweep.activeRewardPool) / sourceAfterSweep.totalShares,
            expectedSourcePosition,
            "source registrant position equals cutoff-settled value"
        );

        for (uint256 i = 0; i < 3; i++) {
            uint256 seedLockedBefore = entity.entities(newIds[i]).lockedRewardPool;
            vm.prank(custody);
            entity.addRewards{value: creditPerPool}(newIds[i]);
            assertEq(
                entity.entities(newIds[i]).lockedRewardPool - seedLockedBefore,
                creditPerPool,
                "one equal seed reached each destination"
            );
        }
        assertEq(custody.balance, custodyBeforeSweep + remainder, "division remainder stays in custody");
        assertEq(address(splitter).balance, splitterBeforeSeed, "initial seed did not fund the splitter");
        _assertSolvent("after equal reserve seed");

        // ---- 3. block new stake into the old entity; exits and redelegate-out stay open ----
        vm.prank(admin); // entity-1 owner
        entity.updateEntityStakingBlocked(OLD, true);
        assertTrue(entity.entityStakingBlocked(OLD));
        address newcomer = makeAddr("newcomer");
        vm.deal(newcomer, 10 ether);
        vm.prank(newcomer);
        vm.expectRevert(VanaPoolStakingImplementation.StakingBlocked.selector);
        staking.stake{value: 5 ether}(OLD, newcomer, 0);

        // ---- 4. every live staker of entity 1 migrates into the new entities ----
        address[] memory stakers = staking.activeStakersListValues(0, staking.activeStakersListCount());
        uint256 floorShares = staking.entityRegistrationShares(OLD);
        address registrant = staking.entityRegistrant(OLD);
        uint256 migrated;
        uint256 movedTotal;
        for (uint256 i = 0; i < stakers.length; i++) {
            address s = stakers[i];
            uint256 shares = staking.stakerEntities(s, OLD).shares;
            if (s == registrant) shares = shares > floorShares ? shares - floorShares : 0; // the seed stays
            if (shares == 0) continue;
            uint256 target = newIds[migrated % 3];
            vm.prank(s);
            (uint256 movedValue, uint256 issued) = staking.redelegate(OLD, target, shares, 0);
            assertGt(issued, 0, "shares minted in the destination");
            movedTotal += movedValue;
            migrated++;
        }
        console.log("stakers migrated:", migrated, " total value moved (wei):", movedTotal);
        assertGt(migrated, 1, "the real stakers of entity 1 moved");
        assertEq(entity.entities(OLD).totalShares, floorShares, "only the registrant's floor remains in entity 1");
        _assertSolvent("after migration");

        // ---- 3b. one-time manual move of entity 1's reward reserve to the new pools ----
        // arm the time-locked sweep (maintainer), wait for it, sweep to an address
        address to = makeAddr("sweep-destination");
        uint256 reserveBefore = entity.entities(OLD).lockedRewardPool;
        assertGt(reserveBefore, 0, "entity 1 still holds an unallocated APY reserve");
        vm.prank(admin);
        vm.expectRevert(VanaPoolEntityImplementation.SweepNotUnlocked.selector);
        entity.sweepUnallocatedRewards(OLD, payable(to)); // not armed yet
        uint256 unlockAt = block.timestamp + 1 days;
        vm.prank(admin);
        entity.updateEntitySweepableAfter(OLD, unlockAt);
        vm.warp(unlockAt);
        vm.prank(admin);
        entity.sweepUnallocatedRewards(OLD, payable(to));
        uint256 swept = to.balance;
        assertGt(swept, 0, "reserve swept to the destination");
        assertLe(swept, reserveBefore, "at most the reserve (the drip owed until the sweep is credited first)");
        assertEq(entity.entities(OLD).lockedRewardPool, 0, "entity 1 has no reserve left");
        console.log("swept from entity 1 (wei):", swept);
        _assertSolvent("after sweep");

        // entity 1 pays nothing further: the remaining position (the owner's floor) is flat
        uint256 ownerValueAfterSweep = _value(registrant, OLD);
        vm.warp(block.timestamp + 1 days);
        entity.processRewards(OLD);
        assertEq(_value(registrant, OLD), ownerValueAfterSweep, "no more yield in the swept entity");

        // three manual transactions from the destination: split by pool size (a
        // stand-in for the operator's decision), everything re-sent to the wei
        uint256 sizeTotal;
        for (uint256 i = 0; i < 3; i++) sizeTotal += entity.entities(newIds[i]).activeRewardPool;
        uint256 sent;
        for (uint256 i = 0; i < 3; i++) {
            uint256 amount = i == 2 ? swept - sent : (swept * entity.entities(newIds[i]).activeRewardPool) / sizeTotal;
            uint256 lockedBeforeAdd = entity.entities(newIds[i]).lockedRewardPool;
            vm.prank(to);
            entity.addRewards{value: amount}(newIds[i]);
            assertEq(entity.entities(newIds[i]).lockedRewardPool - lockedBeforeAdd, amount, "booked to the pool's reserve");
            sent += amount;
            console.log("addRewards to entity", newIds[i], "(wei):", amount);
        }
        assertEq(sent, swept, "all of it re-sent");
        assertEq(to.balance, 0, "destination holds nothing afterwards");
        _assertSolvent("after redistribution");

        // snapshot a migrated staker's position in its new entity before any rewards
        address sample = stakers[0] == registrant ? stakers[1] : stakers[0];
        uint256 sampleEntity = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (staking.stakerEntities(sample, newIds[i]).shares > 0) sampleEntity = newIds[i];
        }
        assertGt(sampleEntity, 0, "sample staker landed in a new entity");
        uint256 sampleBefore = _value(sample, sampleEntity);

        // ---- 5. fund the splitter (the admin/deployer wallet), 10% burn, two rounds ----
        (bool ok,) = payable(address(splitter)).call{value: BUDGET}("");
        assertTrue(ok);
        vm.prank(admin);
        splitter.updateBurnRate(BURN_RATE);
        uint256 lockedBefore0 = entity.entityStakerLockedRewardPool(newIds[0]);
        vm.prank(admin);
        splitter.distribute(BUDGET, _ids()); // round 1: baselines only, by design
        assertEq(entity.entityStakerLockedRewardPool(newIds[0]), lockedBefore0, "round 1 pays nothing");
        assertEq(splitter.pendingBurn(), 0, "no burn accrued on a zero-weight round");

        vm.warp(block.timestamp + 3 days); // accrue principal-seconds
        // Settle the 40% APY drip first (it pays 10% commission too), so the
        // deltas below isolate what the SPLITTER round pays: addStakerRewards
        // settles again in the same block, which skims nothing from APY.
        for (uint256 i = 0; i < 3; i++) {
            entity.processRewards(newIds[i]);
        }
        uint256[3] memory lockedBefore;
        uint256[3] memory commBefore;
        for (uint256 i = 0; i < 3; i++) {
            lockedBefore[i] = entity.entityStakerLockedRewardPool(newIds[i]);
            commBefore[i] = entity.entityAccruedCommission(newIds[i]);
        }
        vm.prank(admin);
        splitter.distribute(BUDGET, _ids()); // round 2: pays by principal-seconds since round 1

        uint256 paidToStakers;
        uint256 paidCommission;
        for (uint256 i = 0; i < 3; i++) {
            uint256 dLocked = entity.entityStakerLockedRewardPool(newIds[i]) - lockedBefore[i];
            uint256 dComm = entity.entityAccruedCommission(newIds[i]) - commBefore[i];
            assertGt(dLocked, 0, "new entity received splitter rewards");
            assertGt(dComm, 0, "owner accrued commission");
            // commission is 10% of the entity's payout, skimmed up front
            assertApproxEqAbs(dComm * 9, dLocked, 9, "commission == 10% of the entity's share");
            paidToStakers += dLocked;
            paidCommission += dComm;
            console.log("entity", newIds[i], "stakers' track +", dLocked);
            console.log("   owner commission +", dComm);
        }
        uint256 burn = splitter.pendingBurn();
        assertEq(burn, (BUDGET * BURN_RATE) / splitter.MAX_BURN_RATE(), "burn = 10% of the budget");
        assertApproxEqAbs(paidToStakers + paidCommission + burn, BUDGET, 3, "budget conserved (dust)");
        console.log("burn accrued:", burn);
        _assertSolvent("after distribution");

        // ---- 6. owners claim their commission (entity pays through the treasury: SPENDER_ROLE) ----
        for (uint256 i = 0; i < 3; i++) {
            uint256 accrued = entity.entityAccruedCommission(newIds[i]);
            uint256 before = owners[i].balance;
            vm.prank(owners[i]);
            entity.claimCommission(newIds[i]);
            assertEq(owners[i].balance - before, accrued, "owner received the commission");
            assertEq(entity.entityAccruedCommission(newIds[i]), 0);
        }
        _assertSolvent("after commission claims");

        // ---- 7. rewards reach the stakers: vest the splitter track (7 d) + the 40% APY drip ----
        vm.warp(block.timestamp + 7 days);
        for (uint256 i = 0; i < 3; i++) {
            uint256 apyLockedBefore = entity.entities(newIds[i]).lockedRewardPool;
            uint256 commBeforeDrip = entity.entityAccruedCommission(newIds[i]); // 0: just claimed
            entity.processRewards(newIds[i]);
            assertLt(entity.entityStakerLockedRewardPool(newIds[i]), 1e9, "splitter track fully vested to stakers");
            uint256 dripped = apyLockedBefore - entity.entities(newIds[i]).lockedRewardPool;
            assertGt(dripped, 0, "40% APY drip from the swept reserve vested too");
            // commission is skimmed at vesting time, so the owner earns it on
            // addRewards-funded rewards as well: 10% of what dripped
            uint256 dripComm = entity.entityAccruedCommission(newIds[i]) - commBeforeDrip;
            assertApproxEqAbs(dripComm * 10, dripped, 10, "owner commission == 10% of the APY drip");
            console.log("entity", newIds[i], "APY drip (wei):", dripped);
            console.log("   owner commission on it:", dripComm);
        }
        uint256 sampleAfter = _value(sample, sampleEntity);
        assertGt(sampleAfter, sampleBefore, "a migrated staker's position grew");
        console.log("sample staker value before/after (wei):", sampleBefore, sampleAfter);

        // ---- 8. burn: the reserve leaves the splitter to address(0) ----
        uint256 zeroBefore = address(0).balance;
        splitter.executeBurn();
        assertEq(address(0).balance - zeroBefore, burn, "burned to the zero address");
        assertEq(splitter.pendingBurn(), 0);

        _assertSolvent("end");
    }
}
