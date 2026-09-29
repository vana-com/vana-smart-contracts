// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/VanaPoolTreasuryStorageV2.sol";

contract VanaPoolTreasuryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    VanaPoolTreasuryStorageV2
{
    // Narrow role that gates ONLY transferVana. Held by the callers that must move
    // VANA out -- the staking contract (unstake payouts) and the entity contract
    // (commission claims) -- so neither needs DEFAULT_ADMIN, which also authorizes
    // upgrading and pausing the treasury that custodies all staker principal.
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(address ownerAddress, address vanaPoolAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        vanaPool = vanaPoolAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        // Staking spends (unstake payouts) but must NOT hold DEFAULT_ADMIN. The
        // entity contract is granted SPENDER_ROLE separately in the deploy/upgrade,
        // since its address is not known here.
        _grantRole(SPENDER_ROLE, vanaPoolAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 2;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function updateVanaPool(address vanaPoolAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(SPENDER_ROLE, vanaPool);
        vanaPool = vanaPoolAddress;
        _grantRole(SPENDER_ROLE, vanaPoolAddress);
    }

    /// @notice Set the entity contract and grant it SPENDER_ROLE so it can pay out
    ///         commission and swept rewards. Rotates the role off the previous
    ///         entity. Call this as part of the deploy/upgrade wiring.
    function updateVanaPoolEntity(address vanaPoolEntityAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vanaPoolEntity != address(0)) {
            _revokeRole(SPENDER_ROLE, vanaPoolEntity);
        }
        vanaPoolEntity = vanaPoolEntityAddress;
        _grantRole(SPENDER_ROLE, vanaPoolEntityAddress);
    }

    function transferVana(
        address payable to,
        uint256 value
    ) external override whenNotPaused onlyRole(SPENDER_ROLE) returns (bool) {
        (bool success, ) = to.call{value: value}("");

        return success;
    }
}
