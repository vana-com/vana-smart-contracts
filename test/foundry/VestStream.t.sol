// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Exposes the internal _vestStream and a settable schedule so the linear
///      vesting math can be unit-tested before the scheduling/switch API exists.
///      _vestStream reads no contract state beyond the schedule reference, so a
///      bare deployment (no proxy/init) is sufficient.
contract VestStreamHarness is VanaPoolEntityImplementation {
    IVanaPoolEntity.RewardSchedule internal _schedule;

    function setSchedule(IVanaPoolEntity.RewardSchedule calldata s) external {
        _schedule = s;
    }

    function vest(uint256 totalShares) external returns (uint256) {
        return _vestStream(_schedule, totalShares);
    }

    function schedule() external view returns (IVanaPoolEntity.RewardSchedule memory) {
        return _schedule;
    }
}

contract VestStreamTest is Test {
    VestStreamHarness h;

    uint128 constant VALUE = 10_000 ether;
    uint32 constant DURATION = 10 days; // divisible by 4 → exact quarter checks
    // Compile-time constant base time. Do NOT derive the base from
    // block.timestamp: under viaIR the optimizer treats block.timestamp as
    // call-invariant and re-reads it, so a local seeded from it drifts across
    // vm.warp. A constant cannot alias block.timestamp.
    uint64 constant START = 1_000_000;

    function setUp() public {
        h = new VestStreamHarness();
        vm.warp(START);
    }

    /// @dev Install an active-only entry whose watermark equals `start` (the
    ///      case where vesting begins immediately: first vest counts from start).
    function _install(uint64 start, uint32 duration, uint128 value) internal {
        _installWithWatermark(start, duration, value, start);
    }

    function _installWithWatermark(
        uint64 start,
        uint32 duration,
        uint128 value,
        uint64 lastUpdate
    ) internal {
        h.setSchedule(
            IVanaPoolEntity.RewardSchedule({
                scheduledValue: value,
                start: start,
                duration: duration,
                lastUpdate: uint32(lastUpdate),
                nextScheduledValue: 0,
                nextStart: 0,
                nextDuration: 0
            })
        );
    }

    // ---- linear vesting ----

    function test_vestsLinearlyOverDuration() public {
        uint64 start = START;
        _install(start, DURATION, VALUE);

        vm.warp(start + DURATION / 4);
        assertEq(h.vest(1000), VALUE / 4, "first quarter");

        vm.warp(start + DURATION / 2);
        assertEq(h.vest(1000), VALUE / 4, "delta to half");

        vm.warp(start + DURATION);
        assertEq(h.vest(1000), VALUE / 2, "delta to end");
    }

    function test_nothingBeforeStart() public {
        uint64 installTime = START;
        uint64 start = installTime + 5 days;
        // realistic future-start install: watermark is the install time (< start)
        _installWithWatermark(start, DURATION, VALUE, installTime);

        vm.warp(START + 1 days); // still before start
        assertEq(h.vest(1000), 0, "no vest before start");
        assertEq(h.schedule().lastUpdate, installTime, "watermark not advanced before start");
    }

    function test_clampsAtEnd_totalEqualsValueExactly() public {
        uint64 start = START;
        _install(start, DURATION, VALUE);

        uint256 total;
        uint256[5] memory ts = [uint256(1 days), 3 days, 7 days, 10 days, 15 days];
        for (uint256 i = 0; i < ts.length; i++) {
            vm.warp(start + ts[i]);
            total += h.vest(1000);
        }
        assertEq(total, VALUE, "sum of vests equals scheduled value exactly");
        // past the end the entry is consumed: scheduledValue cycled to zero
        assertEq(h.schedule().scheduledValue, 0, "entry consumed after end");
    }

    // ---- call-timing invariance ----

    function test_timingInvariance_oneStepEqualsManySteps() public {
        uint64 start = START;

        _install(start, DURATION, VALUE);
        vm.warp(start + DURATION);
        uint256 oneStep = h.vest(1000);

        _install(start, DURATION, VALUE); // reset
        uint256 manySteps;
        for (uint256 d = 1; d <= 10; d++) {
            vm.warp(start + d * 1 days);
            manySteps += h.vest(1000);
        }
        assertEq(oneStep, VALUE, "one-step vests full value");
        assertEq(manySteps, VALUE, "many-step vests full value");
        assertEq(oneStep, manySteps, "timing invariant");
    }

    // ---- zero-shares preserve behavior ----

    function test_zeroShares_returnsZeroAndPreservesInterval() public {
        uint64 start = START;
        _install(start, DURATION, VALUE);

        vm.warp(start + DURATION / 2); // half elapses with no shares
        assertEq(h.vest(0), 0, "no vest with zero shares");
        assertEq(h.schedule().lastUpdate, start, "watermark preserved");

        // shares return; the whole elapsed half is now claimable
        assertEq(h.vest(1000), VALUE / 2, "preserved interval vests once shares exist");
    }

    // ---- instant entry (duration 0) ----

    function test_instantEntry_vestsFullValueOnce() public {
        uint64 start = START;
        // watermark below start so the instant entry fires exactly once
        _installWithWatermark(start, 0, VALUE, start - 1);

        assertEq(h.vest(1000), VALUE, "instant vests all");
        assertEq(h.vest(1000), 0, "nothing left on a second call");
    }

    // ---- queued entry cycling ----

    function test_queuedEntryPromotesAndVests() public {
        uint64 start = START;
        // active 10k over [start, start+10d]; queued 20k over [start+10d, +20d]
        h.setSchedule(
            IVanaPoolEntity.RewardSchedule({
                scheduledValue: VALUE,
                start: start,
                duration: DURATION,
                lastUpdate: uint32(start),
                nextScheduledValue: 20_000 ether,
                nextStart: start + DURATION,
                nextDuration: 20 days
            })
        );

        // day 15: all 10k of active + 5 of 20 days of the queued head (= 5k)
        vm.warp(start + 15 days);
        assertEq(h.vest(1000), VALUE + 5_000 ether, "active fully + queued head");

        IVanaPoolEntity.RewardSchedule memory s = h.schedule();
        assertEq(s.scheduledValue, 20_000 ether, "promoted to active");
        assertEq(s.start, start + DURATION, "promoted start");
        assertEq(s.nextScheduledValue, 0, "queue slot cleared");

        // finish the promoted stream: remaining 15k of the 20k
        vm.warp(start + DURATION + 20 days);
        assertEq(h.vest(1000), 15_000 ether, "remainder of promoted entry");
    }

    // ---- fuzz: conservation ----

    function testFuzz_totalVestedNeverExceedsValue(uint32 elapsed, uint8 steps) public {
        uint64 start = START;
        _install(start, DURATION, VALUE);

        uint256 n = bound(steps, 1, 20);
        uint256 span = bound(elapsed, 1, 30 days);

        uint256 total;
        for (uint256 i = 1; i <= n; i++) {
            vm.warp(start + (span * i) / n); // non-decreasing warps
            total += h.vest(1000);
        }
        assertLe(total, VALUE, "never over-vests");
        if (span >= DURATION) {
            assertEq(total, VALUE, "fully vested once past the window");
        }
    }
}
