// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/TreasuryStorageV1.sol";

contract TreasuryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    TreasuryStorageV1
{
    using SafeERC20 for IERC20;
    using Address for address payable;

    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    address public constant VANA = address(0);

    event Transfer(address indexed to, address indexed token, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();

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
    function initialize(address ownerAddress, address initCustodian) external initializer {
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        custodian = initCustodian;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(CUSTODIAN_ROLE, ownerAddress);
        _grantRole(CUSTODIAN_ROLE, initCustodian);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function updateCustodian(address newCustodian) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(CUSTODIAN_ROLE, custodian);
        custodian = newCustodian;
        _grantRole(CUSTODIAN_ROLE, newCustodian);
    }

    function transfer(
        address to,
        address token,
        uint256 amount
    ) external override nonReentrant whenNotPaused onlyRole(CUSTODIAN_ROLE) {
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (to == address(0)) {
            revert ZeroAddress();
        }

        if (token == VANA) {
            payable(to).sendValue(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit Transfer(to, token, amount);
    }
}
