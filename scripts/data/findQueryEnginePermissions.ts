import { ethers } from "hardhat";
import queryEngineAbi from "./abi/QueryEngineAbi.json";
import dataRefinerRegistryAbi from "./abi/DataRefinerRegistryAbi.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface Permission {
  permissionId: bigint;
  grantee: string;
  approved: boolean;
  refinerId: bigint;
  tableName: string;
  columnName: string;
  price: bigint;
  tokenAddress: string;
}

// IDataRefinerRegistry.RefinerInfo struct
interface RefinerInfo {
  dlpId: bigint;
  owner: string;
  name: string;
  schemaDefinitionUrl: string;
  refinementInstructionUrl: string;
}

async function findQueryEnginePermissions(dlpId?: number) {
  // Get contract addresses from environment or hardcode them
  const QUERY_ENGINE_ADDRESS = process.env.QUERY_ENGINE_ADDRESS || "0xd25Eb66EA2452cf3238A2eC6C1FD1B7F5B320490";
  const DATA_REFINER_REGISTRY_ADDRESS = process.env.DATA_REFINER_REGISTRY_ADDRESS || "0x93c3EF89369fDcf08Be159D9DeF0F18AB6Be008c";

  // Get signer
  const [signer] = await ethers.getSigners();
  
  console.log(`Finding all permissions in Query Engine${dlpId ? ` for DLP ${dlpId}` : ""}...`);
  console.log("=".repeat(60));

  // Connect to contracts
  const queryEngine = new ethers.Contract(QUERY_ENGINE_ADDRESS, queryEngineAbi, signer);
  const dataRefinerRegistry = new ethers.Contract(DATA_REFINER_REGISTRY_ADDRESS, dataRefinerRegistryAbi, signer);

  try {
    // Get total permissions count
    const permissionsCount = await queryEngine.permissionsCount();
    console.log(`Total permissions in Query Engine: ${permissionsCount}`);
    console.log("-".repeat(60));

    const allPermissions: Permission[] = [];
    const dlpPermissions: Permission[] = [];
    const refinerInfoMap: Map<string, RefinerInfo> = new Map();

    // Iterate through all permissions
    for (let i = 1; i <= permissionsCount; i++) {
      try {
        const permission = await queryEngine.permissions(i);
        
        const perm: Permission = {
          permissionId: BigInt(i),
          grantee: permission.grantee,
          approved: permission.approved,
          refinerId: permission.refinerId,
          tableName: permission.tableName,
          columnName: permission.columnName,
          price: permission.price,
          tokenAddress: permission.tokenAddress
        };

        const refinerIdStr = perm.refinerId.toString();
        
        // Always fetch refiner info to show DLP ID in summary
        if (!refinerInfoMap.has(refinerIdStr)) {
          try {
            const refinerInfo = await dataRefinerRegistry.refiners(perm.refinerId);
            refinerInfoMap.set(refinerIdStr, refinerInfo);
          } catch (e) {
            console.error(`Error fetching refiner info for ID ${refinerIdStr}:`, e);
            // Continue without refiner info
          }
        }

        // If dlpId is provided, check if this refiner belongs to the specified DLP
        if (dlpId) {
          const refinerInfo = refinerInfoMap.get(refinerIdStr);
          if (!refinerInfo || refinerInfo.dlpId.toString() !== dlpId.toString()) {
            continue; // Skip this permission if it doesn't belong to the target DLP
          }
        }

        allPermissions.push(perm);
        if (dlpId) {
          dlpPermissions.push(perm);
        }

        // Display permission details
        if (!dlpId || (dlpId && dlpPermissions.includes(perm))) {
          console.log(`\nPermission ID: ${perm.permissionId}`);
          console.log(`  Refiner ID: ${perm.refinerId}`);
          
          // Show refiner info if we have it
          const refinerInfo = refinerInfoMap.get(perm.refinerId.toString());
          if (refinerInfo) {
            console.log(`  Refiner Name: ${refinerInfo.name}`);
            console.log(`  DLP ID: ${refinerInfo.dlpId}`);
          }
          
          console.log(`  Grantee: ${perm.grantee === ZERO_ADDRESS ? "Everyone (Generic Permission)" : perm.grantee}`);
          console.log(`  Table: ${perm.tableName}`);
          console.log(`  Column: ${perm.columnName}`);
          console.log(`  Price: ${ethers.formatEther(perm.price)} ${perm.tokenAddress === ZERO_ADDRESS ? "ETH" : "tokens"}`);
          console.log(`  Token Address: ${perm.tokenAddress}`);
          console.log(`  Approved: ${perm.approved}`);
        }
      } catch (e) {
        // Permission might not exist at this ID
        console.error(`Error reading permission ${i}:`, e);
        continue;
      }
    }

    // Use the appropriate permissions array for summary
    const permissionsToSummarize = dlpId ? dlpPermissions : allPermissions;

    // Group permissions by refinerId or by DLP then refiner
    const permissionsByRefiner = new Map<string, Permission[]>();
    const permissionsByDlp = new Map<string, Map<string, Permission[]>>();
    
    for (const perm of permissionsToSummarize) {
      const refinerId = perm.refinerId.toString();
      
      // Group by refiner (for when DLP_ID is provided)
      if (!permissionsByRefiner.has(refinerId)) {
        permissionsByRefiner.set(refinerId, []);
      }
      permissionsByRefiner.get(refinerId)!.push(perm);
      
      // Group by DLP then refiner (for when no DLP_ID is provided)
      if (!dlpId) {
        const refinerInfo = refinerInfoMap.get(refinerId);
        if (refinerInfo) {
          const dlpIdStr = refinerInfo.dlpId.toString();
          
          if (!permissionsByDlp.has(dlpIdStr)) {
            permissionsByDlp.set(dlpIdStr, new Map<string, Permission[]>());
          }
          
          const dlpRefiners = permissionsByDlp.get(dlpIdStr)!;
          if (!dlpRefiners.has(refinerId)) {
            dlpRefiners.set(refinerId, []);
          }
          dlpRefiners.get(refinerId)!.push(perm);
        }
      }
    }

    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("SUMMARY:");
    
    console.log(`Total permissions found: ${permissionsToSummarize.length}${dlpId ? ` for DLP ${dlpId}` : ""}`);
    
    const approvedPermissions = permissionsToSummarize.filter(p => p.approved);
    const pendingPermissions = permissionsToSummarize.filter(p => !p.approved);
    const genericPermissions = permissionsToSummarize.filter(p => p.grantee === ZERO_ADDRESS);
    const specificPermissions = permissionsToSummarize.filter(p => p.grantee !== ZERO_ADDRESS);
    
    console.log(`  - Approved permissions: ${approvedPermissions.length}`);
    console.log(`  - Pending permissions: ${pendingPermissions.length}`);
    console.log(`  - Generic permissions (for everyone): ${genericPermissions.length}`);
    console.log(`  - Specific permissions (for addresses): ${specificPermissions.length}`);
    
    if (dlpId) {
      // When filtering by DLP, show by refiner
      console.log(`\nPermissions by Refiner ID:`);
      for (const [refinerId, perms] of permissionsByRefiner) {
        const refinerInfo = refinerInfoMap.get(refinerId);
        const dlpIdText = refinerInfo ? ` (DLP ${refinerInfo.dlpId})` : '';
        const permissionIds = perms.map(p => p.permissionId.toString());
        
        console.log(`  Refiner ${refinerId}${dlpIdText}: ${perms.length} permissions`);
        console.log(`    Permission IDs: [${permissionIds.join(', ')}]`);
      }
    } else {
      // When no DLP filter, show by DLP first, then refiner
      console.log(`\nPermissions by DLP ID:`);
      
      // Sort DLP IDs numerically
      const sortedDlpIds = Array.from(permissionsByDlp.keys()).sort((a, b) => parseInt(a) - parseInt(b));
      
      for (const dlpIdStr of sortedDlpIds) {
        const dlpRefiners = permissionsByDlp.get(dlpIdStr)!;
        const totalDlpPermissions = Array.from(dlpRefiners.values()).reduce((sum, perms) => sum + perms.length, 0);
        
        console.log(`\n  DLP ${dlpIdStr}: ${totalDlpPermissions} permissions`);
        
        // Sort refiner IDs numerically
        const sortedRefinerIds = Array.from(dlpRefiners.keys()).sort((a, b) => parseInt(a) - parseInt(b));
        
        for (const refinerId of sortedRefinerIds) {
          const perms = dlpRefiners.get(refinerId)!;
          const permissionIds = perms.map(p => p.permissionId.toString());
          
          console.log(`    Refiner ${refinerId}: ${perms.length} permissions`);
          console.log(`      Permission IDs: [${permissionIds.join(', ')}]`);
        }
      }
    }
    
    // Print list of permission IDs
    if (dlpId && dlpPermissions.length > 0) {
      console.log(`\nPermission IDs for DLP ${dlpId}:`);
      const permissionIds = dlpPermissions.map(p => p.permissionId.toString());
      console.log(`[${permissionIds.join(', ')}]`);
    }

    // Export results to JSON
    const results = {
      timestamp: new Date().toISOString(),
      contractAddress: QUERY_ENGINE_ADDRESS,
      dataRefinerRegistryAddress: DATA_REFINER_REGISTRY_ADDRESS,
      dlpId: dlpId || null,
      totalPermissionsCount: permissionsCount.toString(),
      permissions: permissionsToSummarize.map(p => ({
        permissionId: p.permissionId.toString(),
        grantee: p.grantee,
        approved: p.approved,
        refinerId: p.refinerId.toString(),
        tableName: p.tableName,
        columnName: p.columnName,
        price: p.price.toString(),
        priceFormatted: ethers.formatEther(p.price),
        tokenAddress: p.tokenAddress
      })),
      summary: {
        totalPermissions: permissionsToSummarize.length,
        approvedPermissions: approvedPermissions.length,
        pendingPermissions: pendingPermissions.length,
        genericPermissions: genericPermissions.length,
        specificPermissions: specificPermissions.length,
        uniqueRefiners: permissionsByRefiner.size
      },
      permissionsByRefiner: Object.fromEntries(
        Array.from(permissionsByRefiner.entries()).map(([refinerId, perms]) => [
          refinerId,
          perms.map(p => p.permissionId.toString())
        ])
      )
    };
    
    const fs = await import('fs');
    const outputPath = dlpId 
      ? `./query_engine_permissions_dlp_${dlpId}_${Date.now()}.json`
      : `./query_engine_permissions_${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults exported to: ${outputPath}`);
    
  } catch (error) {
    console.error("Error finding Query Engine permissions:", error);
  }
}

// Alternative function to get permissions for a specific grantee and refinerId
async function getPermissionsForGrantee(granteeAddress: string, refinerId: number) {
  const QUERY_ENGINE_ADDRESS = process.env.QUERY_ENGINE_ADDRESS || "0x..."; // Replace with actual address
  const [signer] = await ethers.getSigners();
  const queryEngine = new ethers.Contract(QUERY_ENGINE_ADDRESS, queryEngineAbi, signer);

  try {
    console.log(`\nGetting permissions for grantee ${granteeAddress} and refiner ${refinerId}...`);
    const permissions = await queryEngine.getPermissions(refinerId, granteeAddress);
    
    console.log(`Found ${permissions.length} permissions:`);
    for (const perm of permissions) {
      console.log(`\n  Permission ID: ${perm.permissionId}`);
      console.log(`  Table: ${perm.tableName}`);
      console.log(`  Column: ${perm.columnName}`);
      console.log(`  Price: ${ethers.formatEther(perm.price)}`);
      console.log(`  Approved: ${perm.approved}`);
    }
    
    return permissions;
  } catch (error) {
    console.error("Error getting permissions:", error);
  }
}

// Main execution
async function main() {
  // Check environment variables first
  const dlpIdFromEnv = process.env.DLP_ID;
  const granteeFromEnv = process.env.GRANTEE;
  const refinerIdFromEnv = process.env.REFINER_ID;
  
  if (dlpIdFromEnv) {
    // Get permissions for specific DLP from env
    const dlpId = parseInt(dlpIdFromEnv);
    
    if (isNaN(dlpId)) {
      console.error("Invalid DLP ID in environment variable");
      process.exit(1);
    }
    
    await findQueryEnginePermissions(dlpId);
  } else if (granteeFromEnv && refinerIdFromEnv) {
    // Get permissions for specific grantee and refiner from env
    const refinerId = parseInt(refinerIdFromEnv);
    
    if (!ethers.isAddress(granteeFromEnv)) {
      console.error("Invalid grantee address in environment variable");
      process.exit(1);
    }
    
    if (isNaN(refinerId)) {
      console.error("Invalid refiner ID in environment variable");
      process.exit(1);
    }
    
    await getPermissionsForGrantee(granteeFromEnv, refinerId);
  } else {
    // No environment variables set - get all permissions
    await findQueryEnginePermissions();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });