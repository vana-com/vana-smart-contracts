// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAccessSettlement.sol";

/**
 * @title AccessSettlementImplementation
 * @notice Implementation of the AccessSettlement contract
 * @dev Acts as a trustless clearinghouse for data access and compute operations
 */
contract AccessSettlementImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IAccessSettlement
{
    using SafeERC20 for IERC20;

    /// @notice Role for Vana Runtime servers
    bytes32 public constant VANA_RUNTIME_ROLE =
        keccak256("VANA_RUNTIME_ROLE");

    /// @notice Mapping from operation ID to invoice
    mapping(bytes32 => OperationInvoice) private _operationInvoices;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Log a completed operation and create an invoice
     * @dev Can only be called by a registered Vana Runtime
     * @param operationId Unique identifier for the operation
     * @param grantee Address that needs to pay
     * @param finalPrice Final price for the operation
     * @param tokenAddress Token address for payment (address(0) for native VANA)
     */
    function logOperation(
        bytes memory operationId,
        address grantee,
        uint256 finalPrice,
        address tokenAddress
    ) external override onlyRole(VANA_RUNTIME_ROLE) {
        require(grantee != address(0), "Invalid grantee address");
        require(finalPrice > 0, "Price must be greater than 0");

        bytes32 opId = keccak256(operationId);
        require(
            _operationInvoices[opId].issuer == address(0),
            "Operation already logged"
        );

        _operationInvoices[opId] = OperationInvoice({
            issuer: msg.sender,
            grantee: grantee,
            price: finalPrice,
            tokenAddress: tokenAddress,
            isSettled: false
        });

        emit OperationReadyForSettlement(
            operationId,
            msg.sender,
            grantee,
            finalPrice,
            tokenAddress
        );
    }

    /**
     * @notice Settle payment for an operation using an ERC20 token
     * @dev Consumer must have called approve() on the token contract first
     * @param operationId Unique identifier for the operation
     * @param tokenAddress Token address to use for payment
     */
    function settlePaymentWithToken(
        bytes memory operationId,
        address tokenAddress
    ) external override nonReentrant {
        bytes32 opId = keccak256(operationId);
        OperationInvoice storage invoice = _operationInvoices[opId];

        require(invoice.issuer != address(0), "Operation not found");
        require(!invoice.isSettled, "Payment already settled");
        require(
            invoice.tokenAddress == tokenAddress && tokenAddress != address(0),
            "Invalid token address"
        );
        require(
            msg.sender == invoice.grantee || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        invoice.isSettled = true;

        // Transfer tokens from grantee to issuer
        IERC20(tokenAddress).safeTransferFrom(
            invoice.grantee,
            invoice.issuer,
            invoice.price
        );

        emit PaymentSettled(
            operationId,
            invoice.grantee,
            invoice.price,
            tokenAddress
        );
    }

    /**
     * @notice Settle payment for an operation using native VANA
     * @dev Consumer must send the finalPrice amount of VANA with the transaction
     * @param operationId Unique identifier for the operation
     */
    function settlePaymentWithNative(
        bytes memory operationId
    ) external payable override nonReentrant {
        bytes32 opId = keccak256(operationId);
        OperationInvoice storage invoice = _operationInvoices[opId];

        require(invoice.issuer != address(0), "Operation not found");
        require(!invoice.isSettled, "Payment already settled");
        require(
            invoice.tokenAddress == address(0),
            "Operation requires token payment"
        );
        require(
            msg.sender == invoice.grantee || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(msg.value == invoice.price, "Incorrect payment amount");

        invoice.isSettled = true;

        // Transfer native VANA to issuer
        (bool success, ) = invoice.issuer.call{value: invoice.price}("");
        require(success, "Native transfer failed");

        emit PaymentSettled(
            operationId,
            invoice.grantee,
            invoice.price,
            address(0)
        );
    }

    /**
     * @notice Get invoice details for an operation
     * @param operationId Unique identifier for the operation
     * @return invoice The operation invoice structure
     */
    function getOperationInvoice(
        bytes memory operationId
    ) external view override returns (OperationInvoice memory invoice) {
        bytes32 opId = keccak256(operationId);
        require(
            _operationInvoices[opId].issuer != address(0),
            "Operation not found"
        );
        return _operationInvoices[opId];
    }

    /**
     * @notice Check if an operation has been settled
     * @param operationId Unique identifier for the operation
     * @return isSettled True if payment has been settled
     */
    function isOperationSettled(
        bytes memory operationId
    ) external view override returns (bool) {
        bytes32 opId = keccak256(operationId);
        return _operationInvoices[opId].isSettled;
    }

    /**
     * @dev Required override for UUPS upgrades
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[50] private __gap;
}
