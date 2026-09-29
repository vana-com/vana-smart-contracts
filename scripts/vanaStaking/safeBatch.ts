/**
 * Safe Transaction Builder batch files, checksummed the way the app validates
 * them (port of safe-react-apps/apps/tx-builder/src/lib/checksum.ts).
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export type Tx = {
  to: string;
  value: string;
  data: string;
  contractMethod: null;
  contractInputsValues: null;
  note: string;
};

export const tx = (to: string, data: string, note: string, value = "0"): Tx => ({
  to, value, data, contractMethod: null, contractInputsValues: null, note,
});

const replacer = (_: string, v: unknown) => (v === undefined ? null : v);
function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json).sort();
    let acc = `{${JSON.stringify(keys, replacer)}`;
    for (const k of keys) acc += `${serialize((json as Record<string, unknown>)[k])},`;
    return `${acc}}`;
  }
  return `${JSON.stringify(json, replacer)}`;
}
function withChecksum(batch: { meta: Record<string, unknown> }) {
  const checksum = ethers.keccak256(ethers.toUtf8Bytes(serialize({ ...batch, meta: { ...batch.meta, name: null } })));
  return { ...batch, meta: { ...batch.meta, checksum } };
}

export function batchFile(safe: string, chainId: string, name: string, description: string, txs: Tx[]) {
  const transactions = txs.map(({ note, ...t }) => t);
  return withChecksum({
    version: "1.0",
    chainId,
    createdAt: Date.now(),
    meta: { name, description, txBuilderVersion: "1.16.5", createdFromSafeAddress: safe, createdFromOwnerAddress: "" },
    transactions,
  });
}

/** Write one batch and print its transactions with their notes. */
export function writeBatch(outDir: string, file: string, safe: string, chainId: string, name: string, description: string, txs: Tx[]) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, file);
  fs.writeFileSync(out, JSON.stringify(batchFile(safe, chainId, name, description, txs), null, 2) + "\n");
  console.log(`\n${name}  ->  ${out}`);
  txs.forEach((t, i) => {
    console.log(`  ${i + 1}. to   ${t.to}${t.value !== "0" ? `   value ${t.value} wei` : ""}\n     data ${t.data}\n     // ${t.note}`);
  });
  return out;
}
