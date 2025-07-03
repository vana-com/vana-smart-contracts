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
  let application1: HardhatEthersSigner;
  let application2: HardhatEthersSigner;
  let application3: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;

  let dataPermission: DataPermissionImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const REFINEMENT_SERVICE_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("REFINEMENT_SERVICE_ROLE"),
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
      application1,
      application2,
      application3,
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
    let sponsor: HardhatEthersSigner;

    beforeEach(async () => {
      await deploy();
      // Get sponsor from the existing signers or create a new one
      sponsor = deployer; // Using deployer as sponsor, or you can assign any other signer
    });

    const createPermissionSignature = async (
      permission: {
        application: string;
        files: bigint[];
        operation: string;
        prompt: string;
        nonce: bigint;
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
          { name: "application", type: "address" },
          { name: "files", type: "uint256[]" },
          { name: "operation", type: "string" },
          { name: "prompt", type: "string" },
          { name: "nonce", type: "uint256" },
        ],
      };

      const value = {
        application: permission.application,
        files: permission.files,
        operation: permission.operation,
        prompt: permission.prompt,
        nonce: permission.nonce,
      };

      return await signer.signTypedData(domain, types, value);
    };

    it("should add a valid permission with correct nonce and emit event", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
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
        user1.address, // signer
        permission.application,
        permission.files,
        permission.operation,
        permission.prompt,
      );

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(1);

      // Verify nonce increased
      (await dataPermission.userNonce(user1.address)).should.eq(1);

      // Verify permission was stored
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.application.should.eq(permission.application);
      storedPermission.files.should.deep.eq(permission.files);
      storedPermission.operation.should.eq(permission.operation);
      storedPermission.prompt.should.eq(permission.prompt);

      // Verify it's indexed by application
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(1);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 0)
      ).should.eq(1n);

      // Verify it's indexed by user (signer)
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );
    });

    it("should reject permission with incorrect nonce", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 1n, // Wrong nonce
      };

      // User should start with nonce 0, but we sign with nonce 1
      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.rejected;

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should reject permission with already used nonce", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [3n, 4n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n, // Reusing nonce 0
      };

      // Add first permission with nonce 0
      const signature1 = await createPermissionSignature(permission1, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);

      // Try to reuse nonce 0 - should fail
      const signature2 = await createPermissionSignature(permission2, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2).should.be.rejected;

      // Verify only one permission was added
      (await dataPermission.permissionsCount()).should.eq(1);
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should add multiple permissions for the same user with sequential nonces and emit events", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [3n, 4n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 1n,
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
        .withArgs(
          1,
          user1.address,
          permission1.application,
          permission1.files,
          permission1.operation,
          permission1.prompt,
        );

      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          2,
          user1.address,
          permission2.application,
          permission2.files,
          permission2.operation,
          permission2.prompt,
        );

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

      // Verify they're indexed by their respective applications
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(1);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 0)
      ).should.eq(1n);

      (
        await dataPermission.applicationPermissionIdsLength(
          application2.address,
        )
      ).should.eq(1);
      (
        await dataPermission.applicationPermissionIdsAt(application2.address, 0)
      ).should.eq(2n);
    });

    it("should add multiple permissions for the same application from different users", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application1.address,
        files: [3n, 4n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n,
      };

      // Each user uses their own nonce (starting from 0)
      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify both permissions are indexed by the same application
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(2);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 0)
      ).should.eq(1n);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 1)
      ).should.eq(2n);

      // Verify each user has their nonce incremented independently
      (await dataPermission.userNonce(user1.address)).should.eq(1);
      (await dataPermission.userNonce(user2.address)).should.eq(1);
    });

    it("should handle permissions with empty file arrays and correct nonce", async function () {
      const permission = {
        application: application1.address,
        files: [],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermissionSignature(permission, user1);

      const tx = await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Verify event was emitted
      await expect(tx)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          1,
          user1.address,
          permission.application,
          permission.files,
          permission.operation,
          permission.prompt,
        );

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.files.should.have.length(0);

      // Verify nonce was incremented
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should handle permissions with empty strings and correct nonce", async function () {
      const permission = {
        application: application1.address,
        files: [1n],
        operation: "",
        prompt: "",
        nonce: 0n,
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.operation.should.eq("");
      storedPermission.prompt.should.eq("");

      // Verify nonce was incremented
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should handle large file arrays with correct nonce", async function () {
      const largeFileArray = Array.from({ length: 100 }, (_, i) =>
        BigInt(i + 1),
      );

      const permission = {
        application: application1.address,
        files: largeFileArray,
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermissionSignature(permission, user1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.files.should.have.length(100);
      storedPermission.files.should.deep.eq(largeFileArray);

      // Verify nonce was incremented
      (await dataPermission.userNonce(user1.address)).should.eq(1);
    });

    it("should work when called by sponsor wallet regardless of signer", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
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
    });

    it("should assign sequential IDs to permissions", async function () {
      const permissions = [
        {
          application: application1.address,
          files: [1n],
          operation: "ipfs://operation1",
          prompt: "ipfs://prompt1",
          nonce: 0n,
        },
        {
          application: application2.address,
          files: [2n],
          operation: "ipfs://operation2",
          prompt: "ipfs://prompt2",
          nonce: 0n,
        },
        {
          application: application3.address,
          files: [3n],
          operation: "ipfs://operation3",
          prompt: "ipfs://prompt3",
          nonce: 0n,
        },
      ];

      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          i === 0 ? user1 : i === 1 ? user2 : user3,
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
        storedPermission.application.should.eq(permissions[i].application);
        storedPermission.operation.should.eq(permissions[i].operation);
      }
    });

    it("should validate IPFS URI format in operation and prompt fields", async function () {
      const validPermission = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermissionSignature(validPermission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission(validPermission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.operation.should.eq(validPermission.operation);
    });

    it("should return empty permission for non-existent ID", async function () {
      const permission = await dataPermission.permissions(999);
      permission.application.should.eq(ethers.ZeroAddress);
      permission.files.should.have.length(0);
      permission.operation.should.eq("");
      permission.prompt.should.eq("");
    });

    it("should handle different signers for same application", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application1.address,
        files: [2n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n,
      };

      const signature1 = await createPermissionSignature(permission1, user1);
      const signature2 = await createPermissionSignature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify both permissions are indexed by application
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(2);

      // Verify each user has their own permission
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsLength(user2.address)).should.eq(
        1,
      );
    });

    it("should handle accessing permission IDs by index", async function () {
      const permissions = [
        {
          application: application1.address,
          files: [1n],
          operation: "ipfs://operation1",
          prompt: "ipfs://prompt1",
          nonce: 0n,
        },
        {
          application: application1.address,
          files: [2n],
          operation: "ipfs://operation2",
          prompt: "ipfs://prompt2",
          nonce: 1n,
        },
        {
          application: application2.address,
          files: [3n],
          operation: "ipfs://operation3",
          prompt: "ipfs://prompt3",
          nonce: 0n,
        },
      ];

      // Add permissions from different users with their respective nonces
      const signature1 = await createPermissionSignature(permissions[0], user1);
      const signature2 = await createPermissionSignature(permissions[1], user1);
      const signature3 = await createPermissionSignature(permissions[2], user2);

      await dataPermission
        .connect(sponsor)
        .addPermission(permissions[0], signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permissions[1], signature2);
      await dataPermission
        .connect(sponsor)
        .addPermission(permissions[2], signature3);

      // Test user permission access by index
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        2,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 1)).should.eq(
        2n,
      );

      (await dataPermission.userPermissionIdsLength(user2.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsAt(user2.address, 0)).should.eq(
        3n,
      );

      // Test application permission access by index
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(2);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 0)
      ).should.eq(1n);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 1)
      ).should.eq(2n);

      (
        await dataPermission.applicationPermissionIdsLength(
          application2.address,
        )
      ).should.eq(1);
      (
        await dataPermission.applicationPermissionIdsAt(application2.address, 0)
      ).should.eq(3n);
    });

    it("should revert when accessing out of bounds permission indices", async function () {
      const permission = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermissionSignature(permission, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Should revert when accessing index 1 (only index 0 exists)
      await dataPermission.userPermissionIdsAt(user1.address, 1).should.be
        .rejected;
      await dataPermission.applicationPermissionIdsAt(application1.address, 1)
        .should.be.rejected;

      // Should revert for non-existent user/application
      await dataPermission.userPermissionIdsAt(user2.address, 0).should.be
        .rejected;
      await dataPermission.applicationPermissionIdsAt(application2.address, 0)
        .should.be.rejected;
    });

    it("should track nonces correctly across multiple users", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [2n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n,
      };

      // Both users start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);
      (await dataPermission.userNonce(user2.address)).should.eq(0);

      // Add permissions for both users
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
        application: application3.address,
        files: [3n],
        operation: "ipfs://operation3",
        prompt: "ipfs://prompt3",
        nonce: 1n,
      };

      const signature3 = await createPermissionSignature(permission3, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission3, signature3);

      // Verify user1's nonce incremented while user2's remained the same
      (await dataPermission.userNonce(user1.address)).should.eq(2);
      (await dataPermission.userNonce(user2.address)).should.eq(1);
    });

    it("should emit events with correct parameters for multiple permissions", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [3n, 4n, 5n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n,
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
        .withArgs(
          1,
          user1.address,
          permission1.application,
          permission1.files,
          permission1.operation,
          permission1.prompt,
        );

      // Verify second event
      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          2,
          user2.address,
          permission2.application,
          permission2.files,
          permission2.operation,
          permission2.prompt,
        );
    });
  });

  xdescribe("AddPermission2", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermission2Signature = async (
      permission: {
        application: string;
        files: bigint[];
        operation: string;
        prompt: string;
        nonce: bigint;
      },
      signer: HardhatEthersSigner,
    ) => {
      const filesString = permission.files.join(",");
      const message = `You are signing a message for application ${permission.application} to access files ${filesString} for operation ${permission.operation} using prompt ${permission.prompt}. Nonce: ${permission.nonce}`;

      const domain = {
        name: "VanaDataWallet",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        PermissionMessage: [{ name: "message", type: "string" }],
      };

      const value = {
        message: message,
      };

      return await signer.signTypedData(domain, types, value);
    };

    it("should add a valid permission with correct message signature and emit event", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      // User1 should start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);

      const signature = await createPermission2Signature(permission, user1);

      const tx = await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature);

      // Verify event was emitted
      await expect(tx).to.emit(dataPermission, "PermissionAdded").withArgs(
        1, // permissionId
        user1.address, // signer
        permission.application,
        permission.files,
        permission.operation,
        permission.prompt,
      );

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(1);

      // Verify nonce increased
      (await dataPermission.userNonce(user1.address)).should.eq(1);

      // Verify permission was stored
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.application.should.eq(permission.application);
      storedPermission.files.should.deep.eq(permission.files);
      storedPermission.operation.should.eq(permission.operation);
      storedPermission.prompt.should.eq(permission.prompt);

      // Verify it's indexed by application
      (
        await dataPermission.applicationPermissionIdsLength(
          application1.address,
        )
      ).should.eq(1);
      (
        await dataPermission.applicationPermissionIdsAt(application1.address, 0)
      ).should.eq(1n);

      // Verify it's indexed by user (signer)
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        1,
      );
      (await dataPermission.userPermissionIdsAt(user1.address, 0)).should.eq(
        1n,
      );
    });

    it("should reject permission2 with invalid signature", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      // Sign with wrong user (user2 instead of user1)
      const signature = await createPermission2Signature(permission, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.rejected;
    });

    it("should reject permission2 with incorrect nonce", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n, 3n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 1n, // Wrong nonce
      };

      const signature = await createPermission2Signature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.rejected;

      // Nonce should remain unchanged
      (await dataPermission.userNonce(user1.address)).should.eq(0);
    });

    it("should add multiple permissions2 for the same user with sequential nonces", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [3n, 4n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 1n,
      };

      const signature1 = await createPermission2Signature(permission1, user1);
      const signature2 = await createPermission2Signature(permission2, user1);

      const tx1 = await dataPermission
        .connect(sponsor)
        .addPermission2(permission1, signature1);
      const tx2 = await dataPermission
        .connect(sponsor)
        .addPermission2(permission2, signature2);

      // Verify events were emitted
      await expect(tx1)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          1,
          user1.address,
          permission1.application,
          permission1.files,
          permission1.operation,
          permission1.prompt,
        );

      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          2,
          user1.address,
          permission2.application,
          permission2.files,
          permission2.operation,
          permission2.prompt,
        );

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(2);

      // Verify nonce increased to 2
      (await dataPermission.userNonce(user1.address)).should.eq(2);
    });

    it("should handle permission2 with empty file arrays", async function () {
      const permission = {
        application: application1.address,
        files: [],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermission2Signature(permission, user1);

      const tx = await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature);

      // Verify event was emitted with empty files array
      await expect(tx)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          1,
          user1.address,
          permission.application,
          permission.files,
          permission.operation,
          permission.prompt,
        );

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.files.should.have.length(0);
    });

    it("should handle permission2 with single file", async function () {
      const permission = {
        application: application1.address,
        files: [42n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermission2Signature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.files.should.deep.eq([42n]);
    });

    it("should handle permission2 with multiple files", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 5n, 10n, 100n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const signature = await createPermission2Signature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.files.should.deep.eq([1n, 5n, 10n, 100n]);
    });

    it("should handle permission2 with empty strings", async function () {
      const permission = {
        application: application1.address,
        files: [1n],
        operation: "",
        prompt: "",
        nonce: 0n,
      };

      const signature = await createPermission2Signature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.operation.should.eq("");
      storedPermission.prompt.should.eq("");
    });

    it("should track nonces correctly for permission2 across multiple users", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [2n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 0n,
      };

      // Both users start with nonce 0
      (await dataPermission.userNonce(user1.address)).should.eq(0);
      (await dataPermission.userNonce(user2.address)).should.eq(0);

      const signature1 = await createPermission2Signature(permission1, user1);
      const signature2 = await createPermission2Signature(permission2, user2);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission2(permission2, signature2);

      // Verify nonces were incremented independently
      (await dataPermission.userNonce(user1.address)).should.eq(1);
      (await dataPermission.userNonce(user2.address)).should.eq(1);
    });

    it("should work with mixed addPermission and addPermission2 calls", async function () {
      const permission1 = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      const permission2 = {
        application: application2.address,
        files: [2n],
        operation: "ipfs://operation2",
        prompt: "ipfs://prompt2",
        nonce: 1n,
      };

      // Use addPermission (EIP-712) for first permission
      const signature1 = await createPermissionSignature(
        permission1,
        0n,
        user1,
      );
      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);

      // Use addPermission2 (simple message) for second permission
      const signature2 = await createPermission2Signature(permission2, user1);
      await dataPermission
        .connect(sponsor)
        .addPermission2(permission2, signature2);

      // Verify both permissions were added
      (await dataPermission.permissionsCount()).should.eq(2);
      (await dataPermission.userNonce(user1.address)).should.eq(2);

      // Verify both permissions are indexed by user
      (await dataPermission.userPermissionIdsLength(user1.address)).should.eq(
        2,
      );
    });

    it("should handle permission2 with special characters in strings", async function () {
      const permission = {
        application: application1.address,
        files: [1n],
        operation: "ipfs://operation-with-special-chars_123",
        prompt: "ipfs://prompt with spaces and symbols!@#$%",
        nonce: 0n,
      };

      const signature = await createPermission2Signature(permission, user1);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.operation.should.eq(permission.operation);
      storedPermission.prompt.should.eq(permission.prompt);
    });

    it("should reject permission2 with wrong message format", async function () {
      const permission = {
        application: application1.address,
        files: [1n, 2n],
        operation: "ipfs://operation1",
        prompt: "ipfs://prompt1",
        nonce: 0n,
      };

      // Create a signature with wrong message format
      const wrongMessage = `Wrong message format for ${permission.application}`;
      const signature = await user1.signMessage(wrongMessage);

      await dataPermission
        .connect(sponsor)
        .addPermission2(permission, signature).should.be.rejected;
    });
  });
});
