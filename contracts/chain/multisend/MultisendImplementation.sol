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

    function multisendVana(uint256 amount, address payable[] calldata recipients) external payable nonReentrant {
        uint256 length = recipients.length;

        if (msg.value != amount * length) {
            revert InvalidAmount();
        }

        for (uint256 i = 0; i < length; ) {
            recipients[i].call{value: amount}("");
            unchecked {
                ++i;
            }
        }
    }

    function multisendVanaWithDifferentAmounts(
        uint256[] calldata amounts,
        address payable[] calldata recipients
    ) external payable nonReentrant {
        uint256 length = recipients.length;

        if (amounts.length != length) {
            revert LengthMismatch();
        }

        uint256 remainingAmount = msg.value;

        for (uint256 i = 0; i < length; ) {
            remainingAmount -= amounts[i];
            recipients[i].call{value: amounts[i]}("");
            unchecked {
                ++i;
            }
        }

        if (remainingAmount > 0) {
            payable(msg.sender).transfer(remainingAmount);
        }
    }

    function multisendTokenWithDifferentAmounts(
        IERC20 token,
        uint256[] calldata amounts,
        address payable[] calldata recipients
    ) external nonReentrant {
        uint256 length = recipients.length;

        if (amounts.length != length) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < length; ) {
            token.safeTransferFrom(msg.sender, recipients[i], amounts[i]);

            unchecked {
                ++i;
            }
        }
    }

    function multisendToken(IERC20 token, uint256 amount, address[] memory recipients) external nonReentrant {
        uint256 length = recipients.length;

        if (token.balanceOf(msg.sender) < amount * length) {
            revert InvalidAmount();
        }

        if (token.allowance(msg.sender, address(this)) != amount * length) {
            revert InvalidAllowance();
        }

        for (uint256 i = 0; i < length; ) {
            token.safeTransferFrom(msg.sender, recipients[i], amount);
            unchecked {
                ++i;
            }
        }
    }
}
