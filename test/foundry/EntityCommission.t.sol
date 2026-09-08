// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev The commission skim is pure accounting inside processRewards (locked ->
///      active + accruedCommission), so a bare harness that seeds an entity is
///      enough. The claim path (treasury pull) is covered in the e2e test.
contract CommissionHarness is VanaPoolEntityImplementation {
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

contract EntityCommissionTest is Test {
    CommissionHarness h;

    address entityOwner = makeAddr("entityOwner");
    address maintainer = makeAddr("maintainer");
    address stranger = makeAddr("stranger");

    uint64 constant START = 1_000_000;
    uint256 constant ID = 1;

    function setUp() public {
        h = new CommissionHarness();
        h.grantMaintainer(maintainer);
        vm.warp(START);
    }

    function _empty() internal pure returns (IVanaPoolEntity.RewardSchedule memory) {
        return IVanaPoolEntity.RewardSchedule(0, 0, 0, 0, 0, 0, 0);
    }

    function _seed(
        IVanaPoolEntity.RewardModel model,
        uint256 locked,
        uint256 active,
        uint256 commissionRate,
        IVanaPoolEntity.RewardSchedule memory sched
    ) internal {
        h.setEntity(
            ID,
            IVanaPoolEntity.Entity({
                ownerAddress: entityOwner,
                status: IVanaPoolEntity.EntityStatus.Active,
                name: "e",
                maxAPY: 6e18,
                lockedRewardPool: locked,
                activeRewardPool: active,
                totalShares: active > 0 ? active : 100 ether,
                lastUpdateTimestamp: START,
                totalDistributedRewards: 0,
                rewardModel: model,
                rewardSchedule: sched,
                commissionRate: commissionRate,
                accruedCommission: 0
            })
        );
    }

    // ---- skim: APY ----

    function test_apySkimSplitsAndConserves() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty()); // 10%
        vm.warp(START + 365 days);

        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);
        uint256 commission = toDistribute / 10;

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, commission, "10% skimmed");
        assertEq(e.activeRewardPool, 100 ether + (toDistribute - commission), "delegator remainder to active");
        assertEq(e.lockedRewardPool, 1_000 ether - toDistribute, "locked -= full distribution");
        assertEq(
            e.lockedRewardPool + e.activeRewardPool + e.accruedCommission,
            1_100 ether,
            "locked + active + commission conserved"
        );
    }

    // ---- skim: STREAM ----

    function test_streamSkimSplits() public {
        IVanaPoolEntity.RewardSchedule memory sched =
            IVanaPoolEntity.RewardSchedule(100 ether, START, 10 days, uint32(START), 0, 0, 0);
        _seed(IVanaPoolEntity.RewardModel.STREAM, 100 ether, 0, 20e18, sched); // 20%

        vm.warp(START + 5 days); // half vests -> 50 ether distributed
        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, 10 ether, "20% of 50");
        assertEq(e.activeRewardPool, 40 ether, "80% to delegators");
        assertEq(e.lockedRewardPool, 50 ether, "half still locked");
    }

    // ---- zero commission == old behaviour ----

    function test_zeroCommission_allToDelegators() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.warp(START + 365 days);
        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, 0, "no commission");
        assertEq(e.activeRewardPool, 100 ether + toDistribute, "everything to delegators");
    }

    // ---- rate change settles at the old rate ----

    function test_updateCommission_settlesAtOldRateFirst() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 10e18, _empty()); // 10%
        vm.warp(START + 365 days);
        uint256 pending = h.calculateYield(100 ether, 6e18, 365 days);

        vm.prank(entityOwner);
        h.updateEntityCommission(ID, 20e18); // raise to 20%

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.commissionRate, 20e18, "new rate stored");
        assertEq(e.accruedCommission, pending / 10, "pending settled at OLD 10%");
    }

    // ---- access + bounds ----

    function test_onlyOwnerOrMaintainerSetsCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.prank(stranger);
        vm.expectRevert(VanaPoolEntityImplementation.NotEntityOwner.selector);
        h.updateEntityCommission(ID, 10e18);
    }

    function test_maintainerCanSetCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.prank(maintainer);
        h.updateEntityCommission(ID, 15e18);
        assertEq(h.entityCommissionRate(ID), 15e18);
    }

    function test_rejectsAboveMaxCommission() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 0, _empty());
        vm.prank(entityOwner);
        vm.expectRevert(VanaPoolEntityImplementation.InvalidParam.selector);
        h.updateEntityCommission(ID, 100e18 + 1); // > MAX_COMMISSION
    }

    function test_hundredPercentCommission_delegatorsGetNothing() public {
        _seed(IVanaPoolEntity.RewardModel.APY, 1_000 ether, 100 ether, 100e18, _empty()); // 100%
        vm.warp(START + 365 days);
        uint256 toDistribute = h.calculateYield(100 ether, 6e18, 365 days);

        h.processRewards(ID);

        IVanaPoolEntity.Entity memory e = h.getEntity(ID);
        assertEq(e.accruedCommission, toDistribute, "all to operator");
        assertEq(e.activeRewardPool, 100 ether, "nothing to delegators");
    }
}
