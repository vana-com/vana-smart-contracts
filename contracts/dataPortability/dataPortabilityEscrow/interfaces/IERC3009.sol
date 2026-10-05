// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IERC3009
 * @notice Minimal interface for EIP-3009 "Transfer With Authorization" tokens
 *         (e.g. USDC / Circle FiatTokenV2+). Only the surface the escrow needs.
 *
 *         `receiveWithAuthorization` is used instead of
 *         `transferWithAuthorization` deliberately: the token enforces
 *         `msg.sender == to`, so a third party cannot submit the user's
 *         authorization directly against the token and move funds into the
 *         escrow outside the deposit flow (which would burn the nonce and
 *         strand the tokens uncredited).
 */
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice True if the (authorizer, nonce) pair has been consumed.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
