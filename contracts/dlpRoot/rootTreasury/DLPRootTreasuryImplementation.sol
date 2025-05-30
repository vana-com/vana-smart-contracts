// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DLPRootTreasuryStorageV1.sol";

contract DLPRootTreasuryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DLPRootTreasuryStorageV1
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(address ownerAddress, address dlpRootAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        dlpRoot = IDLPRoot(dlpRootAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, dlpRootAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function updateDlpRoot(address dlpRootAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEFAULT_ADMIN_ROLE, address(dlpRoot));
        dlpRoot = IDLPRoot(dlpRootAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, dlpRootAddress);
    }

    function transferVana(
        address payable to,
        uint256 value
    ) external override whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) returns (bool) {
        (bool success, ) = to.call{value: value}("");

        return success;
    }
}
