// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";
import {IVanaPoolStaking} from "../../contracts/vanaStaking/vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

contract MockTreasury {
    receive() external payable {}
}

/// @dev Only vanaPoolTreasury() is exercised; ABI-compatible with the interface.
contract MockStaking {
    address private _treasury;

    constructor(address t) {
        _treasury = t;
    }

    function vanaPoolTreasury() external view returns (address) {
        return _treasury;
    }
}

contract TopUpHarness is VanaPoolEntityImplementation {
    function setStaking(address s) external {
        vanaPoolStaking = IVanaPoolStaking(s);
    }

    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function getEntity(uint256 id) external view returns (IVanaPoolEntity.Entity memory) {
        return _entities[id];
    }
}

contract TopUpQueuedRewardsTest is Test {
    TopUpHarness h;
    MockTreasury treasury;

    address owner = makeAddr("owner");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new TopUpHarness();
        treasury = new MockTreasury();
        h.setStaking(address(new MockStaking(address(treasury))));
        vm.warp(START);
        vm.deal(owner, 1_000 ether);
    }

    function _seed(
        IVanaPoolEntity.RewardModel model,
        uint256 locked,
        IVanaPoolEntity.RewardSchedule memory sched
    ) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: owner,
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: locked,
                activeRewardPool: 100 ether,
                totalShares: 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: model,
                rewardSchedule: sched
            })
        );
    }

    /// active 10e over [START,+10d]; queued 20e over [START+10d,+20d]
    function _seedWithQueue(uint256 locked) internal {
        _seed(
            IVanaPoolEntity.RewardModel.STREAM,
            locked,
            IVanaPoolEntity.RewardSchedule(10 ether, START, 10 days, uint32(START), 20 ether, START + 10 days, 20 days)
        );
    }

    function test_topUpGrowsQueuedEntryAndFundsTreasury() public {
        _seedWithQueue(30 ether);

        vm.prank(owner);
        h.topUpQueuedRewards{value: 10 ether}(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.rewardSchedule.nextScheduledValue, 30 ether, "queued grew 20 -> 30");
        assertEq(e.rewardSchedule.nextStart, START + 10 days, "queued start unchanged");
        assertEq(e.rewardSchedule.nextDuration, 20 days, "queued duration unchanged");
        assertEq(e.rewardSchedule.scheduledValue, 10 ether, "active entry untouched");
        assertEq(e.lockedRewardPool, 40 ether, "locked +10");
        assertEq(address(treasury).balance, 10 ether, "funds forwarded to treasury");
        assertEq(h.committedRewards(ID), 40 ether, "committed 10 active + 30 queued");
    }

    function test_revertsWhenNothingQueued() public {
        _seed(
            IVanaPoolEntity.RewardModel.STREAM,
            10 ether,
            IVanaPoolEntity.RewardSchedule(10 ether, START, 10 days, uint32(START), 0, 0, 0) // no queue
        );
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.topUpQueuedRewards{value: 10 ether}(ID);
    }

    function test_revertsOnZeroValue() public {
        _seedWithQueue(30 ether);
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.topUpQueuedRewards{value: 0}(ID);
    }

    function test_revertsForNonOwner() public {
        _seedWithQueue(30 ether);
        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        vm.expectRevert(VanaPoolEntityImplementation.NotEntityOwner.selector);
        h.topUpQueuedRewards{value: 10 ether}(ID);
    }

    function test_revertsForApyModel() public {
        _seed(
            IVanaPoolEntity.RewardModel.APY,
            10 ether,
            IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 20 ether, START + 10 days, 20 days)
        );
        vm.prank(owner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidRewardModel.selector);
        h.topUpQueuedRewards{value: 10 ether}(ID);
    }
}
