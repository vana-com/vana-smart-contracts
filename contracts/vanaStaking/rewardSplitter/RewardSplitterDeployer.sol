// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {RewardSplitterProxy} from "./RewardSplitterProxy.sol";

/**
 * @notice CREATE2 deployer that gives the RewardSplitter proxy the SAME address on
 *         every chain. A proxy created directly through the CREATE2 factory embeds
 *         its initialize(owner, entity) calldata in the creation code, so the
 *         owner -- which differs per chain (testnet EOA vs mainnet multisig) --
 *         changes the address. This deployer creates the proxy with EMPTY
 *         constructor data, so the address depends only on this contract, the
 *         salt and the implementation, and then calls initialize in the same
 *         transaction, so no un-initialized proxy ever exists on-chain.
 *
 *         The salt is mixed with msg.sender: nobody else can produce the address
 *         a given deployer will get (no front-running with a different owner),
 *         and the address is still chain-independent provided the same EOA signs
 *         the deployment on each chain. This contract itself has no constructor
 *         arguments, so it lands at the same address on every chain when deployed
 *         through the standard CREATE2 factory with a fixed salt.
 */
contract RewardSplitterDeployer {
    event ProxyDeployed(address indexed proxy, address indexed implementation, address indexed deployer, bytes32 salt);

    error InitializeFailed(bytes reason);

    /// @notice Deploy the proxy at the deterministic address and initialize it atomically.
    /// @param salt            caller-chosen salt (mixed with msg.sender)
    /// @param implementation  RewardSplitterImplementation address (must be identical across chains)
    /// @param initData        abi-encoded initialize(owner, vanaPoolEntity) -- NOT part of the address
    function deploy(bytes32 salt, address implementation, bytes calldata initData) external returns (address proxy) {
        proxy = address(new RewardSplitterProxy{salt: _mixedSalt(msg.sender, salt)}(implementation, ""));
        (bool ok, bytes memory reason) = proxy.call(initData);
        if (!ok) {
            revert InitializeFailed(reason);
        }
        emit ProxyDeployed(proxy, implementation, msg.sender, salt);
    }

    /// @notice The address `deployer` will get for (salt, implementation), on any chain
    ///         where this contract has the same address.
    function computeAddress(address deployer, bytes32 salt, address implementation) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(RewardSplitterProxy).creationCode, abi.encode(implementation, bytes("")))
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _mixedSalt(deployer, salt), initCodeHash))))
        );
    }

    function _mixedSalt(address deployer, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(deployer, salt));
    }
}
