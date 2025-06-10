// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─── OpenZeppelin bases (v5.x) ─── */
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20CappedUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/* ─── custom errors ─── */
error AccountBlocked();
error ZeroAddress();
error ZeroAmount();
error EmptyString(string paramName);
error ArrayLengthMismatch(uint256 length1, uint256 length2);
error IndexOutOfBounds(uint256 index, uint256 length);
error BlockingRejected(address addr, string reason);
error BlockListDoesNotContain(address addr); // For unblock operations

contract DAT is
    Initializable,
    ERC20Upgradeable,
    ERC20CappedUpgradeable,
    ERC20BurnableUpgradeable,
    AccessControlUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /* ───── internal state ───── */
    EnumerableSet.AddressSet internal _blockList;

    /* ───── roles ───── */
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /* ───── events ───── */
    event AddressBlocked(address indexed);
    event AddressUnblocked(address indexed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialise the clone **and mint** to the supplied receivers.
     *
     * @param cap_       Cap amount, if 0, use max uint256
     * @param receivers  Vesting-wallet addresses
     * @param amounts    Matching mint amounts
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) external virtual initializer {
        __DAT_init(name_, symbol_, owner_, cap_, receivers, amounts);
    }

    function __DAT_init(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) internal onlyInitializing {
        // Validate input parameters
        if (bytes(name_).length == 0) revert EmptyString("name");
        if (bytes(symbol_).length == 0) revert EmptyString("symbol");
        if (owner_ == address(0)) revert ZeroAddress();
        if (receivers.length != amounts.length) revert ArrayLengthMismatch(receivers.length, amounts.length);

        // Initialise the base contract
        __ERC20_init(name_, symbol_);
        __ERC20Capped_init(cap_ == 0 ? type(uint256).max : cap_);
        __ERC20Burnable_init();
        __AccessControl_init();

        /* owner gets every role */
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MINTER_ROLE, owner_);

        /* one-shot minting to vesting wallets */
        for (uint256 i; i < receivers.length; ++i) {
            if (amounts[i] == 0) revert ZeroAmount();
            _mint(receivers[i], amounts[i]);
        }
    }

    /* ─── modifiers ─── */
    modifier whenNotBlocked(address from, address to) {
        if (_blockList.contains(from) || _blockList.contains(to)) revert AccountBlocked();
        _;
    }

    function templateName() external pure virtual returns (string memory) {
        return "DAT";
    }

    /* ─── public mint (still available to owner) ─── */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        /// @dev _mint will revert with ERC20InvalidReceiver if the receiver is a zero address
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /* ─── block-list ops ─── */
    function blockAddress(address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Don't allow blocking critical addresses
        if (addr == address(0)) revert BlockingRejected(addr, "Cannot block zero address");

        if (_blockList.add(addr)) emit AddressBlocked(addr);
    }

    function unblockAddress(address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Verify address is actually in blocklist before attempting removal
        if (_blockList.remove(addr)) emit AddressUnblocked(addr);
        else revert BlockListDoesNotContain(addr);
    }

    function blockListLength() external view returns (uint256) {
        return _blockList.length();
    }

    function blockListAt(uint256 i) external view returns (address) {
        if (i >= _blockList.length()) revert IndexOutOfBounds(i, _blockList.length());
        return _blockList.at(i);
    }

    function isBlocked(address addr) external view returns (bool) {
        return _blockList.contains(addr);
    }

    function _update(
        address from,
        address to,
        uint256 v
    ) internal virtual override(ERC20Upgradeable, ERC20CappedUpgradeable) whenNotBlocked(from, to) {
        super._update(from, to, v);
    }

    /* ─── ERC-165 glue ─── */
    function supportsInterface(bytes4 id) public view override(AccessControlUpgradeable) returns (bool) {
        return super.supportsInterface(id);
    }
}
