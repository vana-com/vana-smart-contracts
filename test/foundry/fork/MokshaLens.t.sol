// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {
    VanaPoolEntityImplementation
} from "../../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {
    RewardSplitterImplementation
} from "../../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";
import {IVanaPoolEntity} from "../../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";
import {VanaPoolLens} from "../../../contracts/vanaStaking/vanaPoolLens/VanaPoolLens.sol";

/// @notice VanaPoolLens against the real Moksha contracts and state, forked at
///         Moksha's last block before the 2026-09-30 halt (nothing is broadcast).
///         The lens is created through the same CREATE2 factory and salt as the
///         deploy script, so this also proves the cross-chain address. Run with:
///           MOKSHA_FORK=1 forge test --match-path test/foundry/fork/MokshaLens.t.sol -vv
///         Skipped otherwise so the default suite stays network-free.
contract MokshaLensTest is Test {
    VanaPoolEntityImplementation constant entity =
        VanaPoolEntityImplementation(payable(0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30));
    RewardSplitterImplementation constant splitter =
        RewardSplitterImplementation(payable(0x7A7B89b6925A8156b9A51E520327c0701023b344));
    address constant admin = 0x2AC93684679a5bdA03C6160def908CdB8D46792f; // maintainer, pool owner, splitter admin
    address constant PREDICTED_LENS = 0x6F800Be40cc91bcFb9e0b64809B16009Ec157B7d; // Moksha == mainnet

    uint256 constant SNAPSHOT_BLOCK = 9_268_411; // last Moksha block before the halt
    uint256 constant SNAPSHOT_TS = 1_790_769_120; // 2026-09-30 11:52:00 UTC
    uint256 constant BASALT = 2;

    VanaPoolLens lens;

    function setUp() public {
        if (!vm.envOr("MOKSHA_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("MOKSHA_RPC_URL", string("https://rpc.moksha.vana.org")), SNAPSHOT_BLOCK);
        assertEq(block.timestamp, SNAPSHOT_TS, "pinned snapshot");

        // Exactly what `deploy --tags VanaPoolLensDeploy` sends: salt ++ initcode to the
        // factory. The initcode is the HARDHAT artifact's (the deploy script's): forge's
        // own build embeds different metadata and would land at another address.
        // Needs `npx hardhat compile` first.
        bytes memory creation = vm.parseJsonBytes(
            vm.readFile("artifacts/contracts/vanaStaking/vanaPoolLens/VanaPoolLens.sol/VanaPoolLens.json"),
            ".bytecode"
        );
        bytes memory init = abi.encodePacked(creation, abi.encode(address(entity)));
        (bool ok, ) = CREATE2_FACTORY.call(abi.encodePacked(keccak256("VanaPoolLens-v1"), init));
        assertTrue(ok, "factory deploy");
        lens = VanaPoolLens(PREDICTED_LENS);
        vm.deal(admin, 1_000 ether);
    }

    function _pct(uint256 x) internal pure returns (string memory) {
        uint256 frac = (x % 1e18) / 1e14; // 4 decimals, zero-padded
        string memory pad = frac < 10 ? "000" : frac < 100 ? "00" : frac < 1000 ? "0" : "";
        return string.concat(vm.toString(x / 1e18), ".", pad, vm.toString(frac), "%");
    }

    function _log(uint256 id, VanaPoolLens.EntityAPY memory r) internal pure {
        console.log(string.concat(
            "  entity ", vm.toString(id), ": apy ", _pct(r.apy), " = owner net ", _pct(r.ownerNetAPY),
            " (gross ", _pct(r.ownerGrossAPY), ", compounded ", _pct(r.ownerNetEffectiveAPY), ") + splitter ", _pct(r.splitterAPY)
        ));
    }

    function test_deployedAtThePredictedCrossChainAddress() public view {
        assertGt(PREDICTED_LENS.code.length, 0, "code at the predicted address");
        assertEq(address(lens.vanaPoolEntity()), address(entity));
    }

    /// @dev The four live pools as they stand: each field against the entity's own getters.
    function test_livePools_matchTheEntityViews() public view {
        uint256 n = entity.entitiesCount();
        uint256[] memory ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = i + 1;
        VanaPoolLens.EntityAPY[] memory all = lens.entityAPYs(ids);

        for (uint256 i = 0; i < n; i++) {
            uint256 id = ids[i];
            VanaPoolLens.EntityAPY memory r = all[i];
            _log(id, r);
            IVanaPoolEntity.EntityInfo memory info = entity.entities(id);
            uint256 c = entity.entityCommissionRate(id);

            assertEq(r.apy, r.ownerNetAPY + r.splitterAPY, "components add");
            assertEq(r.activePool, entity.previewActiveRewardPool(id), "denominator");
            if (info.lockedRewardPool == 0) {
                assertEq(r.ownerGrossAPY, 0, "no reserve, no owner rate");
            } else if (entity.entityRewardModel(id) == IVanaPoolEntity.RewardModel.APY) {
                assertEq(r.ownerGrossAPY, info.maxAPY, "gross = maxAPY");
                assertEq(r.ownerNetAPY, (info.maxAPY * (100e18 - c)) / 100e18, "net = maxAPY * (1 - c)");
                if (c == 0) {
                    assertApproxEqRel(r.ownerNetEffectiveAPY, entity.currentAPYByEntity(id), 1e12, "compounded == currentAPYByEntity");
                }
            }
            VanaPoolLens.EntityAPY memory single = lens.entityAPY(id);
            assertEq(single.apy, r.apy, "batch == single");
        }
    }

    /// @dev Fund Basalt on both tracks through the real admin, then check the
    ///      headline against what the pool actually delivers over the next day.
    function test_fundedBasalt_headlineEqualsRealisedGrowth() public {
        uint256 c = entity.entityCommissionRate(BASALT);
        IVanaPoolEntity.EntityInfo memory info = entity.entities(BASALT);
        console.log("Basalt: maxAPY", info.maxAPY / 1e18, "% commission", c / 1e18);

        // Owner track: 10 VANA of reserve.
        vm.prank(admin);
        entity.addRewards{value: 10 ether}(BASALT);

        // Splitter track: 3 VANA over 30 days (baseline round, then a paying round).
        vm.startPrank(admin);
        (bool funded, ) = address(splitter).call{value: 3 ether}("");
        assertTrue(funded);
        splitter.updateRewardVestingDuration(30 days);
        uint256 burnBefore = splitter.burnRate();
        splitter.updateBurnRate(0);
        uint256[] memory ids = new uint256[](1);
        ids[0] = BASALT;
        splitter.distribute(1, ids);
        vm.warp(SNAPSHOT_TS + 1 hours);
        splitter.distribute(3 ether, ids);
        vm.stopPrank();
        console.log("  (splitter burn rate on Moksha was", burnBefore / 1e18, "%; set to 0 for this check)");

        entity.processRewards(BASALT);
        VanaPoolLens.EntityAPY memory r = lens.entityAPY(BASALT);
        _log(BASALT, r);

        assertEq(r.ownerGrossAPY, info.maxAPY);
        assertEq(r.ownerNetAPY, (info.maxAPY * (100e18 - c)) / 100e18);
        uint256 netSplit = 3 ether - (3 ether * c) / 100e18; // commission taken at funding
        assertEq(r.splitterAPY, (netSplit * 365 days * 100e18) / (30 days * r.activePool), "splitter: net amount, not re-discounted");
        assertEq(r.splitterEndsAt, SNAPSHOT_TS + 1 hours + 30 days);
        assertGt(r.ownerFundedUntil, block.timestamp);

        uint256 p0 = entity.entityShareToVana(BASALT);
        vm.warp(SNAPSHOT_TS + 1 hours + 1 days);
        entity.processRewards(BASALT);
        uint256 p1 = entity.entityShareToVana(BASALT);
        uint256 realised = ((p1 - p0) * 100e18 * 365) / p0;
        console.log(string.concat("  realised over the next day, annualised: ", _pct(realised), "   lens: ", _pct(r.apy)));
        assertApproxEqRel(realised, r.apy, 1e15, "headline == realised growth (0.1%)");
    }
}
