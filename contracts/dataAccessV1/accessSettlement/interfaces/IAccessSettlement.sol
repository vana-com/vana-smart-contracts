// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAccessSettlement
 * @notice Interface for the AccessSettlement contract
 * @dev Acts as a trustless clearinghouse for data access and compute operations
 */
interface IAccessSettlement {
    /**
     * @notice State of a completed but unpaid operation
     * @param issuer The address that gets paid
     * @param grantee The address that needs to pay
     * @param price Price for the operation
     * @param tokenAddress Token address for payment (address(0) for native VANA)
     * @param isSettled Whether payment has been settled
     */
    struct OperationInvoice {
        address issuer;
        address grantee;
        uint256 price;
        address tokenAddress;
        bool isSettled;
    }

    /**
     * @notice Emitted when an operation is ready for settlement
     * @param operationId Unique identifier for the operation
     * @param issuer Address that will receive payment
     * @param grantee Address that needs to pay
     * @param price Price for the operation
     * @param tokenAddress Token address for payment
     */
    event OperationReadyForSettlement(
        bytes indexed operationId,
        address indexed issuer,
        address indexed grantee,
        uint256 price,
        address tokenAddress
    );

    /**
     * @notice Emitted when payment is confirmed
     * @param operationId Unique identifier for the operation
     * @param grantee Address that paid
     * @param price Amount paid
     * @param tokenAddress Token used for payment
     */
    event PaymentSettled(
        bytes indexed operationId,
        address indexed grantee,
        uint256 price,
        address tokenAddress
    );

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
    ) external;

    /**
     * @notice Settle payment for an operation using an ERC20 token
     * @dev Consumer must have called approve() on the token contract first
     * @param operationId Unique identifier for the operation
     * @param tokenAddress Token address to use for payment
     */
    function settlePaymentWithToken(
        bytes memory operationId,
        address tokenAddress
    ) external;

    /**
     * @notice Settle payment for an operation using native VANA
     * @dev Consumer must send the finalPrice amount of VANA with the transaction
     * @param operationId Unique identifier for the operation
     */
    function settlePaymentWithNative(bytes memory operationId) external payable;

    /**
     * @notice Get invoice details for an operation
     * @param operationId Unique identifier for the operation
     * @return invoice The operation invoice structure
     */
    function getOperationInvoice(
        bytes memory operationId
    ) external view returns (OperationInvoice memory invoice);

    /**
     * @notice Check if an operation has been settled
     * @param operationId Unique identifier for the operation
     * @return isSettled True if payment has been settled
     */
    function isOperationSettled(
        bytes memory operationId
    ) external view returns (bool isSettled);
}
