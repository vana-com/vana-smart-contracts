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
import {VanaPoolLens} from "../../contracts/vanaStaking/vanaPoolLens/VanaPoolLens.sol";

/// @notice VanaPoolLens.entityAPY: net-of-commission forward rate from both
///         reward tracks, checked against the entity's own views and against
///         the share-price growth the pool actually delivers. Absolute (T0-based)
///         timestamps: inline block.timestamp warps go stale under viaIR.
contract VanaPoolLensTest is Test {
    VanaPoolLens lens;
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner"); // maintainer
    address reg = makeAddr("registrant"); // entity owner
    address alice = makeAddr("alice"); // plain staker

    uint256 constant MIN_REG_STAKE = 1 ether;
    uint256 constant BOND = 7 days;
    uint256 constant COMMISSION = 10e18; // 10%
    uint256 constant T0 = 1_000_000;

    uint256 apy;
    uint256 str;

    function setUp() public {
        vm.warp(T0);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(address(si),
                abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1e15))))
        );
        entity = VanaPoolEntityImplementation(
            payable(new VanaPoolEntityProxy(address(ei),
                abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), MIN_REG_STAKE, 6e18))))
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(new VanaPoolTreasuryProxy(address(ti),
                abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))))
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(BOND);
        treasury.updateVanaPoolEntity(address(entity));
        vm.stopPrank();

        vm.deal(owner, 10_000 ether);
        vm.deal(reg, 10_000 ether);
        vm.deal(alice, 10_000 ether);

        apy = _createEntity("apy-entity", IVanaPoolEntity.RewardModel.APY);
        str = _createEntity("stream-entity", IVanaPoolEntity.RewardModel.STREAM);
        _setCommission(apy, COMMISSION);
        _setCommission(str, COMMISSION);
        lens = new VanaPoolLens(IVanaPoolEntity(address(entity)));
    }

    function _createEntity(string memory name, IVanaPoolEntity.RewardModel model) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: MIN_REG_STAKE}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: reg, name: name}),
            model
        );
        id = entity.entitiesCount();
    }

    /// @dev Commission increases are two-phase: owner proposes, maintainer approves.
    function _setCommission(uint256 id, uint256 rate) internal {
        vm.prank(reg);
        entity.proposeCommissionRate(id, rate);
        vm.prank(owner);
        entity.approveCommissionRate(id, rate);
    }

    function _price(uint256 id) internal view returns (uint256) {
        return entity.entityShareToVana(id);
    }

    /// @dev Annualised simple growth of the share price between two readings.
    function _annualised(uint256 p0, uint256 p1, uint256 dt) internal pure returns (uint256) {
        return ((p1 - p0) * 100e18 * 365 days) / (p0 * dt);
    }

    // ---- owner track, APY model ----

    function test_apyOwnerTrack_grossMatchesEntityView_netIsCompoundedNetRate() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(reg);
        entity.addRewards{value: 1_000 ether}(apy);
        vm.prank(owner);
        entity.updateEntityMaxAPY(apy, 40e18);
        entity.processRewards(apy);

        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        assertApproxEqRel(r.ownerGrossAPY, entity.currentAPYByEntity(apy), 1e12, "gross == currentAPYByEntity");
        assertApproxEqRel(r.ownerGrossAPY, 49.1824697e18, 1e12, "e^0.40 - 1");
        assertApproxEqRel(r.ownerNetAPY, 43.3329415e18, 1e12, "e^(0.40*0.9) - 1");
        assertLt(r.ownerNetAPY, (r.ownerGrossAPY * 90) / 100, "not the naive gross*(1-c)");
        assertEq(r.splitterAPY, 0);
        assertEq(r.apy, r.ownerNetAPY);

        // Realised: settle daily for a year; growth must match the quoted net rate.
        uint256 p0 = _price(apy);
        for (uint256 d = 1; d <= 365; d++) {
            vm.warp(T0 + d * 1 days);
            entity.processRewards(apy);
        }
        uint256 realised = ((_price(apy) - p0) * 100e18) / p0;
        assertApproxEqRel(realised, r.ownerNetAPY, 2e15, "a year of daily settlements delivers the quoted net rate");
    }

    function test_apyOwnerTrack_zeroWithoutReserve() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        assertEq(r.apy, 0, "maxAPY is a cap, not a yield: no reserve, no rate");
        assertEq(r.ownerFundedUntil, 0);
        assertGt(r.activePool, 0);
    }

    function test_apyOwnerTrack_fundedUntilExposesAThinReserve() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(reg);
        entity.addRewards{value: 0.01 ether}(apy);
        vm.prank(owner);
        entity.updateEntityMaxAPY(apy, 40e18);

        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        assertGt(r.ownerNetAPY, 40e18, "pays the full rate right now");
        // 0.01 VANA against ~49.7 VANA/yr of drip: under two hours of runway.
        assertLt(r.ownerFundedUntil, block.timestamp + 2 hours, "runway shows the rate is about to stop");
        assertGt(r.ownerFundedUntil, block.timestamp);
    }

    // ---- owner track, STREAM model ----

    function test_streamOwnerTrack_netOfCommissionAndRealised() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(str, alice, 0);
        vm.prank(reg);
        entity.distributeRewards{value: 30 ether}(str, 30 ether, uint64(T0), 30 days);
        vm.warp(T0 + 1 hours);
        entity.processRewards(str);

        VanaPoolLens.EntityAPY memory r = lens.entityAPY(str);
        assertApproxEqRel(r.ownerGrossAPY, entity.currentAPYByEntity(str), 1e12, "gross == currentAPYByEntity");
        assertEq(r.ownerNetAPY, (r.ownerGrossAPY * 90) / 100, "linear: net = gross * (1 - 10%)");
        assertEq(r.ownerFundedUntil, T0 + 30 days, "reserve covers the whole entry");

        uint256 p0 = _price(str);
        vm.warp(T0 + 1 hours + 1 days);
        entity.processRewards(str);
        assertApproxEqRel(_annualised(p0, _price(str), 1 days), r.ownerNetAPY, 5e15, "one day delivers the quoted rate");
    }

    // ---- splitter track ----

    function _fundSplitterTrack(uint256 id, uint256 amount, uint32 duration) internal {
        vm.prank(owner);
        entity.updateRewardSplitter(address(this));
        entity.addStakerRewards{value: amount}(id, true, duration);
    }

    function test_splitterTrack_isAlreadyNetOfCommission() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0); // APY entity, no reserve: splitter is the only source
        _fundSplitterTrack(apy, 30 ether, 30 days);

        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        uint256 expected = (27 ether * 365 days * 100e18) / (30 days * r.activePool); // 10% taken at funding
        assertEq(r.splitterAPY, expected, "net amount annualised, commission not deducted twice");
        assertEq(r.ownerNetAPY, 0);
        assertEq(r.apy, r.splitterAPY);
        assertEq(r.splitterEndsAt, T0 + 30 days);

        uint256 p0 = _price(apy);
        vm.warp(T0 + 1 days);
        entity.processRewards(apy);
        assertApproxEqRel(_annualised(p0, _price(apy), 1 days), r.splitterAPY, 5e15, "one day delivers the quoted rate");
    }

    function test_splitterTrack_zeroOnceTheWindowEnds() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        _fundSplitterTrack(apy, 30 ether, 30 days);
        vm.warp(T0 + 31 days);
        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        assertEq(r.splitterAPY, 0);
        assertEq(r.splitterEndsAt, 0);
    }

    function test_bothTracks_add() public {
        vm.prank(alice);
        staking.stake{value: 100 ether}(apy, alice, 0);
        vm.prank(reg);
        entity.addRewards{value: 1_000 ether}(apy);
        vm.prank(owner);
        entity.updateEntityMaxAPY(apy, 40e18);
        _fundSplitterTrack(apy, 30 ether, 30 days);

        VanaPoolLens.EntityAPY memory r = lens.entityAPY(apy);
        assertGt(r.ownerNetAPY, 0);
        assertGt(r.splitterAPY, 0);
        assertEq(r.apy, r.ownerNetAPY + r.splitterAPY);

        uint256[] memory ids = new uint256[](2);
        ids[0] = apy;
        ids[1] = str;
        VanaPoolLens.EntityAPY[] memory all = lens.entityAPYs(ids);
        assertEq(all[0].apy, r.apy, "batch == single");
        assertEq(all[1].apy, 0, "str: no stake, no rewards");
    }

    function test_unknownEntityIsZero() public {
        VanaPoolLens.EntityAPY memory r = lens.entityAPY(999);
        assertEq(r.apy, 0);
        assertEq(r.activePool, 0);
    }
}
