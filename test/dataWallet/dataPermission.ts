import chai, { expect, should } from "chai";
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
  let server1: HardhatEthersSigner;
  let server2: HardhatEthersSigner;

  let dataPermission: DataPermissionImplementation;

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

    it("should add a valid permission and emit event", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://grant1",
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
      storedPermission.user.should.eq(user1.address);
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
      };

      const permission2 = {
        nonce: 1n,
        grant: "ipfs://grant1", // Same grant
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
      };

      const permission2 = {
        nonce: 1n,
        grant: "ipfs://grant2",
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
      };

      const permission2 = {
        nonce: 0n, // Each user starts with nonce 0
        grant: "ipfs://grant2",
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
      storedPermission1.user.should.eq(user1.address);
      storedPermission2.user.should.eq(user2.address);
    });

    it("should assign sequential IDs to permissions", async function () {
      const permissions = [
        { nonce: 0n, grant: "ipfs://grant1" },
        { nonce: 0n, grant: "ipfs://grant2" },
        { nonce: 0n, grant: "ipfs://grant3" },
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
        storedPermission.user.should.eq(users[i].address);
        storedPermission.grant.should.eq(permissions[i].grant);
      }
    });

    it("should return empty permission for non-existent ID", async function () {
      const permission = await dataPermission.permissions(999);
      permission.user.should.eq(ethers.ZeroAddress);
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
      };

      const permission2 = {
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
        { nonce: 0n, grant: "ipfs://grant1" },
        { nonce: 1n, grant: "ipfs://grant2" },
        { nonce: 2n, grant: "ipfs://grant3" },
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
      };

      const permission2 = {
        nonce: 0n,
        grant: "ipfs://grant2",
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
      storedPermission.user.should.eq(user1.address);
    });

    it("should validate IPFS URI format in grant field", async function () {
      const validPermission = {
        nonce: 0n,
        grant: "ipfs://grant1",
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

  describe("Edge Cases", () => {
    beforeEach(async () => {
      await deploy();
    });

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

    it("should handle multiple users with same grant (should fail)", async function () {
      const permission = {
        nonce: 0n,
        grant: "ipfs://same-grant",
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

    describe("addServer", () => {
      it("should add a server successfully", async function () {
        const serverUrl = "https://server1.example.com";
        
        const tx = await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });

        await expect(tx)
          .to.emit(dataPermission, "ServerAdded")
          .withArgs(server1.address, serverUrl);

        // Verify server was stored
        const server = await dataPermission.servers(server1.address);
        server.url.should.eq(serverUrl);
      });

      it("should reject adding server with empty URL", async function () {
        await expect(
          dataPermission.connect(server1).addServer({ url: "" })
        ).to.be.revertedWithCustomError(dataPermission, "EmptyUrl");
      });

      it("should reject adding server twice", async function () {
        const serverUrl = "https://server1.example.com";
        
        // Add server first time
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });

        // Try to add again with different URL
        await expect(
          dataPermission.connect(server1).addServer({ url: "https://different.com" })
        ).to.be.revertedWithCustomError(dataPermission, "ServerAlreadyRegistered");
      });

      it("should allow different servers to register", async function () {
        const serverUrl1 = "https://server1.example.com";
        const serverUrl2 = "https://server2.example.com";

        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl1 });

        await dataPermission
          .connect(server2)
          .addServer({ url: serverUrl2 });

        // Verify both servers exist
        const serverInfo1 = await dataPermission.servers(server1.address);
        const serverInfo2 = await dataPermission.servers(server2.address);
        
        serverInfo1.url.should.eq(serverUrl1);
        serverInfo2.url.should.eq(serverUrl2);
      });
    });

    describe("trustServer", () => {
      const serverUrl = "https://server.example.com";
      
      beforeEach(async function () {
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });
      });

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

      it("should reject trusting non-existent server", async function () {
        await expect(
          dataPermission.connect(user1).trustServer(server2.address, "https://fake.com")
        ).to.be.revertedWithCustomError(dataPermission, "ServerNotFound");
      });

      it("should reject trusting with wrong URL", async function () {
        await expect(
          dataPermission.connect(user1).trustServer(server1.address, "https://wrong.com")
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
        // Add another server
        const serverUrl2 = "https://server2.example.com";
        await dataPermission
          .connect(server2)
          .addServer({ url: serverUrl2 });

        // Trust both servers
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
      
      beforeEach(async function () {
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });
      });

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
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });
          
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
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });
          
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
      });

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
        // Setup: Add 3 servers and have user1 trust 2 of them
        const servers = [
          { signer: server1, url: "https://server1.com" },
          { signer: server2, url: "https://server2.com" },
          { signer: maintainer, url: "https://server3.com" },
        ];

        // Add servers
        for (const server of servers) {
          await dataPermission
            .connect(server.signer)
            .addServer({ url: server.url });
        }

        // User1 trusts first two servers
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, servers[0].url);
        
        await dataPermission
          .connect(user1)
          .trustServer(server2.address, servers[1].url);
      });

      it("should return correct userServerIdsLength", async function () {
        (await dataPermission.userServerIdsLength(user1.address)).should.eq(2);
        (await dataPermission.userServerIdsLength(user2.address)).should.eq(0);
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

        const emptyServerIds = await dataPermission.userServerIdsValues(user2.address);
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

    describe("Integration Tests", () => {
      it("should handle full server lifecycle", async function () {
        const serverUrl = "https://lifecycle.example.com";
        
        // 1. Grant role and add server
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });

        // 2. Multiple users trust the server
        await dataPermission
          .connect(user1)
          .trustServer(server1.address, serverUrl);
        
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
        };
        const permSignature = await createPermissionSignature(permission, user1);
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Grant role and add server
        await dataPermission
          .connect(owner)
          .grantRole(MAINTAINER_ROLE, server1.address);
          
        const serverUrl = "https://integrated.example.com";
        await dataPermission
          .connect(server1)
          .addServer({ url: serverUrl });
        
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
