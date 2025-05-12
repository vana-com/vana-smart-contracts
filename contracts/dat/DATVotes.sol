// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─── OpenZeppelin bases (v5.x) ─── */
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

import "./DAT.sol";

contract DATVotes is ERC20PermitUpgradeable, ERC20VotesUpgradeable, DAT {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize.
     *
     * @param cap_       Cap amount, if 0, use max uint256
     * @param receivers  Vesting-wallet addresses
     * @param amounts    Matching mint amounts
     * 
     * @dev By using ERC20Votes, the max supply is capped to type(uint208).max
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) external virtual override initializer {
        __DATVotes_init(name_, symbol_, owner_, cap_, receivers, amounts);
    }

    function __DATVotes_init(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) internal onlyInitializing {
        __ERC20Permit_init(name_);
        __ERC20Votes_init();
        __DAT_init(name_, symbol_, owner_, cap_, receivers, amounts);
    }

    function templateName() external pure virtual override returns (string memory) {
        return "DATVotes";
    }

    /* ─── ERC-2612 nonce clash fix ─── */
    function nonces(address owner) public view override(ERC20PermitUpgradeable, NoncesUpgradeable) returns (uint256) {
        return super.nonces(owner);
    }

    /* ─── ERC-20 / Votes hooks ─── */
    function _update(
        address from,
        address to,
        uint256 v
    ) internal virtual override(DAT, ERC20Upgradeable, ERC20VotesUpgradeable) whenNotBlocked(from, to) {
        super._update(from, to, v);
    }

    /// @dev By overriding _delegate, we don't need to override _getVotingUnits to support blocklisting
    function _delegate(address delegator, address delegatee) internal override whenNotBlocked(delegator, delegatee) {
        super._delegate(delegator, delegatee);
    }

    function _transferVotingUnits(address from, address to, uint256 amount) internal override whenNotBlocked(from, to) {
        super._transferVotingUnits(from, to, amount);
    }

    /* ─── IERC-6372 clock ─── */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }
}
