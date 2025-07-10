import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { DataPermissionImplementation, MockDataRegistry } from "../../typechain-types";
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
  let server1: HardhatEthersSigner;
  let server2: HardhatEthersSigner;

  let dataPermission: DataPermissionImplementation;
  let dataRegistry: MockDataRegistry;

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
      server1,
      server2,
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

    // Deploy MockDataRegistry
    const MockDataRegistry = await ethers.getContractFactory("MockDataRegistry");
    dataRegistry = await MockDataRegistry.deploy();
    await dataRegistry.waitForDeployment();

    // Update dataPermission with the mock registry
    await dataPermission
      .connect(owner)
      .updateDataRegistry(await dataRegistry.getAddress());
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

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        grant: string;
        fileIds: bigint[];
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
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createRevokePermissionSignature = async (
      revokePermissionInput: {
        nonce: bigint;
        permissionId: bigint;
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
        RevokePermission: [
          { name: "nonce", type: "uint256" },
          { name: "permissionId", type: "uint256" },
        ],
      };

      const value = {
        nonce: revokePermissionInput.nonce,
        permissionId: revokePermissionInput.permissionId,
      };

      return await signer.signTypedData(domain, types, value);
    };

    it("should add a valid permission and emit event", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      // User1 should start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);

      const signature = await createPermissionSignature(permission, user1);

      const tx = await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

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
      storedPermission.grantor.should.eq(user1.address);
      storedPermission.nonce.should.eq(0);
      storedPermission.grant.should.eq(permission.grant);
      storedPermission.signature.should.eq(signature);

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
        nonce: 1n, // Wrong nonce - should be 0
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature),
      )
        .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(0, 1); // expected, provided

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should reject permission with empty grant", async function () {
      const permission = {
        nonce: 0n,
        grant: "", // Empty grant
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature),
      ).to.be.revertedWithCustomError(dataPermission, "EmptyGrant");

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should reject permission with already used grant", async function () {
      const permission1 = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 1n,
        grant: "ipfs://grant1", // Same grant
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user1);

      // Add first permission
      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);

      // Try to reuse same grant - should fail
      await expect(
        dataPermission.connect(sponsor).addPermission(permission2, signature2),
      ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");

      // Verify only one permission was added
      (await dataPermission.permissionsCount()).should.eq(1);
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should add multiple permissions for the same user with sequential nonces", async function () {
      const permission1 = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 1n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user1);

      const tx1 = await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      const tx2 = await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

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
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n, // Each user starts with nonce 0
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

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
      storedPermission1.grantor.should.eq(user1.address);
      storedPermission2.grantor.should.eq(user2.address);
    });

    it("should assign sequential IDs to permissions", async function () {
      const permissions = [
        { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
        { nonce: 0n, grant: "ipfs://grant2", fileIds: [] },
        { nonce: 0n, grant: "ipfs://grant3", fileIds: [] },
      ];

      const users = [user1, user2, user3];

      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          users[i],
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permissions[i], signature);
      }

      // Verify permissions count
      (await dataPermission.permissionsCount()).should.eq(3);

      // Verify all permissions are stored with correct IDs (starting from 1)
      for (let i = 0; i < permissions.length; i++) {
        const storedPermission = await dataPermission.permissions(i + 1);
        storedPermission.grantor.should.eq(users[i].address);
        storedPermission.grant.should.eq(permissions[i].grant);
      }
    });

    it("should return empty permission for non-existent ID", async function () {
      const permission = await dataPermission.permissions(999);
      permission.grantor.should.eq(ethers.ZeroAddress);
      permission.nonce.should.eq(0);
      permission.grant.should.eq("");
      permission.signature.should.eq("0x");
    });

    it("should return 0 for non-existent grant", async function () {
      const permissionId =
        await dataPermission.permissionIdByGrant("ipfs://nonexistent");
      permissionId.should.eq(0);
    });

    it("should revert when accessing out of bounds permission indices", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Should revert when accessing index 1 (only index 0 exists)
      await expect(dataPermission.userPermissionIdsAt(user1.address, 1)).to.be
        .rejected;

      // Should revert for non-existent user
      await expect(dataPermission.userPermissionIdsAt(user2.address, 0)).to.be
        .rejected;
    });

    it("should track nonces correctly across multiple users", async function () {
      const permission1 = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      // Both users start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);
      (await dataPermission.userNonce(user2.address)).should.eq(0);

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify nonces were incremented independently
      (await dataPermission.userNonce(user1.address)).should.eq(1);
      (await dataPermission.userNonce(user2.address)).should.eq(1);

      // Add another permission for user1
      const permission3 = {
        nonce: 1n,
        grant: "ipfs://grant3",
        fileIds: [],
      };

      const signature3 = await createPermissionSignature(permission3, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission3, signature3);

      // Verify user1's nonce incremented while user2's remained the same
      (await dataPermission.userNonce(user1.address)).should.eq(2);
      (await dataPermission.userNonce(user2.address)).should.eq(1);
    });

    it("should handle grants with special characters", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant-with-special-chars_123!@#$%^&*()",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);

      // Verify grant hash mapping works with special characters
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);
    });

    it("should test userPermissionIdsValues function with multiple permissions", async function () {
      const permissions = [
        { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
        { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
        { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
      ];

      // Add all permissions for user1
      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          user1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permissions[i], signature);
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
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      const tx1 = await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      const tx2 = await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

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
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      // sponsor calls the function but permission is signed by user1
      await dataPermission.connect(sponsor).addPermission(permission, signature)
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
      storedPermission.grantor.should.eq(user1.address);
    });

    it("should validate IPFS URI format in grant field", async function () {
      const validPermission = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(validPermission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission(validPermission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(validPermission.grant);
    });

    it("should handle grant field with very long strings", async function () {
      const longGrant = "ipfs://" + "a".repeat(1000); // Very long grant
      const permission = {
        nonce: 0n,
        grant: longGrant,
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(longGrant);
    });

    it("should handle unicode characters in grant", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant-with-unicode-🚀-💎-🌟",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);

      // Verify grant hash mapping works with unicode
      (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);
    });

    it("should store exact signature bytes", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.signature.should.eq(signature);

      // Verify signature length (should be 65 bytes for ECDSA)
      ethers.getBytes(storedPermission.signature).length.should.eq(65);
    });

    it("should handle max nonce values", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      // Add first permission to increment nonce
      let signature = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Try with very large nonce (but wrong)
      const largeNoncePermission = {
        nonce: 999999n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      signature = await createPermissionSignature(largeNoncePermission, user1);

      await expect(
        dataPermission
          .connect(sponsor)
          .addPermission(largeNoncePermission, signature),
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

  describe("RevokePermission", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        grant: string;
        fileIds: bigint[];
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
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createRevokePermissionSignature = async (
      revokePermissionInput: {
        nonce: bigint;
        permissionId: bigint;
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
        RevokePermission: [
          { name: "nonce", type: "uint256" },
          { name: "permissionId", type: "uint256" },
        ],
      };

      const value = {
        nonce: revokePermissionInput.nonce,
        permissionId: revokePermissionInput.permissionId,
      };

      return await signer.signTypedData(domain, types, value);
    };

    describe("Direct Revocation", () => {
      it("should revoke permission by owner successfully", async function () {
        // First add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Verify permission is active
        (await dataPermission.isActivePermission(1)).should.eq(true);
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(1);

        // Revoke the permission
        const tx = await dataPermission
          .connect(user1)
          .revokePermission(1);

        // Verify event was emitted
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify permission is no longer active
        (await dataPermission.isActivePermission(1)).should.eq(false);
        
        // Verify permission is removed from user's active permissions
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(0);
        
        // Verify permission data still exists but is marked inactive
        const revokedPermission = await dataPermission.permissions(1);
        revokedPermission.grantor.should.eq(user1.address);
        revokedPermission.grant.should.eq(permission.grant);
        revokedPermission.isActive.should.eq(false);
      });

      it("should reject revocation by non-owner", async function () {
        // User1 adds a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // User2 tries to revoke user1's permission
        await expect(
          dataPermission.connect(user2).revokePermission(1)
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");

        // Verify permission is still active
        (await dataPermission.isActivePermission(1)).should.eq(true);
      });

      it("should reject revoking already revoked permission", async function () {
        // Add and revoke a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await dataPermission.connect(user1).revokePermission(1);

        // Try to revoke again
        await expect(
          dataPermission.connect(user1).revokePermission(1)
        ).to.be.revertedWithCustomError(dataPermission, "InactivePermission")
        .withArgs(1);
      });

      it("should handle multiple permissions correctly", async function () {
        // Add multiple permissions
        const permissions = [
          { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Verify all are active
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(3);

        // Revoke the middle permission
        await dataPermission.connect(user1).revokePermission(2);

        // Verify correct permission was revoked
        (await dataPermission.isActivePermission(1)).should.eq(true);
        (await dataPermission.isActivePermission(2)).should.eq(false);
        (await dataPermission.isActivePermission(3)).should.eq(true);

        // Verify user now has 2 active permissions
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(2);
        
        // Verify remaining permissions
        const remainingPermIds = await dataPermission.userPermissionIdsValues(user1.address);
        remainingPermIds.should.deep.eq([1n, 3n]);
      });
    });

    describe("Signature-based Revocation", () => {
      it("should revoke permission with valid signature", async function () {
        // Add a permission first
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // User nonce should be 1 after adding permission
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Create revoke permission input
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        // Sponsor executes the revocation
        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Verify event
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify nonce was incremented
        (await dataPermission.userNonce(user1.address)).should.eq(2);

        // Verify permission is inactive
        (await dataPermission.isActivePermission(1)).should.eq(false);
      });

      it("should reject revocation with wrong nonce", async function () {
        // Add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Try to revoke with wrong nonce
        const revokeInput = {
          nonce: 0n, // Wrong - should be 1
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature)
        ).to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(1, 0);
      });

      it("should reject revocation of non-owned permission", async function () {
        // User1 adds a permission
        const permission1 = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const sig1 = await createPermissionSignature(permission1, user1);
        await dataPermission.connect(sponsor).addPermission(permission1, sig1);

        // User2 adds a permission
        const permission2 = {
          nonce: 0n,
          grant: "ipfs://grant2",
        fileIds: [],
        };

        const sig2 = await createPermissionSignature(permission2, user2);
        await dataPermission.connect(sponsor).addPermission(permission2, sig2);

        // User2 tries to revoke user1's permission (ID 1)
        const revokeInput = {
          nonce: 1n, // User2's current nonce
          permissionId: 1n, // User1's permission
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user2);

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature)
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");
      });

      it("should handle gasless revocation via sponsor", async function () {
        // Add permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        // Sponsor pays for gas
        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Verify it worked
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify the permission belongs to user1, not sponsor
        const revokedPerm = await dataPermission.permissions(1);
        revokedPerm.grantor.should.eq(user1.address);
      });
    });

    describe("Edge Cases and State Management", () => {
      it("should not affect grant hash mapping after revocation", async function () {
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Revoke the permission
        await dataPermission.connect(user1).revokePermission(1);

        // Grant hash should still map to the permission ID
        (await dataPermission.permissionIdByGrant(permission.grant)).should.eq(1);

        // But trying to add same grant again should still fail
        const permission2 = {
          nonce: 1n,
          grant: "ipfs://grant1", // Same grant
        fileIds: [],
        };

        const signature2 = await createPermissionSignature(permission2, user1);
        
        await expect(
          dataPermission.connect(sponsor).addPermission(permission2, signature2)
        ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");
      });

      it("should correctly update user permission sets", async function () {
        // Add 3 permissions
        const permissions = [
          { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Initial state
        let activePerms = await dataPermission.userPermissionIdsValues(user1.address);
        activePerms.should.deep.eq([1n, 2n, 3n]);

        // Revoke permission 2
        await dataPermission.connect(user1).revokePermission(2);

        // Check updated state
        activePerms = await dataPermission.userPermissionIdsValues(user1.address);
        activePerms.should.deep.eq([1n, 3n]);

        // Revoke permission 1
        await dataPermission.connect(user1).revokePermission(1);

        // Check state again
        activePerms = await dataPermission.userPermissionIdsValues(user1.address);
        activePerms.should.deep.eq([3n]);

        // Revoke last permission
        await dataPermission.connect(user1).revokePermission(3);

        // Should have no active permissions
        activePerms = await dataPermission.userPermissionIdsValues(user1.address);
        activePerms.should.deep.eq([]);
        
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(0);
      });

      it("should prevent replay attacks on revocation", async function () {
        // Add permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        // First revocation succeeds
        await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Replay attempt should fail due to incremented nonce
        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature)
        ).to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(2, 1); // Expected nonce 2, provided 1
      });

      it("should handle revocation of non-existent permission", async function () {
        // Try to revoke permission that doesn't exist
        await expect(
          dataPermission.connect(user1).revokePermission(999)
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");
      });

      it("should maintain correct state after mixed operations", async function () {
        // Add permission 1
        const perm1 = { nonce: 0n, grant: "ipfs://grant1", fileIds: [] };
        const sig1 = await createPermissionSignature(perm1, user1);
        await dataPermission.connect(sponsor).addPermission(perm1, sig1);

        // Add permission 2
        const perm2 = { nonce: 1n, grant: "ipfs://grant2", fileIds: [] };
        const sig2 = await createPermissionSignature(perm2, user1);
        await dataPermission.connect(sponsor).addPermission(perm2, sig2);

        // Revoke permission 1
        await dataPermission.connect(user1).revokePermission(1);

        // Add permission 3
        const perm3 = { nonce: 2n, grant: "ipfs://grant3", fileIds: [] };
        const sig3 = await createPermissionSignature(perm3, user1);
        await dataPermission.connect(sponsor).addPermission(perm3, sig3);

        // Check final state
        const activePerms = await dataPermission.userPermissionIdsValues(user1.address);
        activePerms.should.deep.eq([2n, 3n]);

        // Verify individual permission states
        (await dataPermission.isActivePermission(1)).should.eq(false);
        (await dataPermission.isActivePermission(2)).should.eq(true);
        (await dataPermission.isActivePermission(3)).should.eq(true);
      });
    });

    describe("Integration with Other Features", () => {
      it("should work correctly with trusted servers", async function () {
        // Add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Trust a server
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, "https://server1.com");

        // Revoke the permission
        await dataPermission.connect(user1).revokePermission(1);

        // Server trust should be unaffected
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        
        // Permission should be revoked
        (await dataPermission.isActivePermission(1)).should.eq(false);
      });

      it("should handle nonce correctly across different operations", async function () {
        // Initial nonce
        (await dataPermission.userNonce(user1.address)).should.eq(0);

        // Add permission (increments nonce to 1)
        const perm1 = { nonce: 0n, grant: "ipfs://grant1", fileIds: [] };
        const sig1 = await createPermissionSignature(perm1, user1);
        await dataPermission.connect(sponsor).addPermission(perm1, sig1);

        // Add another permission (increments nonce to 2)
        const perm2 = { nonce: 1n, grant: "ipfs://grant2", fileIds: [] };
        const sig2 = await createPermissionSignature(perm2, user1);
        await dataPermission.connect(sponsor).addPermission(perm2, sig2);

        // Revoke with signature (increments nonce to 3)
        const revokeInput = {
          nonce: 2n,
          permissionId: 1n,
        };
        const revokeSig = await createRevokePermissionSignature(revokeInput, user1);
        await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSig);

        // Final nonce should be 3
        (await dataPermission.userNonce(user1.address)).should.eq(3);

        // Direct revocation should not affect nonce
        await dataPermission.connect(user1).revokePermission(2);
        (await dataPermission.userNonce(user1.address)).should.eq(3);
      });
    });

    describe("Pause Functionality", () => {
      it("should reject revocation when paused", async function () {
        // Add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Pause the contract
        await dataPermission.connect(maintainer).pause();

        // Try to revoke directly
        await expect(
          dataPermission.connect(user1).revokePermission(1)
        ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

        // Try to revoke with signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };
        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature)
        ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

        // Unpause
        await dataPermission.connect(maintainer).unpause();

        // Now revocation should work
        await dataPermission.connect(user1).revokePermission(1);
        (await dataPermission.isActivePermission(1)).should.eq(false);
      });
    });

    describe("Revoked Permission Tracking", () => {
      it("should track revoked permissions with userRevokedPermissionIdsLength", async function () {
        // Initially no revoked permissions
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(0);

        // Add and revoke a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };
        const signature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, signature);
        await dataPermission.connect(user1).revokePermission(1);

        // Should have 1 revoked permission
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(1);
      });

      it("should return revoked permission IDs with userRevokedPermissionIdsValues", async function () {
        // Add multiple permissions
        const permissions = [
          { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
          { nonce: 3n, grant: "ipfs://grant4", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Initially no revoked permissions
        let revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([]);

        // Revoke permissions 2 and 4
        await dataPermission.connect(user1).revokePermission(2);
        await dataPermission.connect(user1).revokePermission(4);

        // Check revoked IDs
        revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([2n, 4n]);

        // Revoke permission 1
        await dataPermission.connect(user1).revokePermission(1);

        // Check updated revoked IDs
        revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([2n, 4n, 1n]);
      });

      it("should access revoked permissions by index with userRevokedPermissionIdsAt", async function () {
        // Add and revoke multiple permissions
        const permissions = [
          { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Revoke in specific order: 3, 1, 2
        await dataPermission.connect(user1).revokePermission(3);
        await dataPermission.connect(user1).revokePermission(1);
        await dataPermission.connect(user1).revokePermission(2);

        // Check individual indices
        (await dataPermission.userRevokedPermissionIdsAt(user1.address, 0)).should.eq(3n);
        (await dataPermission.userRevokedPermissionIdsAt(user1.address, 1)).should.eq(1n);
        (await dataPermission.userRevokedPermissionIdsAt(user1.address, 2)).should.eq(2n);

        // Verify length
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(3);
      });

      it("should revert when accessing out of bounds revoked permission index", async function () {
        // Add and revoke one permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };
        const signature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, signature);
        await dataPermission.connect(user1).revokePermission(1);

        // Should have 1 revoked permission
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(1);

        // Accessing index 0 should work
        (await dataPermission.userRevokedPermissionIdsAt(user1.address, 0)).should.eq(1n);

        // Accessing index 1 should revert
        await expect(
          dataPermission.userRevokedPermissionIdsAt(user1.address, 1)
        ).to.be.reverted;

        // User with no revoked permissions should revert on index 0
        await expect(
          dataPermission.userRevokedPermissionIdsAt(user2.address, 0)
        ).to.be.reverted;
      });

      it("should track revoked permissions separately per user", async function () {
        // User1 adds and revokes permissions
        const user1Perms = [
          { nonce: 0n, grant: "ipfs://user1-grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://user1-grant2", fileIds: [] },
        ];

        for (const perm of user1Perms) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // User2 adds and revokes permissions
        const user2Perms = [
          { nonce: 0n, grant: "ipfs://user2-grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://user2-grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://user2-grant3", fileIds: [] },
        ];

        for (const perm of user2Perms) {
          const sig = await createPermissionSignature(perm, user2);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // User1 revokes their first permission
        await dataPermission.connect(user1).revokePermission(1);

        // User2 revokes all their permissions
        await dataPermission.connect(user2).revokePermission(3);
        await dataPermission.connect(user2).revokePermission(4);
        await dataPermission.connect(user2).revokePermission(5);

        // Check user1's revoked permissions
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(1);
        const user1Revoked = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        user1Revoked.should.deep.eq([1n]);

        // Check user2's revoked permissions
        (await dataPermission.userRevokedPermissionIdsLength(user2.address)).should.eq(3);
        const user2Revoked = await dataPermission.userRevokedPermissionIdsValues(user2.address);
        user2Revoked.should.deep.eq([3n, 4n, 5n]);

        // User3 should have no revoked permissions
        (await dataPermission.userRevokedPermissionIdsLength(user3.address)).should.eq(0);
        const user3Revoked = await dataPermission.userRevokedPermissionIdsValues(user3.address);
        user3Revoked.should.deep.eq([]);
      });

      it("should maintain consistency between active and revoked permissions", async function () {
        // Add 5 permissions
        const permissions = [
          { nonce: 0n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, grant: "ipfs://grant3", fileIds: [] },
          { nonce: 3n, grant: "ipfs://grant4", fileIds: [] },
          { nonce: 4n, grant: "ipfs://grant5", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, user1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Initially all active, none revoked
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(5);
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(0);

        // Revoke permissions 2, 3, and 5
        await dataPermission.connect(user1).revokePermission(2);
        await dataPermission.connect(user1).revokePermission(3);
        await dataPermission.connect(user1).revokePermission(5);

        // Check active permissions (should be 1 and 4)
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(2);
        const activeIds = await dataPermission.userPermissionIdsValues(user1.address);
        activeIds.should.deep.eq([1n, 4n]);

        // Check revoked permissions (should be 2, 3, and 5)
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(3);
        const revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([2n, 3n, 5n]);

        // Verify individual permission states
        (await dataPermission.isActivePermission(1)).should.eq(true);
        (await dataPermission.isActivePermission(2)).should.eq(false);
        (await dataPermission.isActivePermission(3)).should.eq(false);
        (await dataPermission.isActivePermission(4)).should.eq(true);
        (await dataPermission.isActivePermission(5)).should.eq(false);
      });

      it("should handle signature-based revocation in revoked tracking", async function () {
        // Add permissions
        const perm1 = { nonce: 0n, grant: "ipfs://grant1", fileIds: [] };
        const perm2 = { nonce: 1n, grant: "ipfs://grant2", fileIds: [] };
        
        const sig1 = await createPermissionSignature(perm1, user1);
        const sig2 = await createPermissionSignature(perm2, user1);
        
        await dataPermission.connect(sponsor).addPermission(perm1, sig1);
        await dataPermission.connect(sponsor).addPermission(perm2, sig2);

        // Revoke first permission directly
        await dataPermission.connect(user1).revokePermission(1);

        // Revoke second permission with signature
        const revokeInput = {
          nonce: 2n, // Current nonce after adding 2 permissions
          permissionId: 2n,
        };
        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);
        await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Both should be in revoked list
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(2);
        const revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([1n, 2n]);

        // No active permissions left
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(0);
      });

      it("should not add duplicate entries to revoked permissions", async function () {
        // Add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };
        const signature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, signature);

        // Revoke it
        await dataPermission.connect(user1).revokePermission(1);

        // Check revoked count
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(1);

        // Try to revoke again (should fail)
        await expect(
          dataPermission.connect(user1).revokePermission(1)
        ).to.be.revertedWithCustomError(dataPermission, "InactivePermission");

        // Revoked count should still be 1
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(1);
      });

      it("should handle empty revoked permissions list", async function () {
        // User with no permissions at all
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(0);
        const revokedIds = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIds.should.deep.eq([]);

        // User with active permissions but none revoked
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };
        const signature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, signature);

        // Still no revoked permissions
        (await dataPermission.userRevokedPermissionIdsLength(user1.address)).should.eq(0);
        const revokedIdsAfter = await dataPermission.userRevokedPermissionIdsValues(user1.address);
        revokedIdsAfter.should.deep.eq([]);
      });
    });
  });

  describe("Edge Cases", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        grant: string;
        fileIds: bigint[];
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
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    it("should handle multiple users with same grant (should fail)", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://same-grant",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission, user1);
      const signature2 = await createPermissionSignature(permission, user2);

      // First user should succeed
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature1);

      // Second user should fail (same grant)
      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature2),
      ).to.be.revertedWithCustomError(dataPermission, "GrantAlreadyUsed");
    });

    it("should handle rapid succession of permissions", async function () {
      const permissions = [];
      const signatures = [];

      // Create 10 permissions rapidly
      for (let i = 0; i < 10; i++) {
        const permission = {
          nonce: BigInt(i),
          grant: `ipfs://grant${i}`,
          fileIds: [],
        };
        permissions.push(permission);
        signatures.push(await createPermissionSignature(permission, user1));
      }

      // Add them all
      for (let i = 0; i < 10; i++) {
        await dataPermission
          .connect(sponsor)
          .addPermission(permissions[i], signatures[i]);
      }

      // Verify all were added
      (await dataPermission.permissionsCount()).should.eq(10);
      (await dataPermission.userNonce(user1.address)).should.eq(10);
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        10,
      );
    });
  });

  describe("Server Functions", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        grant: string;
        fileIds: bigint[];
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
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createTrustServerSignature = async (
      trustServerInput: {
        nonce: bigint;
        serverId: string;
        serverUrl: string;
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
        TrustServer: [
          { name: "nonce", type: "uint256" },
          { name: "serverId", type: "address" },
          { name: "serverUrl", type: "string" },
        ],
      };

      const value = {
        nonce: trustServerInput.nonce,
        serverId: trustServerInput.serverId,
        serverUrl: trustServerInput.serverUrl,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createUntrustServerSignature = async (
      untrustServerInput: {
        nonce: bigint;
        serverId: string;
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
        UntrustServer: [
          { name: "nonce", type: "uint256" },
          { name: "serverId", type: "address" },
        ],
      };

      const value = {
        nonce: untrustServerInput.nonce,
        serverId: untrustServerInput.serverId,
      };

      return await signer.signTypedData(domain, types, value);
    };

    describe("Server Creation through Trust", () => {
      it("should create server when first trusted", async function () {
        const serverUrl = "https://server1.example.com";
        
        // Server should not exist initially
        const serverBefore = await dataPermission.servers(server1.address);
        serverBefore.url.should.eq("");
        
        // Trust server (this will create it)
        const tx = await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        // Should emit both ServerAdded and ServerTrusted events
        await expect(tx)
          .to.emit(dataPermission, "ServerAdded")
          .withArgs(server1.address, serverUrl);
          
        await expect(tx)
          .to.emit(dataPermission, "ServerTrusted")
          .withArgs(user1.address, server1.address, serverUrl);

        // Verify server was created
        const serverAfter = await dataPermission.servers(server1.address);
        serverAfter.url.should.eq(serverUrl);
      });

      it("should reject trusting with empty URL", async function () {
        await expect(
          dataPermission.connect(user1).trustServer(server1.address, "")
        ).to.be.revertedWithCustomError(dataPermission, "EmptyUrl");
      });

      it("should reject changing server URL after creation", async function () {
        const serverUrl = "https://server1.example.com";
        
        // First user trusts with original URL (creates server)
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        // Second user tries to trust with different URL
        await expect(
          dataPermission.connect(user2).trustServer(server1.address, "https://different.com")
        ).to.be.revertedWithCustomError(dataPermission, "ServerUrlMismatch");
      });

      it("should allow different servers to be created through trust", async function () {
        const serverUrl1 = "https://server1.example.com";
        const serverUrl2 = "https://server2.example.com";

        // User1 trusts server1 (creates it)
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl1);

        // User2 trusts server2 (creates it)
        await dataPermission
          .connect(user2)
          .trustServer(server2.address, serverUrl2);

        // Verify both servers exist
        const serverInfo1 = await dataPermission.servers(server1.address);
        const serverInfo2 = await dataPermission.servers(server2.address);
        
        serverInfo1.url.should.eq(serverUrl1);
        serverInfo2.url.should.eq(serverUrl2);
      });
    });

    describe("trustServer", () => {
      const serverUrl = "https://server.example.com";

      it("should trust a server successfully", async function () {
        const tx = await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        await expect(tx)
          .to.emit(dataPermission, "ServerTrusted")
          .withArgs(user1.address, server1.address, serverUrl);

        // Verify server is in user's trusted list
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        (await dataPermission.userServerIdsAt(user1.address, 0)).should.eq(
          server1.address
        );
      });

      it("should trust a new server and create it", async function () {
        const tx = await dataPermission
          .connect(user1)
          .trustServer(server2.address, "https://newserver.com");
          
        await expect(tx)
          .to.emit(dataPermission, "ServerAdded")
          .withArgs(server2.address, "https://newserver.com");
      });

      it("should reject trusting with wrong URL after server exists", async function () {
        // First create the server
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
          
        // Try to trust with different URL
        await expect(
          dataPermission.connect(user2).trustServer(server1.address, "https://wrong.com")
        ).to.be.revertedWithCustomError(dataPermission, "ServerUrlMismatch");
      });

      it("should reject trusting zero address", async function () {
        await expect(
          dataPermission.connect(user1).trustServer(ethers.ZeroAddress, serverUrl)
        ).to.be.revertedWithCustomError(dataPermission, "ZeroAddress");
      });

      it("should reject trusting with empty URL", async function () {
        await expect(
          dataPermission.connect(user1).trustServer(server1.address, "")
        ).to.be.revertedWithCustomError(dataPermission, "EmptyUrl");
      });

      it("should allow trusting multiple servers", async function () {
        const serverUrl2 = "https://server2.example.com";

        // Trust both servers (they will be created automatically)
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
        
        await dataPermission
          .connect(user1)
          .trustServer(server2.address, serverUrl2);

        // Verify both are trusted
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(2);
        
        const trustedServers = await dataPermission.userServerIdsValues(user1.address);
        trustedServers.should.deep.eq([server1.address, server2.address]);
      });

      it("should allow trusting same server multiple times (idempotent)", async function () {
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
        
        // Trust again - should not fail
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        // Should still have only one trusted server
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
      });
    });

    describe("trustServerWithSignature", () => {
      const serverUrl = "https://server.example.com";

      it("should trust server with valid signature", async function () {
        const trustServerInput = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const signature = await createTrustServerSignature(trustServerInput, user1);

        // User nonce should start at 0
        (await dataPermission.userNonce(user1.address)).should.eq(0);

        const tx = await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, signature);

        await expect(tx)
          .to.emit(dataPermission, "ServerTrusted")
          .withArgs(user1.address, server1.address, serverUrl);

        // Verify nonce was incremented
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Verify server is trusted
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
      });

      it("should reject with incorrect nonce", async function () {
        const trustServerInput = {
          nonce: 1n, // Wrong nonce
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const signature = await createTrustServerSignature(trustServerInput, user1);

        await expect(
          dataPermission
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, signature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(0, 1);
      });

      it("should work when called by sponsor but signed by user", async function () {
        const trustServerInput = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const signature = await createTrustServerSignature(trustServerInput, user1);

        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, signature);

        // Verify it's indexed by the signer (user1), not the caller (sponsor)
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        (await dataPermission.userServerIdsLength(sponsor.address)).should.eq(0);
      });
    });

    describe("untrustServer", () => {
      const serverUrl = "https://server.example.com";
      
      beforeEach(async function () {
        // Trust server (this will create it)
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
      });

      it("should untrust a server successfully", async function () {
        // Verify server is trusted
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);

        const tx = await dataPermission
          .connect(user1)
          .untrustServer(server1.address);

        await expect(tx)
          .to.emit(dataPermission, "ServerUntrusted")
          .withArgs(user1.address, server1.address);

        // Verify server is no longer trusted
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(0);
      });

      it("should reject untrusting non-trusted server", async function () {
        await expect(
          dataPermission.connect(user1).untrustServer(server2.address)
        ).to.be.revertedWithCustomError(dataPermission, "ServerNotTrusted");
      });

      it("should reject untrusting zero address", async function () {
        await expect(
          dataPermission.connect(user1).untrustServer(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(dataPermission, "ZeroAddress");
      });

      it("should not affect other users' trust", async function () {
        // User2 also trusts the server
        await dataPermission
          .connect(user2)
          .trustServer(server1.address, serverUrl);

        // User1 untrusts
        await dataPermission
          .connect(user1)
          .untrustServer(server1.address);

        // User1 should have no trusted servers
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(0);
        
        // User2 should still trust the server
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(1);
      });
    });

    describe("untrustServerWithSignature", () => {
      const serverUrl = "https://server.example.com";
      
      beforeEach(async function () {
        // Trust server (this will create it)
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
      });

      it("should untrust server with valid signature", async function () {
        // Note: nonce should still be 0 since trustServer doesn't increment nonce
        const untrustServerInput = {
          nonce: 0n,
          serverId: server1.address,
        };

        const signature = await createUntrustServerSignature(untrustServerInput, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .untrustServerWithSignature(untrustServerInput, signature);

        await expect(tx)
          .to.emit(dataPermission, "ServerUntrusted")
          .withArgs(user1.address, server1.address);

        // Verify nonce was incremented
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Verify server is no longer trusted
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(0);
      });

      it("should reject with incorrect nonce", async function () {
        const untrustServerInput = {
          nonce: 1n, // Wrong nonce
          serverId: server1.address,
        };

        const signature = await createUntrustServerSignature(untrustServerInput, user1);

        await expect(
          dataPermission
            .connect(sponsor)
            .untrustServerWithSignature(untrustServerInput, signature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(0, 1);
      });
    });

    describe("View Functions", () => {
      beforeEach(async function () {
        // Setup: Create 3 servers by having different users trust them
        const servers = [
          { serverId: server1.address, url: "https://server1.com" },
          { serverId: server2.address, url: "https://server2.com" },
          { serverId: maintainer.address, url: "https://server3.com" },
        ];

        // User1 trusts first two servers (this creates them)
        await dataPermission
          .connect(user1)
          .trustServer(servers[0].serverId, servers[0].url);
        
        await dataPermission
          .connect(user1)
          .trustServer(servers[1].serverId, servers[1].url);
          
        // User2 trusts the third server (this creates it)
        await dataPermission
          .connect(user2)
          .trustServer(servers[2].serverId, servers[2].url);
      });

      it("should return correct userServerIdsLength", async function () {
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(2);
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(1);
      });

      it("should return correct userServerIdsAt", async function () {
        (await dataPermission.userServerIdsAt(user1.address, 0)).should.eq(
          server1.address
        );
        (await dataPermission.userServerIdsAt(user1.address, 1)).should.eq(
          server2.address
        );
      });

      it("should revert on out of bounds userServerIdsAt", async function () {
        await expect(
          dataPermission.userServerIdsAt(user1.address, 2)
        ).to.be.reverted;
      });

      it("should return correct userServerIdsValues", async function () {
        const serverIds = await dataPermission.userServerIdsValues(user1.address);
        serverIds.should.deep.eq([server1.address, server2.address]);

        const user2ServerIds = await dataPermission.userServerIdsValues(user2.address);
        user2ServerIds.should.deep.eq([maintainer.address]);
        
        // Test a user with no trusted servers
        const emptyServerIds = await dataPermission.userServerIdsValues(user3.address);
        emptyServerIds.should.deep.eq([]);
      });

      it("should return correct server info", async function () {
        const serverInfo1 = await dataPermission.servers(server1.address);
        serverInfo1.url.should.eq("https://server1.com");

        const serverInfo2 = await dataPermission.servers(server2.address);
        serverInfo2.url.should.eq("https://server2.com");

        // Non-existent server should return empty
        const nonExistent = await dataPermission.servers(user3.address);
        nonExistent.url.should.eq("");
      });
    });

    describe("Replay Attack Prevention", () => {
      const serverUrl = "https://server.example.com";

      it("should prevent replay of trustServerWithSignature", async function () {
        const trustServerInput = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const signature = await createTrustServerSignature(trustServerInput, user1);

        // First call should succeed
        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, signature);

        // Verify nonce was incremented
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Replay attempt with same signature should fail due to wrong nonce
        await expect(
          dataPermission
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, signature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0); // expects nonce 1, but signature has nonce 0
      });

      it("should prevent replay of untrustServerWithSignature", async function () {
        // First trust the server
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        const untrustServerInput = {
          nonce: 0n,
          serverId: server1.address,
        };

        const signature = await createUntrustServerSignature(untrustServerInput, user1);

        // First call should succeed
        await dataPermission
          .connect(sponsor)
          .untrustServerWithSignature(untrustServerInput, signature);

        // Verify nonce was incremented
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Replay attempt should fail due to wrong nonce
        await expect(
          dataPermission
            .connect(sponsor)
            .untrustServerWithSignature(untrustServerInput, signature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0);
      });

      it("should prevent cross-user replay attacks", async function () {
        // User1 creates a trust signature
        const trustServerInput = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const user1Signature = await createTrustServerSignature(trustServerInput, user1);

        // User1 trusts the server
        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, user1Signature);

        // User2 tries to replay User1's signature
        // This should fail because the signature verification will extract user1's address
        // but user2's nonce is still 0, so it will try to trust on behalf of user1
        // which will fail due to nonce mismatch (user1's nonce is now 1)
        await expect(
          dataPermission
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, user1Signature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0);

        // Even if we try with user2 signing with the same parameters
        // it's a different signature and will work for user2
        const user2Signature = await createTrustServerSignature(trustServerInput, user2);
        
        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, user2Signature);

        // Verify each user has their own trust relationship
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(1);
      });

      it("should prevent replay attacks across different operations", async function () {
        // Create signatures for both trust and untrust with same nonce
        const nonce = 0n;
        
        const trustInput = {
          nonce: nonce,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const untrustInput = {
          nonce: nonce,
          serverId: server1.address,
        };

        const trustSignature = await createTrustServerSignature(trustInput, user1);
        const untrustSignature = await createUntrustServerSignature(untrustInput, user1);

        // Execute trust operation
        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustInput, trustSignature);

        // Nonce is now 1, so untrust with nonce 0 should fail
        await expect(
          dataPermission
            .connect(sponsor)
            .untrustServerWithSignature(untrustInput, untrustSignature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0);

        // Create new untrust signature with correct nonce
        const newUntrustInput = {
          nonce: 1n,
          serverId: server1.address,
        };

        const newUntrustSignature = await createUntrustServerSignature(newUntrustInput, user1);

        // This should succeed
        await dataPermission
          .connect(sponsor)
          .untrustServerWithSignature(newUntrustInput, newUntrustSignature);
      });

      it("should prevent replay of permission signatures in server context", async function () {
        // Add a permission
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };

        const permSignature = await createPermissionSignature(permission, user1);

        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Nonce is now 1
        (await dataPermission.userNonce(user1.address)).should.eq(1);

        // Try to replay the permission - should fail due to nonce mismatch
        await expect(
          dataPermission
            .connect(sponsor)
            .addPermission(permission, permSignature)
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0); // Expected nonce 1, provided 0

        // Now try server operations - they should use the updated nonce
        const trustServerInput = {
          nonce: 1n, // Must use nonce 1
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const trustSignature = await createTrustServerSignature(trustServerInput, user1);

        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, trustSignature);

        // Verify nonce incremented again
        (await dataPermission.userNonce(user1.address)).should.eq(2);
      });

      it("should maintain separate nonces per user preventing cross-contamination", async function () {
        // Both users start with nonce 0
        (await dataPermission.userNonce(user1.address)).should.eq(0);
        (await dataPermission.userNonce(user2.address)).should.eq(0);

        // User1 performs operation
        const user1Input = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const user1Signature = await createTrustServerSignature(user1Input, user1);

        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(user1Input, user1Signature);

        // User1's nonce incremented, user2's unchanged
        (await dataPermission.userNonce(user1.address)).should.eq(1);
        (await dataPermission.userNonce(user2.address)).should.eq(0);

        // User2 can still use nonce 0
        const user2Input = {
          nonce: 0n,
          serverId: server1.address,
          serverUrl: serverUrl,
        };

        const user2Signature = await createTrustServerSignature(user2Input, user2);

        await dataPermission
          .connect(sponsor)
          .trustServerWithSignature(user2Input, user2Signature);

        // Both users now have nonce 1
        (await dataPermission.userNonce(user1.address)).should.eq(1);
        (await dataPermission.userNonce(user2.address)).should.eq(1);
      });
    });

    describe("AddPermission with FileIds", () => {
      beforeEach(async () => {
        await deploy();
      });

      const createRevokePermissionSignature = async (
        revokePermissionInput: {
          nonce: bigint;
          permissionId: bigint;
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
          RevokePermission: [
            { name: "nonce", type: "uint256" },
            { name: "permissionId", type: "uint256" },
          ],
        };

        const value = {
          nonce: revokePermissionInput.nonce,
          permissionId: revokePermissionInput.permissionId,
        };

        return await signer.signTypedData(domain, types, value);
      };

      it("should add permission with file IDs for files owned by user", async function () {
        // Set up files owned by user1
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user1.address, "ipfs://file2");
        await dataRegistry.setFile(3, user1.address, "ipfs://file3");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n],
        };

        const signature = await createPermissionSignature(permission, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Verify event was emitted
        await expect(tx).to.emit(dataPermission, "PermissionAdded").withArgs(
          1, // permissionId
          user1.address, // grantor
          permission.grant,
        );

        // Verify permission was stored with fileIds
        const permissionInfo = await dataPermission.permissions(1);
        permissionInfo.grantor.should.eq(user1.address);
        permissionInfo.grant.should.eq(permission.grant);
        
        // Verify file associations
        const fileIds = await dataPermission.permissionFileIds(1);
        fileIds.should.deep.eq([1n, 2n, 3n]);

        // Verify reverse mapping (file to permissions)
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(3)).should.deep.eq([1n]);

        // Verify file associations through permissionFileIds
        const permFileIds = await dataPermission.permissionFileIds(1);
        permFileIds.should.include(1n);
        permFileIds.should.include(2n);
        permFileIds.should.include(3n);
        permFileIds.should.not.include(4n);
      });

      it("should reject permission with file IDs not owned by user", async function () {
        // Set up files owned by different users
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user2.address, "ipfs://file2"); // Owned by user2
        await dataRegistry.setFile(3, user1.address, "ipfs://file3");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n], // File 2 is not owned by user1
        };

        const signature = await createPermissionSignature(permission, user1);

        await expect(
          dataPermission.connect(sponsor).addPermission(permission, signature)
        ).to.be.revertedWithCustomError(dataPermission, "NotFileOwner")
          .withArgs(user2.address, user1.address);
      });

      it("should handle empty fileIds array", async function () {
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [], // Empty array
        };

        const signature = await createPermissionSignature(permission, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await expect(tx).to.emit(dataPermission, "PermissionAdded");

        // Verify no file associations
        const fileIds = await dataPermission.permissionFileIds(1);
        fileIds.should.deep.eq([]);
      });

      it("should handle duplicate fileIds in input", async function () {
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 1n, 2n, 1n], // Duplicates
        };

        const signature = await createPermissionSignature(permission, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await expect(tx).to.emit(dataPermission, "PermissionAdded");

        // Verify only unique fileIds are stored
        const fileIds = await dataPermission.permissionFileIds(1);
        fileIds.should.deep.eq([1n, 2n]);

        // Verify file mappings
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
      });

      it("should handle multiple permissions for same file", async function () {
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");

        // First permission
        const permission1 = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n],
        };

        const signature1 = await createPermissionSignature(permission1, user1);
        await dataPermission.connect(sponsor).addPermission(permission1, signature1);

        // Second permission for same file
        const permission2 = {
          nonce: 1n,
          grant: "ipfs://grant2",
          fileIds: [1n],
        };

        const signature2 = await createPermissionSignature(permission2, user1);
        await dataPermission.connect(sponsor).addPermission(permission2, signature2);

        // Verify both permissions are associated with file 1
        const filePermissions = await dataPermission.filePermissionIds(1);
        filePermissions.should.deep.eq([1n, 2n]);

        // Verify each permission has the file
        const perm1Files = await dataPermission.permissionFileIds(1);
        const perm2Files = await dataPermission.permissionFileIds(2);
        perm1Files.should.include(1n);
        perm2Files.should.include(1n);
      });

      it("should handle permissions with overlapping fileIds", async function () {
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user1.address, "ipfs://file2");
        await dataRegistry.setFile(3, user1.address, "ipfs://file3");
        await dataRegistry.setFile(4, user1.address, "ipfs://file4");

        // First permission with files 1, 2, 3
        const permission1 = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n],
        };

        const signature1 = await createPermissionSignature(permission1, user1);
        await dataPermission.connect(sponsor).addPermission(permission1, signature1);

        // Second permission with files 2, 3, 4
        const permission2 = {
          nonce: 1n,
          grant: "ipfs://grant2",
          fileIds: [2n, 3n, 4n],
        };

        const signature2 = await createPermissionSignature(permission2, user1);
        await dataPermission.connect(sponsor).addPermission(permission2, signature2);

        // Verify file mappings
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]); // Only permission 1
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n, 2n]); // Both permissions
        (await dataPermission.filePermissionIds(3)).should.deep.eq([1n, 2n]); // Both permissions
        (await dataPermission.filePermissionIds(4)).should.deep.eq([2n]); // Only permission 2
      });

      it("should clean up file associations when permission is revoked", async function () {
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n],
        };

        const signature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, signature);

        // Verify initial associations
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
        (await dataPermission.permissionFileIds(1)).should.deep.eq([1n, 2n]);

        // Revoke the permission
        await dataPermission.connect(user1).revokePermission(1);
        
        // Permission should still have fileIds stored but marked as inactive
        const revokedPerm = await dataPermission.permissions(1);
        revokedPerm.isActive.should.eq(false);
        
        // File associations should remain for historical tracking
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
        (await dataPermission.permissionFileIds(1)).should.deep.eq([1n, 2n]);
      });

      it("should handle large number of fileIds", async function () {
        // Set up 100 files owned by user1
        const fileCount = 100;
        for (let i = 1; i <= fileCount; i++) {
          await dataRegistry.setFile(i, user1.address, `ipfs://file${i}`);
        }

        const fileIds = [];
        for (let i = 1; i <= fileCount; i++) {
          fileIds.push(BigInt(i));
        }

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: fileIds,
        };

        const signature = await createPermissionSignature(permission, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await expect(tx).to.emit(dataPermission, "PermissionAdded");

        // Verify all fileIds were stored
        const storedFileIds = await dataPermission.permissionFileIds(1);
        storedFileIds.length.should.eq(fileCount);

        // Spot check some file associations
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(50)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(100)).should.deep.eq([1n]);
      });

      it("should reject permission for non-existent file", async function () {
        // Only set up file 1
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 999n], // File 999 doesn't exist
        };

        const signature = await createPermissionSignature(permission, user1);

        await expect(
          dataPermission.connect(sponsor).addPermission(permission, signature)
        ).to.be.revertedWithCustomError(dataPermission, "NotFileOwner")
          .withArgs(ethers.ZeroAddress, user1.address);
      });

      it("should handle revocation with signature for permissions with fileIds", async function () {
        await dataRegistry.setFile(1, user1.address, "ipfs://file1");
        await dataRegistry.setFile(2, user1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n],
        };

        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission.connect(sponsor).addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(revokeInput, user1);

        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        await expect(tx).to.emit(dataPermission, "PermissionRevoked").withArgs(1);

        // File associations remain for historical tracking
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
      });
    });

    describe("Integration Tests", () => {
      it("should handle full server lifecycle", async function () {
        const serverUrl = "https://lifecycle.example.com";
        
        // 1. First user trusts the server (this creates it)
        const tx = await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
          
        // Should emit ServerAdded when first trusted
        await expect(tx)
          .to.emit(dataPermission, "ServerAdded")
          .withArgs(server1.address, serverUrl);

        // 2. Second user trusts the same server
        await dataPermission
          .connect(user2)
          .trustServer(server1.address, serverUrl);

        // Verify both users trust the server
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(1);

        // 3. User1 untrusts the server
        await dataPermission
          .connect(user1)
          .untrustServer(server1.address);

        // Verify user1 no longer trusts, but user2 still does
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(0);
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(1);

        // 4. Server info should still be available
        const server = await dataPermission.servers(server1.address);
        server.url.should.eq(serverUrl);
      });

      it("should handle permissions and servers together", async function () {
        // Add a permission for user1
        const permission = {
          nonce: 0n,
          grant: "ipfs://grant1",
        fileIds: [],
        };
        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Trust a server (this will create it)
        const serverUrl = "https://integrated.example.com";
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);

        // Verify user has both permissions and trusted servers
        (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(1);
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(1);
        
        // Nonce should have been incremented by permission (not by direct trust)
        (await dataPermission.userNonce(user1.address)).should.eq(1);
      });
    });
  });
});
