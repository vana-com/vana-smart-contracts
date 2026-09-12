// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DepositContractSeeded} from "../contracts/chain/l1Deposit/DepositContractSeeded.sol";

/// @notice Deploys DepositContractSeeded seeded with the live state of an
///         existing deposit contract, read on-chain at simulation time via
///         eth_getStorageAt (slots 0..31 = branch, slot 32 = deposit_count).
///         Because the source contract on Vana mainnet was disabled by
///         upgrading it to a revert-all implementation, its storage is frozen,
///         so reading at `latest` is exact.
///
///         After deployment the script re-reads the new contract and asserts
///         count and every branch slot round-tripped, and — when
///         EXPECTED_DEPOSIT_ROOT is set — that get_deposit_root() matches it.
///
/// Environment:
///   SOURCE_DEPOSIT_CONTRACT  address of the contract to copy state from
///                            (mainnet: 0x17BbE91c315Bf14f38F6D35052a827cadfFe184e)
///   DEPOSIT_CONTRACT_OWNER   owner of the new contract
///   MIN_DEPOSIT_AMOUNT       minimum deposit in wei
///   RESTRICTED               optional bool, default false
///   ALLOWED_VALIDATORS       optional comma-separated 48-byte hex pubkeys
///   EXPECTED_DEPOSIT_ROOT    optional bytes32; mainnet pre-brick root:
///                            0x60dff8f6a92d68799e7653acdcefa253a1c2603b4dd071d8265491b465172401
///
/// Usage:
///   # dry run (simulation only)
///   forge script script/DeployDepositContractSeeded.s.sol --rpc-url $VANA_RPC_URL
///
///   # deploy
///   forge script script/DeployDepositContractSeeded.s.sol \
///     --rpc-url $VANA_RPC_URL --broadcast --account <keystore-account>
contract DeployDepositContractSeeded is Script {
    uint constant TREE_DEPTH = 32;
    uint constant DEPOSIT_COUNT_SLOT = 32;

    function run() external returns (DepositContractSeeded deployed) {
        // ---- read configuration ----
        address source = vm.envAddress("SOURCE_DEPOSIT_CONTRACT");
        address owner = vm.envAddress("DEPOSIT_CONTRACT_OWNER");
        uint256 minDepositAmount = vm.envUint("MIN_DEPOSIT_AMOUNT");
        bool restricted = vm.envOr("RESTRICTED", false);
        bytes32 expectedRoot = vm.envOr("EXPECTED_DEPOSIT_ROOT", bytes32(0));
        bytes[] memory allowedValidators = _parseAllowedValidators();

        // ---- read seed state from the source contract ----
        require(source.code.length > 0, "source has no code - wrong address?");
        uint256 count = uint256(vm.load(source, bytes32(DEPOSIT_COUNT_SLOT)));
        // A zero count means the source holds no deposits; this script exists
        // for migrations, so treat that as a mis-configured address.
        require(count > 0, "source deposit_count is zero - wrong address?");

        bytes32[TREE_DEPTH] memory branch;
        for (uint i = 0; i < TREE_DEPTH; i++) {
            branch[i] = vm.load(source, bytes32(i));
        }

        console2.log("source:            ", source);
        console2.log("seed deposit_count:", count);
        console2.log("owner:             ", owner);
        console2.log("minDepositAmount:  ", minDepositAmount);
        console2.log("restricted:        ", restricted);
        console2.log("allowed validators:", allowedValidators.length);

        // ---- deploy ----
        vm.startBroadcast();
        deployed = new DepositContractSeeded(
            count, branch, minDepositAmount, owner, restricted, allowedValidators
        );
        vm.stopBroadcast();

        // ---- verify the seed took effect ----
        require(_depositCount(deployed) == count, "deployed count mismatch");
        for (uint i = 0; i < TREE_DEPTH; i++) {
            require(deployed.get_branch(i) == branch[i], "deployed branch mismatch");
        }
        bytes32 root = deployed.get_deposit_root();
        if (expectedRoot != bytes32(0)) {
            require(root == expectedRoot, "deposit root does not match EXPECTED_DEPOSIT_ROOT");
        } else {
            console2.log("WARNING: EXPECTED_DEPOSIT_ROOT not set; root not checked");
        }

        console2.log("deployed:          ", address(deployed));
        console2.log("deposit root:");
        console2.logBytes32(root);
    }

    /// @dev Parse ALLOWED_VALIDATORS ("0x...,0x...") into 48-byte pubkeys.
    function _parseAllowedValidators() internal view returns (bytes[] memory keys) {
        string memory raw = vm.envOr("ALLOWED_VALIDATORS", string(""));
        if (bytes(raw).length == 0) return new bytes[](0);
        string[] memory parts = vm.split(raw, ",");
        keys = new bytes[](parts.length);
        for (uint i = 0; i < parts.length; i++) {
            keys[i] = vm.parseBytes(parts[i]);
            require(keys[i].length == 48, "allowed validator pubkey must be 48 bytes");
        }
    }

    function _depositCount(DepositContractSeeded d) internal view returns (uint64 n) {
        bytes memory le = d.get_deposit_count();
        for (uint i = 0; i < 8; i++) n |= uint64(uint8(le[i])) << uint64(8 * i);
    }
}
