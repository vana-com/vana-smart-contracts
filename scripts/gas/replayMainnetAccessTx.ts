/**
 * Replays a mainnet `recordAccessAndSettle` tx on a Hardhat fork of Vana
 * mainnet, pinned to the block before the tx landed, and prints gasUsed.
 *
 * Read-only against mainnet (fork + impersonation, nothing broadcast).
 *
 *   VANA_RPC_URL=https://rpc.vana.org \
 *   TX_HASH=0xfc0bb12e707315da1d8376a2a624d636a0089c17fc757c14d114ab3ab450c20b \
 *   npx hardhat run scripts/gas/replayMainnetAccessTx.ts
 */
import { ethers, network } from "hardhat";

async function main() {
  const rpc = process.env.VANA_RPC_URL || "https://rpc.vana.org";
  const txHash =
    process.env.TX_HASH ||
    "0xfc0bb12e707315da1d8376a2a624d636a0089c17fc757c14d114ab3ab450c20b";

  const remote = new ethers.JsonRpcProvider(rpc);
  const tx = await remote.getTransaction(txHash);
  const receipt = await remote.getTransactionReceipt(txHash);
  if (!tx || !receipt) throw new Error("tx or receipt not found on remote");
  console.log("remote block      ", receipt.blockNumber);
  console.log("remote gasUsed    ", receipt.gasUsed.toString());
  console.log("remote logs       ", receipt.logs.length);
  console.log("calldata bytes    ", (tx.data.length - 2) / 2);

  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: rpc, blockNumber: receipt.blockNumber - 1 } }],
  });
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [tx.from] });
  await network.provider.request({
    method: "hardhat_setBalance",
    params: [tx.from, "0x" + (10n ** 20n).toString(16)],
  });
  const signer = await ethers.getSigner(tx.from);
  const sent = await signer.sendTransaction({
    to: tx.to!,
    data: tx.data,
    value: tx.value,
    gasLimit: tx.gasLimit,
  });
  const local = await sent.wait();
  if (!local) throw new Error("no local receipt");
  console.log("fork status       ", local.status);
  console.log("fork gasUsed      ", local.gasUsed.toString());
  console.log("fork logs         ", local.logs.length);
  console.log(
    "match             ",
    local.gasUsed === receipt.gasUsed ? "EXACT" : `DIFF ${local.gasUsed - receipt.gasUsed}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
