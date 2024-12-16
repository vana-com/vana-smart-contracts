// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/MultisendStorageV1.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MultisendImplementation is
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    MultisendStorageV1
{
    using SafeERC20 for IERC20;

    error InvalidAmount();
    error InvalidAllowance();
    error LengthMismatch();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Used to initialize a new Faucet contract
     *
     * @param ownerAddress            Address of the owner
     */
    function initialize(address ownerAddress) external initializer {
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _transferOwnership(ownerAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {}

    function multisendVana(uint256 amount, address payable[] memory recipients) public payable nonReentrant {
        if (msg.value != amount * recipients.length) {
            revert InvalidAmount();
        }

        for (uint256 i = 0; i < recipients.length; i++) {
            //            if (recipients[i].balance > amount) {
            //                continue;
            //            }

            recipients[i].call{value: amount}("");
        }
    }

    function multisendWithDifferentAmounts(uint256[] amounts, address payable[] memory recipients) public payable nonReentrant {
        if (amounts.length != recipients.length) {
            revert LengthMismatch();
        }

        uint256 remainingAmount = msg.value;

        for (uint256 i = 0; i < recipients.length; i++) {
            // if (remainingAmount < amounts[i]) {
            //     revert InvalidAmount();
            // }
            remainingAmount -= amounts[i];
            recipients[i].call{value: amounts[i]}("");
        }
    }

    function multisendToken(IERC20 token, uint256 amount, address[] memory recipients) public nonReentrant {
        if (token.balanceOf(msg.sender) < amount * recipients.length) {
            revert InvalidAmount();
        }

        if (token.allowance(msg.sender, address(this)) != amount * recipients.length) {
            revert InvalidAllowance();
        }

        for (uint256 i = 0; i < recipients.length; i++) {
            token.safeTransferFrom(msg.sender, recipients[i], amount);
        }
    }
}
