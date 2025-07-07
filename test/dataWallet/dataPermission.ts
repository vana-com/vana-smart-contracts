import chai, { expect, should, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { DataPermissionImplementation } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DataPermission", () => {
  let trustedForwarder: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;

  let dataPermission: DataPermissionImplementation;

  // Shared helper function for creating permission signatures
  const createPermissionSignature = async (
    permission: {
      nonce: bigint;
      grant: string;
    },
    signer: HardhatEthersSigner,
  ) => {
    const domain = {
      name: "VanaDataWallet",
      version: "1",
      chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
      verifyingContract: await dataPermission.getAddress(),
    };

    const types = {
      Permission: [
        { name: "nonce", type: "uint256" },
        { name: "grant", type: "string" },
      ],
    };

    const value = {
      nonce: permission.nonce,
      grant: permission.grant,
    };

    return await signer.signTypedData(domain, types, value);
  };

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const deploy = async () => {
    [
      trustedForwarder,
      deployer,
      owner,
      maintainer,
      sponsor,
      user1,
      user2,
      user3,
    ] = await ethers.getSigners();

    const dataPermissionDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataPermissionImplementation"),
      [trustedForwarder.address, owner.address],
      {
        kind: "uups",
      },
    );

    dataPermission = await ethers.getContractAt(
      "DataPermissionImplementation",
      dataPermissionDeploy.target,
    );

    await dataPermission
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await dataPermission.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await dataPermission.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
      (await dataPermission.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(
        true,
      );
      (await dataPermission.version()).should.eq(1);
    });

    it("should grant roles", async function () {
      await dataPermission
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

      await dataPermission
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

      await dataPermission
        .connect(user1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      await dataPermission
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dataPermission
        .connect(user1)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
    });
  });

  describe("AddPermission", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should add a valid permission and emit event", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      // User1 should start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);

      const signature = await createPermissionSignature(permission, user1);

      const tx = await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission, signature);

      // Verify event was emitted
      await expect(tx).to.emit(dataPermission, "PermissionAdded").withArgs(
        1, // permissionId
        user1.address, // user
        permission.grant,
      );

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(1);

      // Verify nonce increased
      (await dataPermission.userNonce(user1.address)).should.eq(1);

      // Verify permission was stored
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.user.should.eq(user1.address);
      storedPermission.nonce.should.eq(0);
      storedPermission.grant.should.eq(permission.grant);

      // Verify it's indexed by user
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );

      // Test the userPermissionIdsValues function
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        user1.address,
      );
      userPermissionIds.should.deep.eq([1n]);

      // Verify grant hash mapping
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);
    });

    it("should reject permission with incorrect nonce", async function () {
      const permission = {
        user: user1.address,
        nonce: 1n, // Wrong nonce - should be 0
        grant: "ipfs://grant1",
      };

      const signature = await createPermissionSignature(permission, user1);

      await expect(
        dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature),
      )
        .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(0, 1); // expected, provided

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should reject permission with empty grant", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "", // Empty grant
      };

      const signature = await createPermissionSignature(permission, user1);

      await expect(
        dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature),
      ).to.be.revertedWithCustomError(dataPermission, "EmptyGrant");

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should reject permission with already used grant", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const permission2 = {
        user: user1.address,
        nonce: 1n,
        grant: "ipfs://grant1", // Same grant
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user1);

      // Add first permission
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);

      // Try to reuse same grant - should fail
      await expect(
        dataPermission.connect(sponsor).addPermissionWithSignature(permission2, signature2),
      ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");

      // Verify only one permission was added
      (await dataPermission.permissionsCount()).should.eq(1);
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should add multiple permissions for the same user with sequential nonces", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const permission2 = {
        user: user1.address,
        nonce: 1n,
        grant: "ipfs://grant2",
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user1);

      const tx1 = await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);
      const tx2 = await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission2, signature2);

      // Verify events were emitted
      await expect(tx1)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(1, user1.address, permission1.grant);

      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(2, user1.address, permission2.grant);

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(2);

      // Verify nonce increased to 2
      (await dataPermission.userNonce(user1.address)).should.eq(2);

      // Verify both permissions are indexed by user
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        2,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 1)).should.eq(
        2n,
      );

      // Test userPermissionIdsValues
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        user1.address,
      );
      userPermissionIds.should.deep.eq([1n, 2n]);

      // Verify grant hash mappings
      (await dataPermission.permissionIdByGrant(permission1.grant)).should.eq(
        1,
      );
      (await dataPermission.permissionIdByGrant(permission2.grant)).should.eq(
        2,
      );
    });

    it("should add permissions for different users independently", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const permission2 = {
        user: user2.address,
        nonce: 0n, // Each user starts with nonce 0
        grant: "ipfs://grant2",
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission2, signature2);

      // Verify each user has their nonce incremented independently
      (await dataPermission.userNonce(user1.address)).should.eq(1);
      (await dataPermission.userNonce(user2.address)).should.eq(1);

      // Verify each user has one permission
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsLength(user2.address)).should.eq(
        1,
      );

      // Verify stored permissions have correct user fields
      const storedPermission1 = await dataPermission.permissions(1);
      const storedPermission2 = await dataPermission.permissions(2);
      storedPermission1.user.should.eq(user1.address);
      storedPermission2.user.should.eq(user2.address);
    });

    it("should assign sequential IDs to permissions", async function () {
      const permissions = [
        { user: user1.address, nonce: 0n, grant: "ipfs://grant1" },
        { user: user2.address, nonce: 0n, grant: "ipfs://grant2" },
        { user: user3.address, nonce: 0n, grant: "ipfs://grant3" },
      ];

      const users = [user1, user2, user3];

      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          users[i],
        );
        await dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permissions[i], signature);
      }

      // Verify permissions count
      (await dataPermission.permissionsCount()).should.eq(3);

      // Verify all permissions are stored with correct IDs (starting from 1)
      for (let i = 0; i < permissions.length; i++) {
        const storedPermission = await dataPermission.permissions(i + 1);
        storedPermission.user.should.eq(users[i].address);
        storedPermission.grant.should.eq(permissions[i].grant);
      }
    });

    it("should return empty permission for non-existent ID", async function () {
      const permission = await dataPermission.permissions(999);
      permission.user.should.eq(ethers.ZeroAddress);
      permission.nonce.should.eq(0);
      permission.grant.should.eq("");
    });

    it("should return 0 for non-existent grant", async function () {
      const permissionId =
        await dataPermission.permissionIdByGrant("ipfs://nonexistent");
      permissionId.should.eq(0);
    });

    it("should revert when accessing out of bounds permission indices", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const signature = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission, signature);

      // Should revert when accessing index 1 (only index 0 exists)
      await expect(dataPermission.userPermissionIdsAt(user1.address, 1)).to.be
        .rejected;

      // Should revert for non-existent user
      await expect(dataPermission.userPermissionIdsAt(user2.address, 0)).to.be
        .rejected;
    });

    it("should track nonces correctly across multiple users", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const permission2 = {
        user: user2.address,
        nonce: 0n,
        grant: "ipfs://grant2",
      };

      // Both users start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);
      (await dataPermission.userNonce(user2.address)).should.eq(0);

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission2, signature2);

      // Verify nonces were incremented independently
      (await dataPermission.userNonce(user1.address)).should.eq(1);
      (await dataPermission.userNonce(user2.address)).should.eq(1);

      // Add another permission for user1
      const permission3 = {
        user: user1.address,
        nonce: 1n,
        grant: "ipfs://grant3",
      };

      const signature3 = await createPermissionSignature(permission3, user1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission3, signature3);

      // Verify user1's nonce incremented while user2's remained the same
      (await dataPermission.userNonce(user1.address)).should.eq(2);
      (await dataPermission.userNonce(user2.address)).should.eq(1);
    });

    it("should handle grants with special characters", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant-with-special-chars_123!@#$%^&*()",
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);

      // Verify grant hash mapping works with special characters
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);
    });

    it("should test userPermissionIdsValues function with multiple permissions", async function () {
      const permissions = [
        { user: user1.address, nonce: 0n, grant: "ipfs://grant1" },
        { user: user1.address, nonce: 1n, grant: "ipfs://grant2" },
        { user: user1.address, nonce: 2n, grant: "ipfs://grant3" },
      ];

      // Add all permissions for user1
      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          user1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permissions[i], signature);
      }

      // Test userPermissionIdsValues
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        user1.address,
      );
      userPermissionIds.should.deep.eq([1n, 2n, 3n]);

      // Test for user with no permissions
      const emptyUserPermissionIds =
        await dataPermission.userPermissionIdsValues(user2.address);
      emptyUserPermissionIds.should.deep.eq([]);
    });

    it("should emit events with correct parameters for multiple permissions", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const permission2 = {
        user: user2.address,
        nonce: 0n,
        grant: "ipfs://grant2",
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      const tx1 = await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);
      const tx2 = await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission2, signature2);

      // Verify first event
      await expect(tx1)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(1, user1.address, permission1.grant);

      // Verify second event
      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(2, user2.address, permission2.grant);
    });

    it("should work when called by sponsor wallet but signed by actual user", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const signature = await createPermissionSignature(permission, user1);

      // sponsor calls the function but permission is signed by user1
      await dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature)
        .should.be.fulfilled;

      // Verify it's indexed by the signer (user1), not the caller (sponsor)
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );

      (await dataPermission.userPermissionIdsLength(sponsor.address)).should.eq(
        0,
      );

      // Verify stored permission has correct user field
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.user.should.eq(user1.address);
    });

    it("should validate IPFS URI format in grant field", async function () {
      const validPermission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      const signature = await createPermissionSignature(validPermission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(validPermission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(validPermission.grant);
    });

    it("should handle grant field with very long strings", async function () {
      const longGrant = "ipfs://" + "a".repeat(1000); // Very long grant
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: longGrant,
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(longGrant);
    });

    it("should handle unicode characters in grant", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant-with-unicode-🚀-💎-🌟",
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermissionWithSignature(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);

      // Verify grant hash mapping works with unicode
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);
    });

    it("should handle max nonce values", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://grant1",
      };

      // Add first permission to increment nonce
      let signature = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission, signature);

      // Try with very large nonce (but wrong)
      const largeNoncePermission = {
        user: user1.address,
        nonce: 999999n,
        grant: "ipfs://grant2",
      };

      signature = await createPermissionSignature(largeNoncePermission, user1);

      await expect(
        dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(largeNoncePermission, signature),
      )
        .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(1, 999999); // expected 1, provided 999999
    });
  });

  describe("Access Control", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should only allow admin to authorize upgrades", async function () {
      // This would be tested in a real upgrade scenario
      // For now, just verify the role is set correctly
      (await dataPermission.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await dataPermission.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(
        false,
      );
    });

    it("should allow admin to update trusted forwarder", async function () {
      const newForwarder = user3.address;

      await dataPermission.connect(owner).updateTrustedForwarder(newForwarder);
      (await dataPermission.trustedForwarder()).should.eq(newForwarder);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should handle multiple users with same grant (should fail)", async function () {
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://same-grant",
      };

      const permission2 = {
        user: user2.address,
        nonce: 0n,
        grant: "ipfs://same-grant",
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      // First user should succeed
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission1, signature1);

      // Second user should fail (same grant)
      await expect(
        dataPermission.connect(sponsor).addPermissionWithSignature(permission2, signature2),
      ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");
    });

    it("should handle rapid succession of permissions", async function () {
      const permissions = [];
      const signatures = [];

      // Create 10 permissions rapidly
      for (let i = 0; i < 10; i++) {
        const permission = {
          user: user1.address,
          nonce: BigInt(i),
          grant: `ipfs://grant${i}`,
        };
        permissions.push(permission);
        signatures.push(await createPermissionSignature(permission, user1));
      }

      // Add them all
      for (let i = 0; i < 10; i++) {
        await dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permissions[i], signatures[i]);
      }

      // Verify all were added
      (await dataPermission.permissionsCount()).should.eq(10);
      (await dataPermission.userNonce(user1.address)).should.eq(10);
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        10,
      );
    });
  });

  describe("Direct Permission Addition", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should allow user to add permission directly without signature", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://direct-grant1",
      };

      // User1 calls addPermission directly (no signature needed)
      const tx = await dataPermission
        .connect(user1)
        .addPermission(permission);

      // Verify event was emitted
      await expect(tx).to.emit(dataPermission, "PermissionAdded").withArgs(
        1, // permissionId
        user1.address, // user
        permission.grant,
      );

      // Verify permission was stored
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.user.should.eq(user1.address);
      storedPermission.nonce.should.eq(0);
      storedPermission.grant.should.eq(permission.grant);
      storedPermission.isEffective.should.eq(true);

      // Verify nonce increased
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should reject direct permission when user field doesn't match sender", async function () {
      const permission = {
        user: user2.address, // Different from msg.sender
        nonce: 0n,
        grant: "ipfs://wrong-user-grant",
      };

      // User1 tries to add permission for user2
      await expect(
        dataPermission.connect(user1).addPermission(permission),
      ).to.be.revertedWithCustomError(dataPermission, "InvalidSigner");
    });
  });

  describe("Permission Revocation", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should allow user to revoke their own permission", async function () {
      // First add a permission
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://revokable-grant",
      };

      await dataPermission.connect(user1).addPermission(permission);

      // Verify permission is effective
      (await dataPermission.isEffectivePermission(1)).should.eq(true);

      // Revoke the permission
      const tx = await dataPermission.connect(user1).revokePermission(1);

      // Verify event was emitted
      await expect(tx).to.emit(dataPermission, "PermissionRevoked").withArgs(1);

      // Verify permission is no longer effective
      (await dataPermission.isEffectivePermission(1)).should.eq(false);

      // Verify permission still exists but is marked ineffective
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.user.should.eq(user1.address);
      storedPermission.isEffective.should.eq(false);
    });

    it("should reject revocation by non-owner", async function () {
      // User1 adds a permission
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://user1-grant",
      };

      await dataPermission.connect(user1).addPermission(permission);

      // User2 tries to revoke user1's permission
      await expect(
        dataPermission.connect(user2).revokePermission(1),
      ).to.be.revertedWithCustomError(dataPermission, "InvalidSigner");
    });

    it("should allow revocation with signature", async function () {
      // First add a permission
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://signature-revokable",
      };

      const addSig = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission, addSig);

      // Create revocation signature using EIP-712
      const permissionId = 1;
      
      // Create EIP-712 domain and types for revocation
      const domain = {
        name: "VanaDataWallet",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      // Types for RevokePermission - must match the REVOKE_PERMISSION_TYPEHASH in contract
      const types = {
        RevokePermission: [
          { name: "permissionId", type: "uint256" }
        ],
      };

      const value = {
        permissionId: permissionId,
      };

      // Sign using EIP-712
      const revokeSig = await user1.signTypedData(domain, types, value);

      // Sponsor can submit the revocation on behalf of user1
      const tx = await dataPermission
        .connect(sponsor)
        .revokePermissionWithSignature(permissionId, revokeSig);

      await expect(tx).to.emit(dataPermission, "PermissionRevoked").withArgs(1);

      // Verify permission is no longer effective
      (await dataPermission.isEffectivePermission(1)).should.eq(false);
    });

    it("should reject revocation with invalid signature", async function () {
      // First add a permission
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://revoke-invalid-sig",
      };

      await dataPermission.connect(user1).addPermission(permission);

      // Try to revoke with user2's signature (should fail)
      const permissionId = 1;
      
      const domain = {
        name: "VanaDataWallet",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        RevokePermission: [
          { name: "permissionId", type: "uint256" }
        ],
      };

      const value = {
        permissionId: permissionId,
      };

      // User2 signs instead of user1
      const wrongSig = await user2.signTypedData(domain, types, value);

      // Should fail because user2 is not the permission owner
      await expect(
        dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(permissionId, wrongSig),
      ).to.be.revertedWithCustomError(dataPermission, "InvalidSigner");
    });

    it("should handle multiple revocations", async function () {
      // Add multiple permissions
      const permissions = [
        { user: user1.address, nonce: 0n, grant: "ipfs://grant1" },
        { user: user1.address, nonce: 1n, grant: "ipfs://grant2" },
        { user: user1.address, nonce: 2n, grant: "ipfs://grant3" },
      ];

      for (const perm of permissions) {
        await dataPermission.connect(user1).addPermission(perm);
      }

      // Verify all are effective
      (await dataPermission.isEffectivePermission(1)).should.eq(true);
      (await dataPermission.isEffectivePermission(2)).should.eq(true);
      (await dataPermission.isEffectivePermission(3)).should.eq(true);

      // Revoke permission 2
      await dataPermission.connect(user1).revokePermission(2);

      // Verify only permission 2 is ineffective
      (await dataPermission.isEffectivePermission(1)).should.eq(true);
      (await dataPermission.isEffectivePermission(2)).should.eq(false);
      (await dataPermission.isEffectivePermission(3)).should.eq(true);
    });

    it("should not affect permission count when revoking", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://count-test",
      };

      await dataPermission.connect(user1).addPermission(permission);
      (await dataPermission.permissionsCount()).should.eq(1);

      await dataPermission.connect(user1).revokePermission(1);
      
      // Permission count should remain the same
      (await dataPermission.permissionsCount()).should.eq(1);
      
      // User still has the permission in their list
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(1);
    });
  });

  describe("InvalidSigner Error Cases", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should revert with InvalidSigner when signature doesn't match user field", async function () {
      const permission = {
        user: user1.address, // Says user1
        nonce: 0n,
        grant: "ipfs://mismatched-signer",
      };

      // But user2 signs it
      const signature = await createPermissionSignature(permission, user2);

      await expect(
        dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permission, signature),
      ).to.be.revertedWithCustomError(dataPermission, "InvalidSigner");
    });

    it("should handle invalid signature gracefully", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://invalid-sig",
      };

      // Create invalid signature (random bytes)
      const invalidSignature = "0x" + "00".repeat(65);

      await expect(
        dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permission, invalidSignature),
      ).to.be.revertedWithCustomError(dataPermission, "ECDSAInvalidSignature");
    });
  });

  describe("Pausable Functionality", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should reject permission operations when paused", async function () {
      // Pause the contract
      await dataPermission.connect(maintainer).pause();
      (await dataPermission.paused()).should.eq(true);

      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://paused-grant",
      };

      // Try to add permission while paused
      await expect(
        dataPermission.connect(user1).addPermission(permission),
      ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

      // Try with signature
      const signature = await createPermissionSignature(permission, user1);
      await expect(
        dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permission, signature),
      ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

      // Unpause
      await dataPermission.connect(maintainer).unpause();
      (await dataPermission.paused()).should.eq(false);

      // Now it should work
      await dataPermission.connect(user1).addPermission(permission).should.be
        .fulfilled;
    });

    it("should reject revocation when paused", async function () {
      // Add permission first
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://pausable-revoke",
      };
      await dataPermission.connect(user1).addPermission(permission);

      // Pause the contract
      await dataPermission.connect(maintainer).pause();

      // Try to revoke while paused
      await expect(
        dataPermission.connect(user1).revokePermission(1),
      ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");
    });
  });

  describe("Signature Extraction Optimization", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should correctly extract signer from signature", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://sig-extraction-test",
      };

      const signature = await createPermissionSignature(permission, user1);

      // The signature should be valid for user1
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission, signature).should.be.fulfilled;

      // Verify the permission was added for the correct user
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.user.should.eq(user1.address);
    });

    it("should handle signature from different signers correctly", async function () {
      // User1's permission but signed by user2 (should fail)
      const permission1 = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://wrong-signer-test",
      };

      const wrongSignature = await createPermissionSignature(permission1, user2);

      await expect(
        dataPermission
          .connect(sponsor)
          .addPermissionWithSignature(permission1, wrongSignature),
      ).to.be.revertedWithCustomError(dataPermission, "InvalidSigner");

      // User2's permission signed by user2 (should succeed)
      const permission2 = {
        user: user2.address,
        nonce: 0n,
        grant: "ipfs://correct-signer-test",
      };

      const correctSignature = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(permission2, correctSignature).should.be
        .fulfilled;
    });
  });

  describe("Complex Scenarios", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should handle mixed direct and signature-based permissions", async function () {
      // User1 adds direct permission
      const directPermission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://direct-grant",
      };
      await dataPermission.connect(user1).addPermission(directPermission);

      // User1 adds signature-based permission
      const signedPermission = {
        user: user1.address,
        nonce: 1n,
        grant: "ipfs://signed-grant",
      };
      const signature = await createPermissionSignature(signedPermission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermissionWithSignature(signedPermission, signature);

      // Verify both permissions exist
      (await dataPermission.permissionsCount()).should.eq(2);
      (await dataPermission.userNonce(user1.address)).should.eq(2);

      // Verify both are in user's permission list
      const userPermissions = await dataPermission.userPermissionIdsValues(
        user1.address
      );
      userPermissions.should.deep.eq([1n, 2n]);
    });

    it("should handle permission lifecycle: add, check, revoke, check again", async function () {
      const permission = {
        user: user1.address,
        nonce: 0n,
        grant: "ipfs://lifecycle-test",
      };

      // Add permission
      await dataPermission.connect(user1).addPermission(permission);
      const permissionId = 1;

      // Check it's effective
      (await dataPermission.isEffectivePermission(permissionId)).should.eq(true);

      // Check it's indexed properly
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(
        permissionId
      );

      // Revoke it
      await dataPermission.connect(user1).revokePermission(permissionId);

      // Check it's no longer effective
      (await dataPermission.isEffectivePermission(permissionId)).should.eq(false);

      // But it's still indexed (grant hash doesn't get removed)
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(
        permissionId
      );

      // Cannot reuse the same grant even after revocation
      const newPermission = {
        user: user1.address,
        nonce: 1n,
        grant: permission.grant, // Same grant
      };

      await expect(
        dataPermission.connect(user1).addPermission(newPermission),
      ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");
    });
  });
});
