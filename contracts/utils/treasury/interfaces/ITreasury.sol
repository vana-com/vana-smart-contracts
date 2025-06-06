// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITreasury {
    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    function custodian() external view returns (address);

    function updateCustodian(address custodian) external;

    /// @notice Transfers a token to the given address
    /// @param to The address to transfer the token to
    /// @param token The token to transfer
    /// @param amount The amount of tokens to transfer
    function transfer(address to, address token, uint256 amount) external;
}
