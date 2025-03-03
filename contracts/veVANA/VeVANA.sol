// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

error DepositAmountMustBeGreaterThanZero();
error WithdrawAmountMustBeGreaterThanZero();

contract VeVANA is ERC20Votes, Ownable, ReentrancyGuard {
    using Address for address payable;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(
        address ownerAddress
    ) ERC20("Vote-Escrowed VANA", "veVANA") EIP712("veVANA", "1") Ownable(ownerAddress) {
        delegate(ownerAddress);
    }

    /// @dev If the owner is the 0 address, anyone can deposit and withdraw veVANA directly.
    /// @dev Otherwise, only the owner (i.e. the veVANA vault contract) can deposit and withdraw veVANA.
    function _checkOwner() internal view override {
        if (owner() != address(0)) {
            super._checkOwner();
        }
    }

    /// @notice Deposit VANA to mint veVANA tokens.
    function depositVANA() external payable onlyOwner {
        if (msg.value == 0) revert DepositAmountMustBeGreaterThanZero();
        _mint(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw VANA by converting veVANA back to VANA.
    /// @dev Stakers with veVANA tokens can withdraw anytime.
    /// @dev Lock-up period on veVANA rewards is enforced by the stake-related logic in DLPRoot.
    function withdrawVANA(uint256 amount) external nonReentrant onlyOwner {
        if (amount == 0) revert WithdrawAmountMustBeGreaterThanZero();
        _burn(msg.sender, amount);
        payable(msg.sender).sendValue(amount);
        emit Withdrawn(msg.sender, amount);
    }
}
