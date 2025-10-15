// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRevenueProcessor {
    /**
     * @notice Emitted when revenue is deposited for a DLP.
     * @param dlpId The ID of the Data Liquidity Pool.
     * @param paymentToken The token address of the payment.
     * @param amount The amount deposited.
     */
    event RevenueDeposited(uint256 indexed dlpId, address indexed paymentToken, uint256 amount);

    /**
     * @notice Emitted when the protocol's share of revenue is processed.
     * @param paymentToken The token address of the initial payment.
     * @param initialAmount The initial amount of the protocol's share.
     * @param costSkimAmount The amount skimmed for operational costs.
     * @param vanaBurned The amount of VANA burned.
     */
    event ProtocolRevenueProcessed(address indexed paymentToken, uint256 initialAmount, uint256 costSkimAmount, uint256 vanaBurned);

    /**
     * @notice Emitted when a DLP's share of revenue is processed.
     * @param dlpId The ID of the Data Liquidity Pool.
     * @param paymentToken The token address of the initial payment.
     * @param initialAmount The initial amount of the DLP's share.
     * @param lpAmountVana The amount of VANA added to liquidity.
     * @param lpAmountDlpt The amount of DLPT added to liquidity.
     * @param dlptBurned The amount of DLPT burned.
     */
    event DlpRevenueProcessed(uint256 indexed dlpId, address indexed paymentToken, uint256 initialAmount, uint256 lpAmountVana, uint256 lpAmountDlpt, uint256 dlptBurned);

    /**
     * @notice Called by QueryEngine to record revenue that has been sent to this contract's treasury.
     * @param dlpId The ID of the DLP this revenue is associated with.
     * @param paymentToken The address of the token being deposited (VANA or USDC).
     * @param amount The amount of the token being deposited.
     */
    function depositRevenue(uint256 dlpId, address paymentToken, uint256 amount) external;
}
