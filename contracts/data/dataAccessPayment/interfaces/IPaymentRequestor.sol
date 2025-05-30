// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPaymentRequestor {
    function requestPayment(address token, uint256 amount, bytes memory metadata) external;
}
