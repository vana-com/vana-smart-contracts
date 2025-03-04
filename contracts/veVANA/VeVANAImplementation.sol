// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/VeVANAStorageV1.sol";

error DepositAmountMustBeGreaterThanZero();
error WithdrawAmountMustBeGreaterThanZero();

contract VeVANAImplementation is 
    ERC20VotesUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable, 
    ReentrancyGuardUpgradeable,
    VeVANAStorageV1 {
    using Address for address payable;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize (address ownerAddress) external initializer {
        __ERC20_init("Vote-Escrowed VANA", "veVANA");
        __EIP712_init("VeVANA", "1");
        
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

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


    /// @notice Deposit VANA to mint veVANA tokens.
    function depositVANA() external payable whenNotPaused {
        if (msg.value == 0) revert DepositAmountMustBeGreaterThanZero();
        _mint(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw VANA by converting veVANA back to VANA.
    /// @dev Stakers with veVANA tokens can withdraw anytime.
    /// @dev Lock-up period on veVANA rewards is enforced by the stake-related logic in DLPRoot.
    function withdrawVANA(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert WithdrawAmountMustBeGreaterThanZero();
        _burn(msg.sender, amount);
        payable(msg.sender).sendValue(amount);
        emit Withdrawn(msg.sender, amount);
    }
}
