// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Exercises the principal-seconds accumulator directly: a harness exposes
///      the internal checkpoint and a raw stakedPrincipal setter, letting the
///      test drive the exact update-before-mutate sequence the real write sites
///      use. The metric integrates COMMITTED PRINCIPAL, not activeRewardPool, so
///      it is invariant to when processRewards is called.
contract SSHarness is VanaPoolEntityImplementation {
    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function checkpoint(uint256 id) external {
        _checkpointPrincipalSeconds(_entities[id]);
    }

    function setPrincipal(uint256 id, uint256 v) external {
        _entities[id].stakedPrincipal = v;
    }

    // Raising activeRewardPool models a processRewards drip: it must NOT move the
    // weight metric.
    function setActive(uint256 id, uint256 v) external {
        _entities[id].activeRewardPool = v;
    }

    function stored(uint256 id) external view returns (uint256 ps, uint256 updatedAt) {
        ps = _entities[id].principalSeconds;
        updatedAt = _entities[id].principalSecondsUpdatedAt;
    }
}

contract StakeSecondsTest is Test {
    SSHarness h;
    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new SSHarness();
        vm.warp(START);
    }

    function _seed(
        uint256 principal,
        uint256 updatedAt,
        IVanaPoolEntity.EntityStatus status
    ) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: status,
                name: "e",
                maxAPY: 0,
                lockedRewardPool: 0,
                activeRewardPool: principal,
                totalShares: principal,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0),
                commissionRate: 0,
                accruedCommission: 0,
                stakedPrincipal: principal,
                principalSeconds: 0,
                principalSecondsUpdatedAt: updatedAt,
                stakingBlocked: false,
                sweepableAfter: 0,
                pendingCommissionRate: 0,
                stakerLockedRewardPool: 0,
                stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
            })
        );
    }

    // ---- linear accrual ----

    function test_linearAccrual() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);
        vm.warp(START + 10);
        assertEq(h.principalSecondsAt(ID), 100 * 10);
        vm.warp(START + 25);
        assertEq(h.principalSecondsAt(ID), 100 * 25);
    }

    // ---- staircase: bank at the OLD rate on each change ----

    function test_staircaseMatchesHandComputedIntegral() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);

        // 10s at rate 100 -> checkpoint banks 1000, then principal -> 150
        vm.warp(START + 10);
        h.checkpoint(ID);
        h.setPrincipal(ID, 150);

        // 15s at rate 150 -> checkpoint banks 2250 (total 3250), then principal -> 50
        vm.warp(START + 25);
        h.checkpoint(ID);
        h.setPrincipal(ID, 50);

        // 5s at rate 50, read live (no checkpoint): 3250 + 250 = 3500
        vm.warp(START + 30);
        assertEq(h.principalSecondsAt(ID), 1000 + 2250 + 250);
    }

    // ---- settlement invariance: an activeRewardPool drip does NOT move weight ----

    function test_processRewardsDripDoesNotInflateWeight() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);

        // 10s of committed principal accrues normally.
        vm.warp(START + 10);
        assertEq(h.principalSecondsAt(ID), 1000);

        // A "processRewards" drip triples activeRewardPool. Under the old
        // activeRewardPool-based metric this would balloon the weight; the
        // principal-based metric ignores it entirely.
        h.setActive(ID, 300);
        vm.warp(START + 20);
        assertEq(h.principalSecondsAt(ID), 2000, "weight tracks principal, not pool value");
    }

    // ---- view is exact vs the stored value right after a checkpoint ----

    function test_viewEqualsStoredAfterCheckpoint() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Active);
        vm.warp(START + 10);
        h.checkpoint(ID);
        (uint256 ps, uint256 updatedAt) = h.stored(ID);
        assertEq(updatedAt, block.timestamp, "watermark advanced to now");
        assertEq(h.principalSecondsAt(ID), ps, "no extrapolation when updatedAt == now");
        assertEq(ps, 1000, "banked the elapsed rectangle");
    }

    // ---- first touch initializes without integrating from the epoch ----

    function test_firstTouchStartsClockNoPhantom() public {
        _seed(100, 0, IVanaPoolEntity.EntityStatus.Active); // updatedAt == 0 sentinel
        vm.warp(START + 10);
        assertEq(h.principalSecondsAt(ID), 0, "frozen until first checkpoint (no epoch integral)");

        h.checkpoint(ID); // first touch: start the clock, accrue nothing
        (uint256 ps, uint256 updatedAt) = h.stored(ID);
        assertEq(ps, 0, "no phantom principal-seconds");
        assertEq(updatedAt, block.timestamp, "clock started now");

        vm.warp(block.timestamp + 10);
        assertEq(h.principalSecondsAt(ID), 100 * 10, "accrues from the initialized watermark");
    }

    // ---- migration: a pre-upgrade entity with stake but no stakedPrincipal ----

    /// @dev NM-1052 [Medium] re-review: between the upgrade and the first
    ///      stake/unstake, rewards settled into activeRewardPool must NOT be
    ///      seeded as principal. The seed is the share supply (rewards never
    ///      mint shares), a lower bound on principal that nothing in that
    ///      window can inflate. Here 400 shares stand against a 500 pool: the
    ///      100 of settled rewards are excluded.
    function test_migrationSeedsPrincipalFromShareSupplyNotPoolValue() public {
        // Simulate a pre-upgrade entity: has stake (activeRewardPool/totalShares)
        // but stakedPrincipal == 0 and never checkpointed.
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 0,
                lockedRewardPool: 0,
                activeRewardPool: 500,
                totalShares: 400,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0),
                commissionRate: 0,
                accruedCommission: 0,
                stakedPrincipal: 0, // not migrated yet
                principalSeconds: 0,
                principalSecondsUpdatedAt: 0, // never checkpointed
                stakingBlocked: false,
                sweepableAfter: 0,
                pendingCommissionRate: 0,
                stakerLockedRewardPool: 0,
                stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
            })
        );

        // View is frozen at 0 until the first state-changing checkpoint.
        vm.warp(START + 10);
        assertEq(h.principalSecondsAt(ID), 0, "frozen pre-migration");

        h.checkpoint(ID); // first touch seeds stakedPrincipal from the pool value
        (uint256 ps, uint256 updatedAt) = h.stored(ID);
        assertEq(ps, 0, "no phantom accrual on the seeding touch");
        assertEq(updatedAt, block.timestamp, "clock started now");

        vm.warp(block.timestamp + 10);
        assertEq(h.principalSecondsAt(ID), 400 * 10, "accrues on the seeded principal (= share supply, not the 500 pool)");
    }

    /// @dev Whatever is settled into the pool before the first touch, the seed
    ///      does not move: two entities with the same share supply but very
    ///      different pool values (one had rewards parked) seed identically.
    function test_migrationSeedIsInsensitiveToRewardsSettledBeforeFirstTouch() public {
        uint256[2] memory pools = [uint256(400), uint256(400_000)]; // same 400 shares, 1000x the rewards
        for (uint256 i = 0; i < 2; i++) {
            h.setEntity(
                ID + i,
                IVanaPoolEntity.Entity({
                    ownerAddress: address(0xE),
                    status: IVanaPoolEntity.EntityStatus.Active,
                    name: "e",
                    maxAPY: 0,
                    lockedRewardPool: 0,
                    activeRewardPool: pools[i],
                    totalShares: 400,
                    lastUpdateTimestamp: START,
                    totalDistributedRewards: 0,
                    rewardModel: IVanaPoolEntity.RewardModel.APY,
                    rewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0),
                    commissionRate: 0,
                    accruedCommission: 0,
                    stakedPrincipal: 0,
                    principalSeconds: 0,
                    principalSecondsUpdatedAt: 0,
                    stakingBlocked: false,
                    sweepableAfter: 0,
                    pendingCommissionRate: 0,
                    stakerLockedRewardPool: 0,
                    stakerRewardSchedule: IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0)
                })
            );
            h.checkpoint(ID + i);
        }
        vm.warp(block.timestamp + 10);
        assertEq(h.principalSecondsAt(ID), h.principalSecondsAt(ID + 1), "parked rewards did not inflate the seed");
        assertEq(h.principalSecondsAt(ID + 1), 400 * 10);
    }

    // ---- non-Active entity is frozen (view + checkpoint agree) ----

    function test_nonActiveFrozen() public {
        _seed(100, START, IVanaPoolEntity.EntityStatus.Removed);
        vm.warp(START + 10);
        assertEq(h.principalSecondsAt(ID), 0, "view frozen while non-Active");

        h.checkpoint(ID);
        (uint256 ps, ) = h.stored(ID);
        assertEq(ps, 0, "checkpoint banks nothing while non-Active");
    }
}
