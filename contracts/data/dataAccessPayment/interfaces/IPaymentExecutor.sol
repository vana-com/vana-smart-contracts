// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPaymentExecutor {
    function executePaymentRequest(address token, uint256 amount, bytes calldata metadata) external;
}
