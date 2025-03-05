// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/DLPRootTreasuryStorageV1.sol";

contract DLPRootTreasuryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DLPRootTreasuryStorageV1
{
    using Address for address payable;
    using SafeERC20 for IVeVANA;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev WARNING: Do not send the native VANA directly to this contract.
    /// Use the depositVana() function instead.
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
        return 2;
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

    function updateVeVANA(address veVANAAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        veVANA = IVeVANA(veVANAAddress);
    }

    function transferVana(
        address payable to,
        uint256 value
    ) external override whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        veVANA.withdrawVANA(value);
        to.sendValue(value);
    }

    function transferVeVANA(
        address to,
        uint256 value
    ) external override whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) returns (bool) {
        try veVANA.transfer(to, value) {
            return true;
        } catch {
            return false;
        }
    }

    function depositVana() external payable {
        veVANA.depositVANA{value: msg.value}();
    }

    function depositVeVANA(uint256 amount) external {
        veVANA.safeTransferFrom(msg.sender, address(this), amount);
    }

    function migrateVana() external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        this.depositVana{value: address(this).balance}();
    }
}
