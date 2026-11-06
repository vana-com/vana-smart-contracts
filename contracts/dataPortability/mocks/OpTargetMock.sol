// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title OpTargetMock
 * @notice Simple allowlistable target for DataPortabilityEscrow.runOpAndSettle
 *         tests: one succeeding call that returns data, one that reverts with
 *         a typed error (to verify revert bubbling), and one payable probe.
 */
contract OpTargetMock {
    error TypedFailure(uint256 code);

    event Poked(address indexed caller, uint256 value, uint256 x);

    uint256 public lastX;

    function poke(uint256 x) external payable returns (uint256) {
        lastX = x;
        emit Poked(msg.sender, msg.value, x);
        return x + 1;
    }

    function fail(uint256 code) external pure {
        revert TypedFailure(code);
    }
}
