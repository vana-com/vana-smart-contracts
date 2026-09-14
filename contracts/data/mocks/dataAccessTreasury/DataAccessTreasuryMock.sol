// SPDX-License-Identifier: MIT
pragma solidity >= 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DataAccessTreasuryMock
 * @notice Mock treasury for testing BuyAndBurnOrchestrator
 */
contract DataAccessTreasuryMock {
    using SafeERC20 for IERC20;

    receive() external payable {}

    function deposit() external payable {}

    function withdraw(address token, uint256 amount) external {
        if (token == address(0)) {
            // Native VANA
            payable(msg.sender).transfer(amount);
        } else {
            // ERC20
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }
}