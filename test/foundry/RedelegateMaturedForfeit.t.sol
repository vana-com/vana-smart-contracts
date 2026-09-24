// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @notice Demonstrates that redelegating a bonded position INTO a matured one
///         puts the matured position's already-earned gain at risk (scenario 1),
///         while the manual unstake-B-then-stake-A path does not (scenario 3).
contract RedelegateMaturedForfeitTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;

    address owner = makeAddr("owner");
    address entityOwner = makeAddr("entityOwner");
    address staker = makeAddr("staker");

    function setUp() public {
        vm.warp(1_000_000);
        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(new VanaPoolStakingProxy(address(si),
                abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1e15))))
        );
        entity = VanaPoolEntityImplementation(
            payable(new VanaPoolEntityProxy(address(ei),
                abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), 1 ether, 6e18))))
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(new VanaPoolTreasuryProxy(address(ti),
                abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))))
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(30 days);
        treasury.updateVanaPoolEntity(address(entity));
        vm.stopPrank();

        vm.deal(owner, 100_000 ether);
        vm.deal(staker, 100_000 ether);
    }

    function _createEntity(string memory name) internal returns (uint256 id) {
        vm.prank(owner);
        entity.createEntity{value: 1 ether}(
            IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entityOwner, name: name})
        );
        id = entity.entitiesCount();
    }

    function _shares(uint256 id) internal view returns (uint256) {
        return staking.stakerEntities(staker, id).shares;
    }
    function _value(uint256 id) internal view returns (uint256) {
        return (_shares(id) * entity.entityShareToVana(id)) / 1e18;
    }

    /// @dev Build: A matured with an earned gain; B a fresh bonded stake.
    function _build() internal returns (uint256 a, uint256 b, uint256 aGain) {
        a = _createEntity("pool-a");
        // fund A and run a high APY so it appreciates
        vm.startPrank(owner);
        entity.addRewards{value: 200 ether}(a);
        entity.updateEntityMaxAPY(a, 100e18);
        vm.stopPrank();

        vm.prank(staker);
        staking.stake{value: 100 ether}(a, staker, 0);

        // mature A (past the 30-day bond) and let it drip
        vm.warp(block.timestamp + 200 days);
        entity.processRewards(a);
        aGain = _value(a) - 100 ether; // earned gain now safe (A matured)

        // B: a fresh bonded stake, no gain
        b = _createEntity("pool-b");
        vm.prank(staker);
        staking.stake{value: 100 ether}(b, staker, 0);
    }

    function test_scenario1_redelegateBintoA() public {
        (uint256 a, uint256 b, uint256 aGain) = _build();
        uint256 fullValue = _value(a) + _value(b);

        // move B into A (read shares before pranking; a call in args eats the prank)
        uint256 bShares = _shares(b);
        vm.prank(staker);
        staking.redelegate(b, a, bShares, 0);

        // exit A DURING the newly imposed bond
        uint256 bal0 = staker.balance;
        uint256 aShares = _shares(a);
        vm.prank(staker);
        staking.unstake(a, aShares, 0);
        uint256 payout = staker.balance - bal0;

        console.log("A matured gain:        ", aGain);
        console.log("full position value:   ", fullValue);
        console.log("scenario 1 payout:     ", payout);
        console.log("forfeited:             ", fullValue - payout);

        // the matured gain must survive the redelegation (before the fix, ~aGain
        // was forfeited and payout was fullValue - aGain)
        assertGt(aGain, 1 ether, "A has a meaningful matured gain to protect");
        assertApproxEqAbs(payout, fullValue, 1e9, "redelegate preserves A's matured gain (no forfeiture)");
    }

    function test_scenario3_unstakeBthenStakeA() public {
        (uint256 a, uint256 b, uint256 aGain) = _build();
        uint256 fullValue = _value(a) + _value(b);

        uint256 bal0 = staker.balance;
        // unstake B (bonded, no gain -> returns principal), then stake it into A
        uint256 bShares = _shares(b);
        vm.prank(staker);
        staking.unstake(b, bShares, 0);
        vm.prank(staker);
        staking.stake{value: 100 ether}(a, staker, 0);
        // exit A DURING the newly imposed bond
        uint256 aShares = _shares(a);
        vm.prank(staker);
        staking.unstake(a, aShares, 0);
        uint256 payout = staker.balance - bal0;

        console.log("A matured gain:        ", aGain);
        console.log("full position value:   ", fullValue);
        console.log("scenario 3 payout:     ", payout);
        console.log("forfeited:             ", fullValue > payout ? fullValue - payout : 0);

        // the manual path always preserved the matured gain (baseline for parity)
        assertApproxEqAbs(payout, fullValue, 1e9, "manual path preserves full value");
    }
}
