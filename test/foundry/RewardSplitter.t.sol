// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {RewardSplitterImplementation} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";
import {RewardSplitterProxy} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

contract RewardSplitterTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;
    RewardSplitterImplementation splitter;

    address owner = makeAddr("owner");
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");
    address stranger = makeAddr("stranger");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant MAX_APY_DEFAULT = 6e18;

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();
        RewardSplitterImplementation ri = new RewardSplitterImplementation();

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
        splitter = RewardSplitterImplementation(
            payable(
                new RewardSplitterProxy(
                    address(ri),
                    abi.encodeCall(RewardSplitterImplementation.initialize, (owner, address(entity)))
                )
            )
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        vm.stopPrank();

        vm.deal(owner, 100_000 ether);
        vm.deal(staker, 100_000 ether);
        vm.deal(address(splitter), 10_000 ether); // fund the distributable balance
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: name})
        );
        id = entity.entitiesCount();
    }

    function _stake(uint256 id, uint256 amount) internal {
        vm.prank(staker);
        staking.stake{value: amount}(id, staker, 0);
    }

    function _locked(uint256 id) internal view returns (uint256) {
        return entity.entities(id).lockedRewardPool;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    // ---- first round records baselines, pays nothing ----

    function test_firstRoundSetsBaselineNoPayout() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        _stake(a, 100 ether);
        _stake(b, 100 ether);
        vm.warp(block.timestamp + 10 days);

        uint256 la = _locked(a);
        uint256 lb = _locked(b);

        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        assertEq(_locked(a), la, "no payout for first-seen A");
        assertEq(_locked(b), lb, "no payout for first-seen B");
        assertTrue(splitter.seen(a) && splitter.seen(b), "baselines recorded");
    }

    // ---- split proportional to the stake-seconds delta ----

    function test_splitsProportionalToStakeSecondsDelta() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        _stake(a, 100 ether);
        _stake(b, 100 ether);

        // round 1: just set baselines
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        // make A accrue at ~2x B for the next round
        _stake(a, 100 ether); // A ~201, B ~101 active
        vm.warp(block.timestamp + 10 days);

        uint256 wA = splitter.pendingWeight(a);
        uint256 wB = splitter.pendingWeight(b);
        assertGt(wA, wB, "A accrued more stake-seconds");

        uint256 la = _locked(a);
        uint256 lb = _locked(b);
        uint256 budget = 100 ether;

        vm.prank(owner);
        splitter.distribute(budget, _ids(a, b));

        uint256 shareA = _locked(a) - la;
        uint256 shareB = _locked(b) - lb;

        // shares track the weights, and sum to the budget (minus integer dust)
        assertApproxEqRel(shareA, (budget * wA) / (wA + wB), 1e12, "A share ~ wA/(wA+wB)");
        assertApproxEqRel(shareB, (budget * wB) / (wA + wB), 1e12, "B share ~ wB/(wA+wB)");
        assertApproxEqAbs(shareA + shareB, budget, 2, "conserved minus dust");
    }

    // ---- a flash stake right before distribution earns ~nothing ----

    function test_flashStakeGetsNegligibleShare() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        _stake(a, 100 ether);
        _stake(b, 100 ether);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b)); // baselines

        // both accrue equally for the round
        vm.warp(block.timestamp + 10 days);

        // flash: dump a huge stake into A in the same block as distribute
        _stake(a, 10_000 ether);

        uint256 la = _locked(a);
        uint256 lb = _locked(b);

        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        uint256 shareA = _locked(a) - la;
        uint256 shareB = _locked(b) - lb;

        // the flash added ~0 stake-seconds (0 elapsed time), so A ~= B
        assertApproxEqRel(shareA, shareB, 1e15, "flash stake did not inflate A's share");
    }

    // ---- guards ----

    function test_rejectsBudgetOverBalance() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBudget.selector);
        splitter.distribute(address(splitter).balance + 1, _ids(a, b));
    }

    function test_onlyDistributorCanDistribute() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(stranger);
        vm.expectRevert();
        splitter.distribute(100 ether, _ids(a, b));
    }
}
