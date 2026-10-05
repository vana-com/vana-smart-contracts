import { ethers } from "hardhat";

const PERMISSIONS_PROXY = "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011";
const SERVERS_PROXY = "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab";
const GRANTOR = "0x0eDE268f40B4c21D139E1B454C901C5B16E6cBFb";
const SIGNATURE = "0x415cba2328d2eb8fdd224975eb5427568bf3b5265cc22c0b3ec0a78bf852bede3bec84bcc72527386ddd246cf22ca36e63346dd3ea016982d5bf849fd0fb0d5d1c";

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log("chainId:", chainId);

  // 1. Confirm what the contract sees
  const perms = await ethers.getContractAt("DataPortabilityPermissionsV2Implementation", PERMISSIONS_PROXY);
  console.log("perms.dataPortabilityServers():", await perms.dataPortabilityServers());
  console.log("perms.domainSeparator():       ", await perms.domainSeparator());

  // 2. Recover the signer using the CONTRACT's domain separator
  const typeHash = await perms.GRANT_REGISTRATION_TYPEHASH();
  const input = {
    grantorAddress: GRANTOR,
    granteeId: "0xc9b8f9a587defe5aa07b029aac99efea5c63ac64004a3ae88e2d21b63da30ccf",
    scopes: ["instagram.profile"],
    grantVersion: 1n,
    expiresAt: 0n,
  };

  const scopesHash = ethers.keccak256(
    ethers.concat(input.scopes.map((s) => ethers.keccak256(ethers.toUtf8Bytes(s))))
  );
  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "bytes32", "bytes32", "uint256", "uint256"],
      [typeHash, input.grantorAddress, input.granteeId, scopesHash, input.grantVersion, input.expiresAt],
    ),
  );
  const domainSeparator = await perms.domainSeparator();
  const digest = ethers.keccak256(
    ethers.concat(["0x1901", domainSeparator, structHash]),
  );
  const recovered = ethers.recoverAddress(digest, SIGNATURE);
  console.log("\ndigest:    ", digest);
  console.log("recovered: ", recovered);
  console.log("grantor:   ", GRANTOR);
  console.log("match grantor?", recovered.toLowerCase() === GRANTOR.toLowerCase());

  // 3. Check the recovered address against the servers registry
  const servers = await ethers.getContractAt("DataPortabilityServersV2Implementation", SERVERS_PROXY);
  const activeId = await servers.activeServerId(recovered);
  console.log("\nactiveServerId(recovered):", activeId);
  if (activeId !== ethers.ZeroHash) {
    const info = await servers.getServer(activeId);
    console.log("server owner:             ", info.ownerAddress);
    console.log("trusted for grantor?      ", info.ownerAddress.toLowerCase() === GRANTOR.toLowerCase());
  }

  // 4. Enumerate every server the grantor has registered
  const owned = await servers.ownerServers(GRANTOR);
  console.log("\nServers registered by grantor", GRANTOR + ":");
  if (owned.length === 0) {
    console.log("  <none>");
  } else {
    for (const s of owned) {
      console.log(`  serverId=${s.id}  serverAddress=${s.serverAddress}  revokedAtBlock=${s.revokedAtBlock}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
