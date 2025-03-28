// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/DataAccessTreasuryStorageV1.sol";

contract DataAccessTreasuryImplementation is
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    DataAccessTreasuryStorageV1
{
    using SafeERC20 for IERC20;
    using Address for address payable;

    address public constant VANA = address(0);

    event Transfer(address indexed to, address indexed token, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    /**
     * @notice Initializes the contract
     *
     * @param ownerAddress Address of the owner
     */
    function initialize(address ownerAddress, address _custodian) external initializer {
        __Pausable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        custodian = _custodian;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, _custodian);
    }

    /// @inheritdoc IDataAccessTreasury
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IDataAccessTreasury
    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @inheritdoc IDataAccessTreasury
    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @inheritdoc IDataAccessTreasury
    function updateCustodian(address _custodian) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEFAULT_ADMIN_ROLE, custodian);
        custodian = _custodian;
        _grantRole(DEFAULT_ADMIN_ROLE, _custodian);
    }

    /// @inheritdoc IDataAccessTreasury
    function transfer(
        address to,
        address token,
        uint256 amount
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused nonReentrant {
        if (token == VANA) {
            payable(to).sendValue(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit Transfer(to, token, amount);
    }
}
