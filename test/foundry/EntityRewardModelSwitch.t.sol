// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev updateEntityRewardModel and processRewards touch only entity storage
///      and pure math (calculateYield / _vestStream) -- no VanaPoolStaking or
///      treasury -- so a bare harness that seeds an entity and grants the
///      maintainer role is enough to test the switch in isolation.
contract SwitchHarness is VanaPoolEntityImplementation {
    function grantMaintainer(address who) external {
        _grantRole(MAINTAINER_ROLE, who);
    }

    function setEntity(uint256 id, IVanaPoolEntity.Entity calldata e) external {
        _entities[id] = e;
    }

    function getEntity(uint256 id) external view returns (IVanaPoolEntity.Entity memory) {
        return _entities[id];
    }
}

contract EntityRewardModelSwitchTest is Test {
    SwitchHarness h;

    address maintainer = makeAddr("maintainer");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ENTITY_ID = 1;

    function setUp() public {
        h = new SwitchHarness();
        h.grantMaintainer(maintainer);
        vm.warp(START);
    }

    function _emptySchedule() internal pure returns (IVanaPoolEntity.RewardSchedule memory) {
        return IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0);
    }

    function _seedApy(uint256 locked, uint256 active, uint256 maxAPY) internal {
        h.setEntity(
            ENTITY_ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: maxAPY,
                lockedRewardPool: locked,
                activeRewardPool: active,
                totalShares: active, // share price 1.0; nonzero so vesting can occur
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.APY,
                rewardSchedule: _emptySchedule(),
                commissionRate: 0,
                accruedCommission: 0
            })
        );
    }

    // ---- conservation + settle ----

    function test_switchApyToStream_settlesAndConserves() public {
        _seedApy(1_000 ether, 100 ether, 6e18);

        vm.warp(START + 30 days);
        // expected drip under the old (APY) model, capped by locked
        uint256 expected = h.calculateYield(100 ether, 6e18, 30 days);
        assertLe(expected, 1_000 ether, "test setup: locked must not bind");

        vm.prank(maintainer);
        h.updateEntityRewardModel(ENTITY_ID, IVanaPoolEntity.RewardModel.STREAM);

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(uint256(e.rewardModel), uint256(IVanaPoolEntity.RewardModel.STREAM), "model flipped");
        assertEq(e.activeRewardPool, 100 ether + expected, "APY settled into active");
        assertEq(e.lockedRewardPool, 1_000 ether - expected, "locked reduced by settle");
        assertEq(e.lockedRewardPool + e.activeRewardPool, 1_100 ether, "locked+active conserved");
    }

    function test_switchStreamToApy_vestsThenFlips() public {
        // STREAM entity: 10k over [START, START+10d], funded from locked
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(10_000 ether, START, 10 days, uint32(START), 0, 0, 0);
        h.setEntity(
            ENTITY_ID,
            IVanaPoolEntity.Entity({
                ownerAddress: address(0xE),
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: 10_000 ether,
                activeRewardPool: 0,
                totalShares: 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: IVanaPoolEntity.RewardModel.STREAM,
                rewardSchedule: sched,
                commissionRate: 0,
                accruedCommission: 0
            })
        );

        vm.warp(START + 5 days); // half the stream

        vm.prank(maintainer);
        h.updateEntityRewardModel(ENTITY_ID, IVanaPoolEntity.RewardModel.APY);

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(uint256(e.rewardModel), uint256(IVanaPoolEntity.RewardModel.APY), "model flipped");
        assertEq(e.activeRewardPool, 5_000 ether, "half the stream vested at switch");
        assertEq(e.lockedRewardPool, 5_000 ether, "remainder still locked");
        assertEq(e.lockedRewardPool + e.activeRewardPool, 10_000 ether, "conserved");
    }

    // ---- idempotence ----

    function test_switchToSameModel_isNoOpBeyondSettle() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        vm.warp(START + 30 days);
        uint256 expected = h.calculateYield(100 ether, 6e18, 30 days);

        vm.prank(maintainer);
        h.updateEntityRewardModel(ENTITY_ID, IVanaPoolEntity.RewardModel.APY); // same model

        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        assertEq(uint256(e.rewardModel), uint256(IVanaPoolEntity.RewardModel.APY), "still APY");
        assertEq(e.activeRewardPool, 100 ether + expected, "settle still ran");
    }

    // ---- access control ----

    function test_onlyMaintainerCanSwitch() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        // read the role BEFORE pranking: an external call here would otherwise
        // consume the prank and the target call would run as the default sender.
        bytes32 role = h.MAINTAINER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                role
            )
        );
        h.updateEntityRewardModel(ENTITY_ID, IVanaPoolEntity.RewardModel.STREAM);
    }

    function test_nonActiveEntityReverts() public {
        _seedApy(1_000 ether, 100 ether, 6e18);
        // flip status to Removed
        IVanaPoolEntity.Entity memory e = h.getEntity(ENTITY_ID);
        e.status = IVanaPoolEntity.EntityStatus.Removed;
        h.setEntity(ENTITY_ID, e);

        vm.prank(maintainer);
        vm.expectRevert(); // InvalidEntityStatus
        h.updateEntityRewardModel(ENTITY_ID, IVanaPoolEntity.RewardModel.STREAM);
    }
}
