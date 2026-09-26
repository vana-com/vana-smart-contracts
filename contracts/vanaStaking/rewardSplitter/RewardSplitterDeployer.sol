// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {RewardSplitterProxy} from "./RewardSplitterProxy.sol";

/**
 * @notice CREATE2 deployer that gives the RewardSplitter proxy the SAME address on
 *         every chain, whoever signs the deployment.
 *
 *         A proxy created directly through the CREATE2 factory embeds its
 *         initialize(owner, entity) calldata in the creation code, so the owner --
 *         which differs per chain (testnet EOA vs mainnet multisig) -- changes the
 *         address. This deployer creates the proxy with EMPTY constructor data and
 *         calls initialize in the same transaction, so the address depends only on
 *         (this contract, salt, VanaPoolEntity, implementation) -- all of which are
 *         identical across chains -- and no un-initialized proxy ever exists.
 *
 *         Because the address depends on neither the signer nor the owner, deploying
 *         is restricted to MAINTAINER_ROLE holders of the VanaPoolEntity the
 *         splitter is for: otherwise anyone could occupy the address first with
 *         themselves as owner. A maintainer is already trusted to wire the splitter
 *         (updateRewardSplitter), so this adds no new trust. The initialize call is
 *         built here from (owner, entity), never taken as raw calldata.
 *
 *         This contract has no constructor arguments, so it lands at the same
 *         address on every chain when deployed through the standard CREATE2 factory
 *         with a fixed salt.
 */
contract RewardSplitterDeployer {
    bytes32 private constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    event ProxyDeployed(
        address indexed proxy,
        address indexed implementation,
        address indexed vanaPoolEntity,
        address owner,
        bytes32 salt
    );

    error NotEntityMaintainer();
    error InitializeFailed(bytes reason);

    /// @notice Deploy the proxy at the deterministic address and initialize it atomically.
    /// @param salt            deployment salt (bound to the entity, not the signer)
    /// @param implementation  RewardSplitterImplementation (must be identical across chains)
    /// @param vanaPoolEntity  the entity this splitter pays; the caller must be one of its maintainers
    /// @param owner           the splitter's admin/maintainer/distributor -- NOT part of the address
    function deploy(
        bytes32 salt,
        address implementation,
        address vanaPoolEntity,
        address owner
    ) external returns (address proxy) {
        if (!IAccessControl(vanaPoolEntity).hasRole(MAINTAINER_ROLE, msg.sender)) {
            revert NotEntityMaintainer();
        }
        proxy = address(new RewardSplitterProxy{salt: _salt(salt, vanaPoolEntity)}(implementation, ""));
        (bool ok, bytes memory reason) = proxy.call(
            abi.encodeWithSignature("initialize(address,address)", owner, vanaPoolEntity)
        );
        if (!ok) {
            revert InitializeFailed(reason);
        }
        emit ProxyDeployed(proxy, implementation, vanaPoolEntity, owner, salt);
    }

    /// @notice The address (salt, implementation, entity) deploys to, on any chain where
    ///         this contract has the same address. Independent of signer and owner.
    function computeAddress(bytes32 salt, address implementation, address vanaPoolEntity) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(RewardSplitterProxy).creationCode, abi.encode(implementation, bytes("")))
        );
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(salt, vanaPoolEntity), initCodeHash)))
            )
        );
    }

    function _salt(bytes32 salt, address vanaPoolEntity) internal pure returns (bytes32) {
        return keccak256(abi.encode(vanaPoolEntity, salt));
    }
}
