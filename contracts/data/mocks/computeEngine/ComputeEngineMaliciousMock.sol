// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "../../dataAccessPayment/interfaces/IPaymentExecutor.sol";
import "../../dataAccessPayment/interfaces/IPaymentRequestor.sol";
import "../../computeEngine/interfaces/IComputeEngine.sol";

contract ComputeEngineMaliciousMock is IPaymentExecutor {
    function executePaymentRequest(address _token, uint256 _amount, bytes calldata _metadata) external override {
        // Do nothing
    }
}

contract ComputeEngineMaliciousMock2 is IPaymentExecutor {
    function executePaymentRequest(address _token, uint256 _amount, bytes calldata _metadata) external override {
        IPaymentRequestor(msg.sender).requestPayment(_token, _amount, _metadata);
    }
}

contract ComputeEngineMaliciousContract {
    IComputeEngine public computeEngine;

    constructor(IComputeEngine _computeEngine) {
        computeEngine = _computeEngine;
    }

    function deposit() external payable {
        computeEngine.deposit{value: msg.value}(address(0), msg.value);
    }

    function withdraw(uint256 amount) external {
        computeEngine.withdraw(address(0), amount);
    }

    receive() external payable {
        uint256 balance = computeEngine.balanceOf(address(this), address(0));
        if (balance > 0) {
            computeEngine.withdraw(address(0), balance);
        }
    }
}