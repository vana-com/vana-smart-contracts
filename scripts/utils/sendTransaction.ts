import { ethers } from "hardhat";
import type { ethers as EthersNamespace } from "ethers";

export async function waitForTransaction(tx: any): Promise<EthersNamespace.ContractTransactionReceipt> {
    console.log("✅ Transaction sent. Waiting for confirmation...");
    console.log("ℹ️ Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
        console.error("Transaction failed");
        throw new Error("Transaction failed"); // Throw an error to force early return
    }
    console.log("✅ Transaction confirmed.");
    return receipt;
};

export async function sendTransaction(
    contract: any,
    method: string,
    args: any[],
    signer: any,
    value?: any,
): Promise<EthersNamespace.ContractTransactionReceipt> {
    // Fetch the current fee data for EIP-1559 transactions
    const feeData = await ethers.provider.getFeeData();

    // You can adjust the gas fees by adding a buffer (e.g., 1.2x)
    const maxFeePerGas = feeData.maxFeePerGas! * 12n / 10n; // adding 20% buffer
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas! * 12n / 10n; // adding 20% buffer    

    const tx = await contract.connect(signer)[method](...args, {
        value: value,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
    });
    return waitForTransaction(tx);
}

/**
 * A type-safe contract method name.
 * Ensures only callable functions on the contract are used.
 */
export type ContractMethod<T extends EthersNamespace.Contract> = keyof T["functions"];

/**
 * Sends a transaction to a contract function and waits for confirmation.
 *
 * @param contract - An ethers.js contract instance.
 * @param method - The name of the contract method to call (type-checked).
 * @param args - Arguments to pass to the method.
 * @param overrides - Optional transaction overrides (e.g., gas limit, value).
 * @returns The transaction receipt.
 */
export async function buildSendAndConfirmTxSafe<
    T extends EthersNamespace.Contract,
    K extends keyof T
>(
    contract: T,
    method: K,
    args: T[K] extends (...args: infer A) => any ? A : never,
    overrides: EthersNamespace.Overrides = {}
): Promise<EthersNamespace.ContractTransactionReceipt> {
    try {
        // Fetch the current fee data for EIP-1559 transactions
        const feeData = await ethers.provider.getFeeData();

        // You can adjust the gas fees by adding a buffer (e.g., 1.2x)
        overrides.maxFeePerGas = feeData.maxFeePerGas! * 12n / 10n; // adding 20% buffer
        overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas! * 12n / 10n; // adding 20% buffer    

        console.log(`[buildSendAndConfirmTxSafe] Calling '${String(method)}' with args:`, args);

        // Send the transaction
        const tx = await (contract[method] as any)(...args, overrides);
        const receipt = await waitForTransaction(tx);
        return receipt;
    } catch (error) {
        console.error(`[buildSendAndConfirmTxSafe] Error calling '${String(method)}':`, error);
        throw error; // Rethrow the error to be handled by the caller
    }
}
