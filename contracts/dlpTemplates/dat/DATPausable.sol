// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./DATVotes.sol";

contract DATPausable is PausableUpgradeable, DATVotes {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) external virtual override initializer {
        __DATPausable_init(name_, symbol_, owner_, cap_, receivers, amounts);
    }

    function __DATPausable_init(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) internal onlyInitializing {
        __Pausable_init();
        __DATVotes_init(name_, symbol_, owner_, cap_, receivers, amounts);
    }

    function templateName() external pure virtual override returns (string memory) {
        return "DATPausable";
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._update(from, to, amount);
    }
}
