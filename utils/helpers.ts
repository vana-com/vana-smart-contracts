// @ts-ignore
import {
  ContractTransactionReceipt,
  parseEther as parseEtherOriginal,
} from "ethers";

export function parseEther(value: number | string) {
  return parseEtherOriginal(value.toString());
}

export async function getReceipt(tx: any): Promise<ContractTransactionReceipt> {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("No receipt");
  }
  return receipt;
}

export function toHex(bigint: bigint): string {
  return "0x" + bigint.toString(16);
}

export function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) throw new Error("Square root of negative bigint");
  if (n < 2n) return n;

  let x0 = n;
  let x1 = (x0 + n / x0) >> 1n;

  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + n / x0) >> 1n;
  }

  return x0;
}
