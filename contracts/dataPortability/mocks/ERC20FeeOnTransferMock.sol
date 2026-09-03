// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ERC20FeeOnTransferMock
 * @notice ERC20 that burns a configurable fee (in basis points) on every
 *         transfer, so the recipient receives less than the sent amount.
 *         Used to verify balance-diff accounting in the escrow deposits.
 */
contract ERC20FeeOnTransferMock is ERC20 {
    uint256 public feeBps;

    constructor(uint256 feeBps_) ERC20("Fee Token", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        // Fee applies only to real transfers, not mint/burn.
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            if (fee > 0) {
                super._update(from, address(0), fee);
                value -= fee;
            }
        }
        super._update(from, to, value);
    }
}
