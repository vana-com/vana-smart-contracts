// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ───── OpenZeppelin ───── */
import {ERC20}          from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped}    from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Burnable}  from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit}    from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes}     from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {AccessControl}  from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable}       from "@openzeppelin/contracts/utils/Pausable.sol";
import {EnumerableSet}  from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/* ───── Custom logic errors ───── */
error EnforceMintBlocked();
error UnauthorizedAdminAction(address account);
error AccountBlocked();

/* ───── Custom sanity / gas errors ───── */
error ZeroAddress();
error ZeroAmount();
error CapTooLow();

/* ───────────────────────────────────
   DAT – AccessControl-only edition   */
contract DAT is
    ERC20,
    ERC20Capped,
    ERC20Burnable,
    ERC20Permit,
    ERC20Votes,
    Pausable,
    AccessControl
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /* ---------- public state (unchanged) ---------- */
    address public admin;                 // legacy variable
    bool    public mintBlocked;
    EnumerableSet.AddressSet private _blockList;

    /* ---------- events (unchanged) ---------- */
    event MintBlocked();
    event AddressBlocked(address indexed blockedAddress);
    event AddressUnblocked(address indexed unblockedAddress);

    /* ---------- roles ---------- */
    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /* ───── constructor ─────
       cap_ = 0 ⇒ unlimited supply                               */
    constructor(
        string  memory name_,
        string  memory symbol_,
        address ownerAddress,
        uint256 cap_
    )
        ERC20(name_, symbol_)
        ERC20Capped(cap_ == 0 ? type(uint256).max : cap_)
        ERC20Permit(name_)
    {
        if (cap_ == 1) revert CapTooLow();
        if (ownerAddress == address(0)) revert ZeroAddress();

        /* ownerAddress is the initial admin & everything else */
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(ADMIN_ROLE,         ownerAddress);
        _grantRole(MINTER_ROLE,        ownerAddress);
        _grantRole(PAUSER_ROLE,        ownerAddress);

        admin = ownerAddress;
    }

    /* ───── modifiers (legacy names) ───── */
    modifier whenMintIsAllowed() {
        if (mintBlocked) revert EnforceMintBlocked();
        _;
    }

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert UnauthorizedAdminAction(msg.sender);
        _;
    }

    modifier whenNotBlocked(address from, address to) {
        if (_blockList.contains(from) || _blockList.contains(to)) revert AccountBlocked();
        _;
    }

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for `owner`.
     */
    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    /* ─────────── mint ─────────── */
    function mint(address to, uint256 amount)
        external
        whenMintIsAllowed
        onlyRole(MINTER_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0)      revert ZeroAmount();
        _mint(to, amount);            // cap enforced in _update
    }

    /* ─────────── irreversible mint fuse ─────────── */
    function blockMint() external whenMintIsAllowed onlyRole(DEFAULT_ADMIN_ROLE) {
        mintBlocked = true;
        emit MintBlocked();
    }

    /* ─────────── block-list ops (unchanged names) ─────────── */
    function blockAddress(address addr) external onlyAdmin {
        // First add to blocklist, then handle delegation
        if (_blockList.add(addr)) emit AddressBlocked(addr);
    }

    function unblockAddress(address addr) external onlyAdmin {
        if (_blockList.remove(addr)) emit AddressUnblocked(addr);
    }

    function blockListLength() external view returns (uint256) {
        return _blockList.length();
    }

    function blockListAt(uint256 i) external view returns (address) {
        return _blockList.at(i);
    }

    /* ─────────── pause / unpause ─────────── */
    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /* ─────────── ERC-20 hooks ─────────── */
    function _update(address from, address to, uint256 v)
        internal
        override(ERC20, ERC20Capped, ERC20Votes)
        whenNotPaused
        whenNotBlocked(from, to)
    {
        super._update(from, to, v);
    }

    function _delegate(address delegator, address delegatee)
        internal
        override
        whenNotBlocked(delegator, delegatee)
    {
        super._delegate(delegator, delegatee);
    }

    function _transferVotingUnits(address from, address to, uint256 v)
        internal
        override
        whenNotBlocked(from, to)
    {
        super._transferVotingUnits(from, to, v);
    }

    function _getVotingUnits(address account)
        internal
        view
        override
        returns (uint256)
    {
        if (_blockList.contains(account)) return 0;
        return super._getVotingUnits(account);
    }

    /* ─────────── IERC6372 clock (unchanged) ─────────── */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /* ─────────── supportsInterface glue ─────────── */
    function supportsInterface(bytes4 id)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(id);
    }
}
