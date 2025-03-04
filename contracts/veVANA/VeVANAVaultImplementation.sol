// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {IVeVANA} from "./interfaces/IVeVANA.sol";
import {VeVANAVaultStorageV1} from "./interfaces/VeVANAVaultStorageV1.sol";

contract VeVANAVaultImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    VeVANAVaultStorageV1 
{
    using SafeERC20 for IVeVANA;
    using Address for address payable;

    event TokenUpdated(address indexed tokenAddress);
    event TokenOwnershipRenounced();
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
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

    function updateToken(address tokenAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        token = IVeVANA(tokenAddress);
        emit TokenUpdated(tokenAddress);
    }

    function renounceTokenOwnership() external onlyRole(DEFAULT_ADMIN_ROLE) {
        token.renounceOwnership();
        emit TokenOwnershipRenounced();
    }

    receive() external payable {}

    function depositVANA() external payable {
        uint256 amount = msg.value;
        token.depositVANA{value: amount}();
        token.safeTransfer(msg.sender, amount);
        emit Deposited(msg.sender, amount);
    }

    function withdrawVANA(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.withdrawVANA(amount);
        payable(msg.sender).sendValue(amount);
        emit Withdrawn(msg.sender, amount);
    }
}
