// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─── OpenZeppelin-upgradeable bases (v5.x) ─── */
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20CappedUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/* ─── custom errors ─── */
error EnforceMintBlocked();
error UnauthorizedAdminAction(address caller);
error AccountBlocked();
error ZeroAddress();
error ZeroAmount();
error CapTooLow();
error EmptyString(string paramName);
error ExcessiveCap(uint256 cap);
error ArrayLengthMismatch(uint256 length1, uint256 length2);
error IndexOutOfBounds(uint256 index, uint256 length);
error ExcessiveMintAmount(uint256 amount, uint256 cap);
error BlockingRejected(address addr, string reason);
error BlockListContains(address addr); // More specific error for blocklist checks
error BlockListDoesNotContain(address addr); // For unblock operations

contract DAT is
    Initializable,
    ERC20Upgradeable,
    ERC20CappedUpgradeable,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    ERC20VotesUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /* ───── public state ───── */
    address public admin;
    bool    public mintBlocked;
    EnumerableSet.AddressSet private _blockList;

    /* ───── roles ───── */
    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /* ───── events (unchanged) ───── */
    event MintBlocked();
    event AddressBlocked(address indexed);
    event AddressUnblocked(address indexed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /**
     * @notice Initialise the clone **and mint** to the supplied receivers.
     *
     * @param receivers  Vesting-wallet addresses
     * @param amounts    Matching mint amounts
     */
    function initialize(
        string  memory  name_,
        string  memory  symbol_,
        address         owner_,
        uint256         cap_,
        address[] memory receivers,
        uint256[] memory amounts
    ) external initializer {
        // Validate input parameters
        if (bytes(name_).length == 0) revert EmptyString("name");
        if (bytes(symbol_).length == 0) revert EmptyString("symbol");
        if (cap_ == 1) revert CapTooLow();
        if (cap_ > type(uint128).max) revert ExcessiveCap(cap_);
        if (owner_ == address(0)) revert ZeroAddress();
        if (receivers.length != amounts.length) revert ArrayLengthMismatch(receivers.length, amounts.length);

        __ERC20_init(name_, symbol_);
        __ERC20Capped_init(cap_ == 0 ? type(uint256).max : cap_);
        __ERC20Permit_init(name_);
        __ERC20Votes_init();

        __Pausable_init();
        __AccessControl_init();

        /* owner gets every role */
        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(ADMIN_ROLE,         owner_);
        _grantRole(MINTER_ROLE,        owner_);
        _grantRole(PAUSER_ROLE,        owner_);

        admin = owner_;

        /* one-shot minting to vesting wallets */
        for (uint256 i; i < receivers.length; ++i) {
            if (receivers[i] == address(0)) revert ZeroAddress();
            if (amounts[i]   == 0)          revert ZeroAmount();
            _mint(receivers[i], amounts[i]);
        }
    }

    /* ─── modifiers (legacy names) ─── */
    modifier whenMintIsAllowed() {
        if (mintBlocked) revert EnforceMintBlocked();
        _;
    }
    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender))
            revert UnauthorizedAdminAction(msg.sender);
        _;
    }
    modifier whenNotBlocked(address from, address to) {
        if (_blockList.contains(from) || _blockList.contains(to))
            revert AccountBlocked();
        _;
    }

    /* ─── ERC-2612 nonce clash fix ─── */
    function nonces(address owner)
        public
        view
        override(ERC20PermitUpgradeable, NoncesUpgradeable)
        returns (uint256)
    { return super.nonces(owner); }

    /* ─── public mint (still available to owner) ─── */
    function mint(address to, uint256 amount)
        external
        whenMintIsAllowed
        onlyRole(MINTER_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0)      revert ZeroAmount();
        if (amount > type(uint128).max) revert ExcessiveMintAmount(amount, type(uint128).max);
        
        // Check that this mint wouldn't exceed the cap
        uint256 totalSupplyAfter = totalSupply() + amount;
        if (totalSupplyAfter > cap()) revert ExcessiveMintAmount(amount, cap() - totalSupply());
        
        _mint(to, amount);
    }

    function blockMint()
        external
        whenMintIsAllowed
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        mintBlocked = true;
        emit MintBlocked();
    }

    /* ─── block-list ops ─── */
    function blockAddress(address addr) external onlyAdmin {
        // Don't allow blocking critical addresses
        if (addr == address(0)) revert BlockingRejected(addr, "Cannot block zero address");
        if (addr == admin) revert BlockingRejected(addr, "Cannot block admin");
        if (hasRole(DEFAULT_ADMIN_ROLE, addr)) revert BlockingRejected(addr, "Cannot block address with admin role");
        
        if (_blockList.add(addr)) emit AddressBlocked(addr);
    }
    
    function unblockAddress(address addr) external onlyAdmin {
        // Verify address is actually in blocklist before attempting removal
        if (!_blockList.contains(addr)) revert BlockListDoesNotContain(addr);
        if (_blockList.remove(addr)) emit AddressUnblocked(addr);
    }
    
    function blockListLength() external view returns (uint256) {
        return _blockList.length();
    }
    
    function blockListAt(uint256 i) external view returns (address) {
        if (i >= _blockList.length()) revert IndexOutOfBounds(i, _blockList.length());
        return _blockList.at(i);
    }

    /* ─── pausing ─── */
    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /* ─── ERC-20 / Votes hooks ─── */
    function _update(address from, address to, uint256 v)
        internal
        override(ERC20Upgradeable, ERC20CappedUpgradeable, ERC20VotesUpgradeable)
        whenNotPaused
        whenNotBlocked(from, to)
    { super._update(from, to, v); }

    function _delegate(address delegator, address delegatee)
        internal
        override
        whenNotBlocked(delegator, delegatee)
    { 
        // If delegatee is in blocklist, delegation should revert
        if (_blockList.contains(delegatee)) revert BlockListContains(delegatee);
        super._delegate(delegator, delegatee);
    }

    function _transferVotingUnits(address from, address to, uint256 amount)
        internal
        override
        whenNotBlocked(from, to)
    { super._transferVotingUnits(from, to, amount); }

    /* ─── IERC-6372 clock ─── */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /* ─── ERC-165 glue ─── */
    function supportsInterface(bytes4 id)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    { return super.supportsInterface(id); }
}
