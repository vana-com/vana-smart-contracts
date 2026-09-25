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

    /// @dev wei -> "1234.5678 VANA" for readable logs
    function _vana(uint256 amount) internal pure returns (string memory) {
        uint256 frac = (amount % ONE) / 1e14; // 4 decimals
        string memory f = vm.toString(frac);
        while (bytes(f).length < 4) f = string.concat("0", f);
        return string.concat(vm.toString(amount / ONE), ".", f, " VANA");
    }

    function _step(string memory title) internal pure {
        console.log("");
        console.log(string.concat("==== ", title));
    }

    function _logEntity(string memory label, uint256 id) internal view {
        IVanaPoolEntity.EntityInfo memory e = entity.entities(id);
        console.log(string.concat("  ", label, " entity ", vm.toString(id), ": active ", _vana(e.activeRewardPool), " | locked reserve ", _vana(e.lockedRewardPool), " | splitter track ", _vana(entity.entityStakerLockedRewardPool(id)), " | accrued commission ", _vana(entity.entityAccruedCommission(id))));
    }

    function _ids() internal view returns (uint256[] memory ids) {
        ids = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = newIds[i];
        }
    }

    // ------------------------------------------------------------------ scenario

    function test_e2e_migrateToNewEntitiesAndDistribute() public {
        _step("START: live Moksha state at the pinned block");
        console.log(string.concat("  block ", vm.toString(block.number), " | treasury ", _vana(address(treasury).balance), " | active stakers ", vm.toString(staking.activeStakersListCount())));
        _logEntity("source", OLD);
        _assertSolvent("start");

        // ---- 1. three new entities: 40% APY, 10% commission, APY pool funded ----
        _step("STEP 1: create three new entities (40% APY, 10% commission)");
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
            console.log(string.concat("  entity ", vm.toString(newIds[i]), " '", names[i], "' owner ", vm.toString(owners[i]), " | maxAPY 40% | commission 10% | registration floor ", _vana(staking.entityRegistrationShares(newIds[i])), " (shares)"));
        }
        _assertSolvent("after entity creation");

        // ---- 2. sweep entity 1's unallocated APY reserve and seed Basalt, Quartz, and Obsidian ----
        _step("STEP 2: sweep the source reserve to custody and seed the three pools equally");
        address custody = makeAddr("reserve-custody");
        console.log("  sweep before arming -> reverts SweepNotUnlocked");
        // the sweep is disabled until the maintainer arms the time-lock
        vm.prank(admin);
        vm.expectRevert(VanaPoolEntityImplementation.SweepNotUnlocked.selector);
        entity.sweepUnallocatedRewards(OLD, payable(custody));
        vm.warp(SEED_CUTOFF - 1);
        vm.prank(admin);
        entity.updateEntitySweepableAfter(OLD, SEED_CUTOFF);
        console.log(string.concat("  time-lock armed: sweepable after ", vm.toString(SEED_CUTOFF), " (2026-10-31 00:00 UTC)"));
        _logEntity("source before sweep", OLD);
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
        console.log(string.concat("  swept to custody: ", _vana(sweptAmount), " | per pool: ", _vana(creditPerPool), " | remainder left in custody: ", vm.toString(remainder), " wei"));
        _logEntity("source after sweep", OLD);
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
            console.log(string.concat("  addRewards -> entity ", vm.toString(newIds[i]), ": reserve ", _vana(seedLockedBefore), " -> ", _vana(entity.entities(newIds[i]).lockedRewardPool)));
        }
        console.log(string.concat("  splitter balance unchanged at ", _vana(address(splitter).balance), " | treasury ", _vana(address(treasury).balance)));
        assertEq(custody.balance, custodyBeforeSweep + remainder, "division remainder stays in custody");
        assertEq(address(splitter).balance, splitterBeforeSeed, "initial seed did not fund the splitter");
        _assertSolvent("after equal reserve seed");

        // the swept source pays nothing further: with no reserve the drip is zero,
        // so a retained position is flat (its principal and earned value intact)
        uint256 registrantValueAfterSweep = (staking.stakerEntities(admin, OLD).shares * entity.entityShareToVana(OLD)) / ONE;
        vm.warp(block.timestamp + 1 days);
        entity.processRewards(OLD);
        assertEq(
            (staking.stakerEntities(admin, OLD).shares * entity.entityShareToVana(OLD)) / ONE,
            registrantValueAfterSweep,
            "no more yield in the swept entity"
        );
        console.log(string.concat("  1 day later, source registrant position flat at ", _vana(registrantValueAfterSweep), " (no reserve, no drip)"));

        // ---- 3. block new stake into the old entity; exits and redelegate-out stay open ----
        _step("STEP 3: block new stake into the source entity");
        vm.prank(admin); // entity-1 owner
        entity.updateEntityStakingBlocked(OLD, true);
        assertTrue(entity.entityStakingBlocked(OLD));
        address newcomer = makeAddr("newcomer");
        vm.deal(newcomer, 10 ether);
        vm.prank(newcomer);
        vm.expectRevert(VanaPoolStakingImplementation.StakingBlocked.selector);
        staking.stake{value: 5 ether}(OLD, newcomer, 0);
        console.log("  stakingBlocked(1) = true; a fresh 5 VANA stake into entity 1 -> reverts StakingBlocked");

        // ---- 4. every live staker of entity 1 migrates into the new entities ----
        _step("STEP 4: every live staker of entity 1 redelegates into the new entities");
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
            console.log(string.concat("  ", vm.toString(s), " -> entity ", vm.toString(target), ": moved ", _vana(movedValue), s == registrant ? " (registrant, floor kept)" : ""));
            movedTotal += movedValue;
            migrated++;
        }
        console.log(string.concat("  migrated ", vm.toString(migrated), " stakers, ", _vana(movedTotal), " total | entity 1 totalShares now == registration floor"));
        for (uint256 i = 0; i < 3; i++) _logEntity("after migration", newIds[i]);
        assertGt(migrated, 1, "the real stakers of entity 1 moved");
        assertEq(entity.entities(OLD).totalShares, floorShares, "only the registrant's floor remains in entity 1");
        _assertSolvent("after migration");

        // snapshot a migrated staker's position in its new entity before any rewards
        address sample = stakers[0] == registrant ? stakers[1] : stakers[0];
        uint256 sampleEntity = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (staking.stakerEntities(sample, newIds[i]).shares > 0) sampleEntity = newIds[i];
        }
        assertGt(sampleEntity, 0, "sample staker landed in a new entity");
        uint256 sampleBefore = _value(sample, sampleEntity);

        // ---- 5. fund the splitter (the admin/deployer wallet), 10% burn, two rounds ----
        _step("STEP 5: fund the splitter, set a 10% burn, run two distribution rounds");
        (bool ok,) = payable(address(splitter)).call{value: BUDGET}("");
        assertTrue(ok);
        console.log(string.concat("  splitter funded with ", _vana(BUDGET), " by ", vm.toString(address(this)), " | burn rate 10%"));
        vm.prank(admin);
        splitter.updateBurnRate(BURN_RATE);
        uint256 lockedBefore0 = entity.entityStakerLockedRewardPool(newIds[0]);
        vm.prank(admin);
        splitter.distribute(BUDGET, _ids()); // round 1: baselines only, by design
        assertEq(entity.entityStakerLockedRewardPool(newIds[0]), lockedBefore0, "round 1 pays nothing");
        assertEq(splitter.pendingBurn(), 0, "no burn accrued on a zero-weight round");
        console.log("  round 1: baselines recorded, nothing paid, no burn (by design)");
        console.log("  ... 3 days of principal-seconds accrue ...");

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
            console.log(string.concat("  round 2 -> entity ", vm.toString(newIds[i]), ": stakers' track +", _vana(dLocked), " | owner commission +", _vana(dComm), " (10%)"));
        }
        uint256 burn = splitter.pendingBurn();
        assertEq(burn, (BUDGET * BURN_RATE) / splitter.MAX_BURN_RATE(), "burn = 10% of the budget");
        assertApproxEqAbs(paidToStakers + paidCommission + burn, BUDGET, 3, "budget conserved (dust)");
        console.log(string.concat("  burn accrued: ", _vana(burn), " | stakers ", _vana(paidToStakers), " + commission ", _vana(paidCommission), " + burn = ", _vana(paidToStakers + paidCommission + burn), " (budget ", _vana(BUDGET), ")"));
        _assertSolvent("after distribution");

        // ---- 6. owners claim their commission (entity pays through the treasury: SPENDER_ROLE) ----
        _step("STEP 6: owners claim their commission (paid by the treasury via SPENDER_ROLE)");
        for (uint256 i = 0; i < 3; i++) {
            uint256 accrued = entity.entityAccruedCommission(newIds[i]);
            uint256 before = owners[i].balance;
            vm.prank(owners[i]);
            entity.claimCommission(newIds[i]);
            assertEq(owners[i].balance - before, accrued, "owner received the commission");
            assertEq(entity.entityAccruedCommission(newIds[i]), 0);
            console.log(string.concat("  owner of entity ", vm.toString(newIds[i]), " claimed ", _vana(accrued), " -> wallet ", _vana(owners[i].balance)));
        }
        _assertSolvent("after commission claims");

        // ---- 7. rewards reach the stakers: vest the splitter track (7 d) + the 40% APY drip ----
        _step("STEP 7: 7 days later, rewards reach the stakers (splitter track vests + 40% APY drips)");
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
            console.log(string.concat("  entity ", vm.toString(newIds[i]), ": splitter track vested to stakers | APY drip ", _vana(dripped), " | owner commission on the drip ", _vana(dripComm), " (10%)"));
            _logEntity("after vesting", newIds[i]);
        }
        uint256 sampleAfter = _value(sample, sampleEntity);
        assertGt(sampleAfter, sampleBefore, "a migrated staker's position grew");
        console.log(string.concat("  sample migrated staker ", vm.toString(sample), " in entity ", vm.toString(sampleEntity), ": ", _vana(sampleBefore), " -> ", _vana(sampleAfter), " (+", _vana(sampleAfter - sampleBefore), ")"));

        // ---- 8. burn: the reserve leaves the splitter to address(0) ----
        _step("STEP 8: execute the burn");
        uint256 zeroBefore = address(0).balance;
        splitter.executeBurn();
        assertEq(address(0).balance - zeroBefore, burn, "burned to the zero address");
        assertEq(splitter.pendingBurn(), 0);
        console.log(string.concat("  ", _vana(burn), " sent to address(0) | pendingBurn = 0"));

        _step("END: solvency");
        console.log(string.concat("  treasury ", _vana(address(treasury).balance), " >= all books ", _vana(_owed())));
        _assertSolvent("end");
    }
}
