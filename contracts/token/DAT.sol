// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract DAT is ERC20, ERC20Permit, ERC20Votes, Ownable2Step {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public admin;
    bool public mintBlocked;
    EnumerableSet.AddressSet private _blockList;

    /**
     * @dev Emitted when the pause is triggered by `owner`.
     */
    event MintBlocked();

    /**
     * @dev Emitted when the admin is updated.
     *
     * @param oldAdmin    the old admin address
     * @param newAdmin    the new admin address
     */
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    /**
     * @dev Emitted when and address is added to the blockList
     *
     * @param blockedAddress    the address to be blocked
     */
    event AddressBlocked(address indexed blockedAddress);

    /**
     * @dev Emitted when and address is removed from the blockList
     *
     * @param unblockedAddress    the address to be unblocked
     */
    event AddressUnblocked(address indexed unblockedAddress);

    /**
     * @dev The operation failed because the mint is blocked.
     */
    error EnforceMintBlocked();

    /**
     * @dev The caller account is not authorized to perform an admin operation.
     */
    error UnauthorizedAdminAction(address account);

    /**
     * @dev The account is blocked
     */
    error AccountBlocked();

    modifier whenMintIsAllowed() {
        if (mintBlocked) {
            revert EnforceMintBlocked();
        }
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) {
            revert UnauthorizedAdminAction(msg.sender);
        }
        _;
    }

    modifier whenNotBlocked(address from, address to) {
        if (_blockList.contains(from) || _blockList.contains(to)) {
            revert AccountBlocked();
        }
        _;
    }

    /**
     * @dev Initializes the contract by setting a `name`, a `symbol` and an `ownerAddress`.
     *
     * See {ERC20-constructor}.
     */
    constructor(
        string memory name,
        string memory symbol,
        address ownerAddress
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(ownerAddress) {}

    // Overrides IERC6372 functions to make the token & governor timestamp-based
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /**
     * @dev Returns the blockList length
     */
    function blockListLength() external view returns (uint256) {
        return _blockList.length();
    }

    /**
     * @dev Returns the address at the given index in the blockList
     */
    function blockListAt(uint256 _index) external view returns (address) {
        return _blockList.at(_index);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) whenNotBlocked(from, to) {
        super._update(from, to, amount);
    }

    /**
     * @dev Override _delegate to add a check for blocked addresses
     */
    function _delegate(
        address account,
        address delegatee
    ) internal virtual override whenNotBlocked(account, delegatee) {
        super._delegate(account, delegatee);
    }

    /**
     * @dev Override _delegate to add a check for blocked addresses
     */
    function _transferVotingUnits(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotBlocked(from, to) {
        super._transferVotingUnits(from, to, amount);
    }

    /**
     * @dev Override _getVotingUnits to return 0 for blocked addresses
     */
    function _getVotingUnits(address account) internal view override returns (uint256) {
        if (_blockList.contains(account)) {
            return 0;
        }
        return super._getVotingUnits(account);
    }

    /**
     * @dev Returns the current amount of votes that `account` has.
     */
    function getVotes(address account) public view virtual override returns (uint256) {
        if (_blockList.contains(account)) {
            return 0;
        }

        return super.getVotes(account);
    }

    /**
     * @dev Override getPastVotes to return 0 for blocked addresses
     */
    function getPastVotes(address account, uint256 timepoint) public view override returns (uint256) {
        if (_blockList.contains(account)) {
            return 0;
        }
        return super.getPastVotes(account, timepoint);
    }

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for `owner`.
     */
    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    /**
     * @dev Mints `amount` tokens to `to`.
     *
     * @param to     the address to mint tokens to
     * @param amount the amount of tokens to mint
     *
     * See {ERC20-_mint}.
     */
    function mint(address to, uint256 amount) external virtual onlyOwner whenMintIsAllowed {
        _mint(to, amount);
    }

    /**
     * @dev Changes admin address
     */
    function changeAdmin(address newAdmin) external virtual onlyOwner {
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminChanged(oldAdmin, newAdmin);
    }

    /**
     * @dev Blocks feature mints
     *
     * Once this method is invoked there is no way to mint more tokens
     */
    function blockMint() external virtual onlyOwner whenMintIsAllowed {
        mintBlocked = true;

        emit MintBlocked();
    }

    /**
     * @dev Adds an address to the blockList. This address is not able to transfer any more
     */
    function blockAddress(address addressToBeBlocked) external virtual onlyAdmin {
        _delegate(addressToBeBlocked, address(0));

        _blockList.add(addressToBeBlocked);

        emit AddressBlocked(addressToBeBlocked);
    }

    /**
     * @dev Removes an address from the blockList
     */
    function unblockAddress(address addressToBeUnblocked) external virtual onlyAdmin {
        _blockList.remove(addressToBeUnblocked);

        emit AddressUnblocked(addressToBeUnblocked);
    }
}
