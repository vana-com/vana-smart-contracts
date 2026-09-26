// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Bare harness that lets us set an entity's activeRewardPool/totalShares
///      directly, to unit-test the share-conversion math (Fix 1).
contract SharesHarness is VanaPoolEntityImplementation {
    function seed(uint256 id, uint256 active, uint256 totalShares) external {
        IVanaPoolEntity.Entity storage e = _entities[id];
        e.status = IVanaPoolEntity.EntityStatus.Active;
        e.activeRewardPool = active;
        e.totalShares = totalShares;
    }
}

contract VanaToSharesTest is Test {
    SharesHarness h;
    uint256 constant ID = 1;

    function setUp() public {
        h = new SharesHarness();
    }

    /// @notice Single division avoids the (m-1)/m under-issuance the two-step
    ///         (floored rate) form produces when the rate sits just below m.
    function test_singleDivisionAvoidsRateFloorUnderIssuance() public {
        // 2000 shares against ~1000 VANA: true rate ~2, two-step floors it to 1.
        uint256 active = 1000 ether + 2000;
        h.seed(ID, active, 2000);
        assertEq(h.vanaToEntityShare(ID), 1, "two-step rate floors to 1");

        uint256 deposit = 1414 ether;
        uint256 shares = h.vanaToShares(ID, deposit);

        // exact single division: deposit * totalShares / active
        assertEq(shares, (deposit * 2000) / active, "single-division result");

        // the two-step form under-issues by ~half
        uint256 twoStep = (h.vanaToEntityShare(ID) * deposit) / 1e18;
        assertApproxEqRel(shares, 2 * twoStep, 1e15, "single division issues ~2x the floored two-step");
    }

    function test_ordinaryRateMatchesTwoStep() public {
        // price 1.0: both forms agree
        h.seed(ID, 1000 ether, 1000 ether);
        assertEq(h.vanaToShares(ID, 7 ether), 7 ether, "1:1 at price 1.0");
    }

    function test_bootstrapPrices1to1() public {
        h.seed(ID, 0, 0); // empty pool
        assertEq(h.vanaToShares(ID, 42 ether), 42 ether, "1:1 bootstrap when empty");
    }

    function testFuzz_neverUnderIssuesVersusTwoStep(uint96 active, uint96 totalShares, uint96 deposit) public {
        active = uint96(bound(active, 1, type(uint96).max));
        totalShares = uint96(bound(totalShares, 1, type(uint96).max));
        h.seed(ID, active, totalShares);

        uint256 single = h.vanaToShares(ID, deposit);
        uint256 twoStep = (((uint256(totalShares) * 1e18) / active) * deposit) / 1e18;
        // single division is always >= the floored two-step (never under-issues)
        assertGe(single, twoStep, "single division never issues fewer shares");
    }
}
