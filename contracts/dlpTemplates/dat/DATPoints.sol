// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract DATPoints is ERC20, ERC20Capped, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /**
     * @notice Constructor to initialize the DATPoints token
     *
     * @param name_     Token name
     * @param symbol_   Token symbol
     * @param owner_    Owner address
     * @param cap_      Maximum supply (0 for no cap)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_
    ) ERC20(name_, symbol_) ERC20Capped(cap_ == 0 ? type(uint256).max : cap_) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MINTER_ROLE, owner_);
    }

    /**
     * @notice Mint new tokens
     *
     * @param to        Recipient address
     * @param amount    Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @notice Override required by Solidity for ERC20Capped
     */
    function _update(address from, address to, uint256 value) internal virtual override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
