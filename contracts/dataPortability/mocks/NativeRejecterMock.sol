// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title NativeRejecterMock
 * @notice Contract with no receive/fallback — any plain native transfer to it
 *         fails. Used to exercise the escrow's NativeTransferFailed path.
 */
contract NativeRejecterMock {
    // Intentionally empty: no receive(), no payable fallback.
}
