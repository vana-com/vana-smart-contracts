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
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

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
        // the splitter pays delegators directly via addStakerRewards
        entity.updateRewardSplitter(address(splitter)); // first-class wiring: grants REWARD_SPLITTER_ROLE
        splitter.updateRewardVestingDuration(7 days);
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

    function _stakerLocked(uint256 id) internal view returns (uint256) {
        return entity.entityStakerLockedRewardPool(id);
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

        uint256 la = _stakerLocked(a);
        uint256 lb = _stakerLocked(b);

        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        assertEq(_stakerLocked(a), la, "no payout for first-seen A");
        assertEq(_stakerLocked(b), lb, "no payout for first-seen B");
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

        uint256 la = _stakerLocked(a);
        uint256 lb = _stakerLocked(b);
        uint256 budget = 100 ether;

        vm.prank(owner);
        splitter.distribute(budget, _ids(a, b));

        uint256 shareA = _stakerLocked(a) - la;
        uint256 shareB = _stakerLocked(b) - lb;

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

        uint256 la = _stakerLocked(a);
        uint256 lb = _stakerLocked(b);

        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        uint256 shareA = _stakerLocked(a) - la;
        uint256 shareB = _stakerLocked(b) - lb;

        // the flash added ~0 stake-seconds (0 elapsed time), so A ~= B
        assertApproxEqRel(shareA, shareB, 1e15, "flash stake did not inflate A's share");
    }

    // ---- settlement invariance: early processRewards cannot inflate weight ----
    //
    // Two entities with identical stake and identical APY-funded rewards. A's
    // operator calls processRewards aggressively (settling its drip into
    // activeRewardPool early and often); B is left untouched until distribution.
    // Under the old activeRewardPool-based metric this let A out-earn B for free.
    // With principal-seconds the split is settlement-invariant, so A ~= B.
    function test_earlySettlementDoesNotInflateSplitShare() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        _stake(a, 100 ether);
        _stake(b, 100 ether);

        // fund identical APY rewards on both and crank the rate so the drip is large
        vm.startPrank(owner);
        entity.addRewards{value: 100 ether}(a);
        entity.addRewards{value: 100 ether}(b);
        entity.updateEntityMaxAPY(a, 100e18);
        entity.updateEntityMaxAPY(b, 100e18);
        vm.stopPrank();

        // round 1: baselines
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b));

        // the round: A is settled every day, B is never settled
        for (uint256 d = 0; d < 20; d++) {
            vm.warp(block.timestamp + 1 days);
            entity.processRewards(a); // aggressive early settlement of A's drip
        }

        // A's activeRewardPool is now far larger than B's (its rewards vested in),
        // yet its committed principal is identical -> weights must match.
        assertGt(entity.entities(a).activeRewardPool, entity.entities(b).activeRewardPool, "A settled, B did not");
        assertApproxEqRel(splitter.pendingWeight(a), splitter.pendingWeight(b), 1e12, "equal principal-seconds");

        uint256 la = _stakerLocked(a);
        uint256 lb = _stakerLocked(b);
        uint256 budget = 100 ether;

        vm.prank(owner);
        splitter.distribute(budget, _ids(a, b));

        uint256 shareA = _stakerLocked(a) - la;
        uint256 shareB = _stakerLocked(b) - lb;

        // settlement cadence bought A nothing: the split is ~50/50
        assertApproxEqRel(shareA, shareB, 1e12, "early settlement did not inflate A's share");
        assertApproxEqAbs(shareA + shareB, budget, 2, "conserved minus dust");
    }

    // ---- guards ----

    function test_rejectsBudgetOverBalance() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBudget.selector);
        splitter.distribute(address(splitter).balance + 1, _ids(a, b));
    }

    function test_distributeRevertsWhenVestingDurationUnset() public {
        // a fresh splitter with no vesting duration set
        RewardSplitterImplementation ri2 = new RewardSplitterImplementation();
        RewardSplitterImplementation s2 = RewardSplitterImplementation(
            payable(
                new RewardSplitterProxy(
                    address(ri2),
                    abi.encodeCall(RewardSplitterImplementation.initialize, (owner, address(entity)))
                )
            )
        );
        vm.deal(address(s2), 100 ether);
        uint256 a = _createEntity("pool-x");
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.VestingDurationNotSet.selector);
        s2.distribute(10 ether, _ids(a, a));
    }

    function test_onlyDistributorCanDistribute() public {
        uint256 a = _createEntity("pool-a");
        uint256 b = _createEntity("pool-b");
        vm.prank(stranger);
        vm.expectRevert();
        splitter.distribute(100 ether, _ids(a, b));
    }

    // ---- burn ----

    function _twoRoundsWithBurn(uint256 rate) internal returns (uint256 a, uint256 b, uint256 shareSum) {
        a = _createEntity("pool-a");
        b = _createEntity("pool-b");
        _stake(a, 100 ether);
        _stake(b, 100 ether);

        vm.startPrank(owner);
        splitter.updateBurnRate(rate);
        vm.warp(block.timestamp + 1 days);
        splitter.distribute(100 ether, _ids(a, b)); // round 1: baselines only
        vm.stopPrank();

        vm.warp(block.timestamp + 10 days);
        uint256 la = _stakerLocked(a);
        uint256 lb = _stakerLocked(b);

        vm.prank(owner);
        splitter.distribute(100 ether, _ids(a, b)); // round 2: burn + entity split

        shareSum = (_stakerLocked(a) - la) + (_stakerLocked(b) - lb);
    }

    function test_burnAccruesAndEntitiesGetRemainder() public {
        uint256 zeroBefore = address(0).balance;
        (, , uint256 shareSum) = _twoRoundsWithBurn(10e18); // 10%

        assertEq(splitter.pendingBurn(), 10 ether, "10% of the 100 budget accrued to burn");
        assertApproxEqAbs(shareSum, 90 ether, 2, "entities split the remaining 90 (minus dust)");
        assertEq(address(0).balance, zeroBefore, "not burned yet");
    }

    function test_executeBurnSendsToZeroAddress() public {
        uint256 zeroBefore = address(0).balance;
        _twoRoundsWithBurn(10e18);
        assertEq(splitter.pendingBurn(), 10 ether);

        splitter.executeBurn(); // permissionless
        assertEq(address(0).balance - zeroBefore, 10 ether, "burned to the zero address");
        assertEq(splitter.pendingBurn(), 0, "reserve cleared");
    }

    function test_noBurnWhenUnconfigured() public {
        (, , uint256 shareSum) = _twoRoundsWithBurn(0); // rate 0
        assertEq(splitter.pendingBurn(), 0, "no burn accrued");
        assertApproxEqAbs(shareSum, 100 ether, 2, "entities split the full budget");
    }

    function test_burnRateCap() public {
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBurnRate.selector);
        splitter.updateBurnRate(100e18 + 1); // > 100%
    }

    function test_withdrawCannotTouchPendingBurn() public {
        _twoRoundsWithBurn(10e18); // pendingBurn = 10
        uint256 free = address(splitter).balance - splitter.pendingBurn();
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBudget.selector);
        splitter.withdraw(payable(owner), free + 1);
    }

    // ---- ERC-20 reward inlet ----

    function _token() internal returns (MockERC20 t) {
        t = new MockERC20();
        t.mint(stranger, 1_000 ether);
    }

    function test_fundTokenRewardPullsAndRecords() public {
        MockERC20 t = _token();
        vm.startPrank(stranger);
        t.approve(address(splitter), 100 ether);
        splitter.fundTokenReward(address(t), 100 ether);
        vm.stopPrank();

        assertEq(t.balanceOf(address(splitter)), 100 ether, "tokens pulled in");
        assertEq(splitter.pendingConversion(address(t)), 100 ether, "recorded");
    }

    function test_fundTokenRewardRejectsZeroTokenAndAmount() public {
        MockERC20 t = _token();
        vm.startPrank(stranger);
        vm.expectRevert(RewardSplitterImplementation.InvalidAddress.selector);
        splitter.fundTokenReward(address(0), 1 ether);
        vm.expectRevert(RewardSplitterImplementation.InvalidAmount.selector);
        splitter.fundTokenReward(address(t), 0);
        vm.stopPrank();
    }

    function test_sendToConverterForwardsAndDecrements() public {
        MockERC20 t = _token();
        address convertor = makeAddr("convertor");

        vm.startPrank(stranger);
        t.approve(address(splitter), 100 ether);
        splitter.fundTokenReward(address(t), 100 ether);
        vm.stopPrank();

        vm.startPrank(owner);
        splitter.updateConverter(convertor);
        splitter.sendToConverter(address(t), 60 ether);
        vm.stopPrank();

        assertEq(t.balanceOf(convertor), 60 ether, "forwarded to converter");
        assertEq(splitter.pendingConversion(address(t)), 40 ether, "record decremented");
    }

    function test_sendToConverterGuards() public {
        MockERC20 t = _token();
        vm.startPrank(stranger);
        t.approve(address(splitter), 100 ether);
        splitter.fundTokenReward(address(t), 100 ether);
        vm.stopPrank();

        // no converter set yet
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidAddress.selector);
        splitter.sendToConverter(address(t), 10 ether);

        vm.prank(owner);
        splitter.updateConverter(makeAddr("convertor"));

        // more than recorded
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBudget.selector);
        splitter.sendToConverter(address(t), 100 ether + 1);

        // not a maintainer
        vm.prank(stranger);
        vm.expectRevert();
        splitter.sendToConverter(address(t), 10 ether);
    }

    function test_updateConverterAccessAndZeroAddress() public {
        vm.prank(stranger);
        vm.expectRevert();
        splitter.updateConverter(makeAddr("convertor"));

        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidAddress.selector);
        splitter.updateConverter(address(0));
    }

    function test_returnedVanaIsDistributable() public {
        // full loop: fund ERC-20 -> converter -> converter returns VANA -> distribute
        MockERC20 t = _token();
        address convertor = makeAddr("convertor");

        vm.startPrank(stranger);
        t.approve(address(splitter), 100 ether);
        splitter.fundTokenReward(address(t), 100 ether);
        vm.stopPrank();

        vm.startPrank(owner);
        splitter.updateConverter(convertor);
        splitter.sendToConverter(address(t), 100 ether);
        vm.stopPrank();

        // converter swaps off-chain and returns native VANA to receive()
        uint256 balBefore = address(splitter).balance;
        vm.deal(convertor, 50 ether);
        vm.prank(convertor);
        (bool ok, ) = address(splitter).call{value: 50 ether}("");
        assertTrue(ok, "converter returns VANA");
        assertEq(address(splitter).balance, balBefore + 50 ether, "distributable balance grew");
    }

    function test_recoverTokenOnlyExcessNotRecorded() public {
        MockERC20 t = _token();

        // record 100 via fundTokenReward
        vm.startPrank(stranger);
        t.approve(address(splitter), 100 ether);
        splitter.fundTokenReward(address(t), 100 ether);
        // plus 30 sent directly (untracked airdrop-style)
        t.transfer(address(splitter), 30 ether);
        vm.stopPrank();

        // cannot touch the recorded reserve
        vm.prank(owner);
        vm.expectRevert(RewardSplitterImplementation.InvalidBudget.selector);
        splitter.recoverToken(address(t), owner, 30 ether + 1);

        // can sweep exactly the untracked excess
        vm.prank(owner);
        splitter.recoverToken(address(t), owner, 30 ether);
        assertEq(t.balanceOf(owner), 30 ether, "excess recovered");
        assertEq(splitter.pendingConversion(address(t)), 100 ether, "reserve intact");
    }
    // ---- receive(): a zero-value call funds nothing and emits nothing ----

    function test_zeroValueFundingEmitsNoEvent() public {
        vm.recordLogs();
        (bool ok, ) = address(splitter).call{value: 0}("");
        assertTrue(ok, "zero-value call is accepted");
        assertEq(vm.getRecordedLogs().length, 0, "no Funded event to spam");

        vm.recordLogs();
        (ok, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(vm.getRecordedLogs().length, 1, "real funding still emits Funded");
    }
}
