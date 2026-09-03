import { ethers } from "hardhat";
const GRANTEES_PROXY = "0x8325C0A0948483EdA023A1A2Fd895e62C5131234";
const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);

async function main() {
  const c = await ethers.getContractAt("DataPortabilityGranteesImplementation", GRANTEES_PROXY);
  // Try to identify admin holders via DEFAULT_ADMIN_ROLE
  // (no Enumerable extension expected — just probe known candidates)
  const candidates = [
    "0x5ECA5208F29e32879a711467916965B2D753bAf4", // canonical mainnet admin
    "0x247f35279A32d2A5aD2F4ca5dD81fc150f2355B3", // deployer
    "0x2AC93684679a5bdA03C6160def908CdB8D46792f", // old Moksha admin
  ];
  for (const addr of candidates) {
    try {
      const ok = await c.hasRole(DEFAULT_ADMIN_ROLE, addr);
      console.log(`${addr}: ${ok ? "✓ has DEFAULT_ADMIN_ROLE" : "—"}`);
    } catch (e) {
      console.log(`${addr}: error (${(e as Error).message.slice(0,50)})`);
    }
  }

  // Also probe the iface version
  try {
    const v = await c.version();
    console.log(`version(): ${v}`);
  } catch {}
}
main().catch(e => { console.error(e); process.exit(1); });
