// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/DataAccessTreasuryStorageV1.sol";
import "./interfaces/IDataAccessTreasury.sol";
import "./DataAccessTreasuryProxyFactory.sol";
import "./DataAccessTreasuryImplementation.sol";

abstract contract DataAccessTreasuryUpgradeable is
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using Address for address payable;

    address public constant VANA = address(0);

    IDataAccessTreasury public treasury;
    mapping(address account => mapping(address token => uint256 balance)) internal _accountBalances;

    event Deposit(address indexed from, address indexed token, uint256 amount);
    event Withdraw(address indexed to, address indexed token, uint256 amount);
    event DataAccessTreasuryProxyCreated(address indexed proxy);

    error InvalidAmount();
    error InvalidVanaAmount();
    error UnexpectedVanaDeposit();
    error InsufficientBalance();

    function __DataAccessTreasuryUpgradeable_init(
        address ownerAddress,
        DataAccessTreasuryProxyFactory initDataAccessTreasuryFactory
    ) internal onlyInitializing {
        __Pausable_init();
        __ReentrancyGuard_init();

        // Deploy a new data access treasury for the compute engine via beacon proxy
        address proxy = initDataAccessTreasuryFactory.createBeaconProxy(
            abi.encodeCall(
                DataAccessTreasuryImplementation(payable(initDataAccessTreasuryFactory.implementation())).initialize,
                (ownerAddress, address(this))
            )
        );
        
        treasury = IDataAccessTreasury(proxy);
        emit DataAccessTreasuryProxyCreated(proxy);
    }

    function deposit(address token, uint256 amount) external payable virtual whenNotPaused {
        _deposit(msg.sender, token, amount);
    }

    function _deposit(address from, address token, uint256 amount) internal {
        if (amount == 0) {
            revert InvalidAmount();
        }

        _accountBalances[from][token] += amount;
        emit Deposit(from, token, amount);

        if (token == VANA) {
            if (msg.value != amount) {
                revert InvalidVanaAmount();
            }
            payable(address(treasury)).sendValue(amount);
        } else {
            // VANA is not accepted in ERC20 deposits
            if (msg.value > 0) {
                revert UnexpectedVanaDeposit();
            }
            // We do 2-step transfer to avoid the need of exposing treasury to the user
            IERC20(token).safeTransferFrom(from, address(this), amount);
            IERC20(token).safeTransfer(address(treasury), amount);
        }
    }

    function withdraw(address token, uint256 amount) external virtual nonReentrant whenNotPaused {
        if (amount == 0) {
            revert InvalidAmount();
        }

        if (_accountBalances[msg.sender][token] < amount) {
            revert InsufficientBalance();
        }

        unchecked {
            _accountBalances[msg.sender][token] -= amount;
        }
        emit Withdraw(msg.sender, token, amount);

        treasury.transfer(msg.sender, token, amount);
    }

    function balanceOf(address account, address token) external view virtual returns (uint256) {
        return _accountBalances[account][token];
    }

    uint256[48] private __gap;
}