import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
  DataPortabilityPermissionsImplementation,
  DataPortabilityServersImplementation,
  DataPortabilityGranteesImplementation,
  MockDataRegistry,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  createServerFilesAndPermissionSignature,
  recoverServerFilesAndPermissionSigner,
  ServerFilesAndPermissionData,
} from "./signatureUtils";

chai.use(chaiAsPromised);
should();

describe("DataPortabilityPermissions", () => {
  let trustedForwarder: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let testUser1: HardhatEthersSigner;
  let testUser2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;
  let testServer1: HardhatEthersSigner;
  let testServer2: HardhatEthersSigner;

  let dataPermission: DataPortabilityPermissionsImplementation;
  let dataRegistry: MockDataRegistry;
  let testServersContract: DataPortabilityServersImplementation;
  let granteesContract: DataPortabilityGranteesImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  // Helper function to create signature for adding a server
  const createAddServerSignature = async (
    signer: HardhatEthersSigner,
    nonce: bigint,
    serverAddress: string,
    publicKey: string,
    serverUrl: string,
  ) => {
    const domain = {
      name: "VanaDataPortabilityServers",
      version: "1",
      chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
      verifyingContract: await testServersContract.getAddress(),
    };

    const types = {
      AddServer: [
        { name: "nonce", type: "uint256" },
        { name: "serverAddress", type: "address" },
        { name: "publicKey", type: "string" },
        { name: "serverUrl", type: "string" },
      ],
    };

    const value = {
      nonce,
      serverAddress,
      publicKey,
      serverUrl,
    };

    return await signer.signTypedData(domain, types, value);
  };

  // Helper function to add a server and trust it
  const addAndTrustServer = async (
    signer: HardhatEthersSigner,
    serverAddress: string,
    publicKey: string,
    serverUrl: string,
  ) => {
    // First add the server
    const nonce = await testServersContract.userNonce(signer.address);
    const signature = await createAddServerSignature(
      signer,
      nonce,
      serverAddress,
      publicKey,
      serverUrl,
    );

    await testServersContract.connect(signer).addServerWithSignature(
      {
        nonce: nonce,
        serverAddress: serverAddress,
        publicKey: publicKey,
        serverUrl: serverUrl,
      },
      signature,
    );

    // Get the server ID
    const serverId = await testServersContract.serverAddressToId(serverAddress);

    // Trust the server
    await testServersContract.connect(signer).trustServer(serverId);

    return serverId;
  };

  const deploy = async () => {
    [
      trustedForwarder,
      deployer,
      owner,
      maintainer,
      sponsor,
      testUser1,
      testUser2,
      user3,
      testServer1,
      testServer2,
    ] = await ethers.getSigners();

    // Deploy MockDataRegistry
    const MockDataRegistry =
      await ethers.getContractFactory("MockDataRegistry");
    dataRegistry = await MockDataRegistry.deploy();
    await dataRegistry.waitForDeployment();

    // Deploy mock servers contract
    const MockServersContract = await ethers.getContractFactory(
      "DataPortabilityServersImplementation",
    );
    const testServersContractDeploy = await upgrades.deployProxy(
      MockServersContract,
      [trustedForwarder.address, owner.address],
      {
        kind: "uups",
      },
    );
    testServersContract = await ethers.getContractAt(
      "DataPortabilityServersImplementation",
      testServersContractDeploy.target,
    );

    // Deploy mock grantees contract
    const MockGranteesContract = await ethers.getContractFactory(
      "DataPortabilityGranteesImplementation",
    );
    const granteesContractDeploy = await upgrades.deployProxy(
      MockGranteesContract,
      [trustedForwarder.address, owner.address],
      {
        kind: "uups",
      },
    );
    granteesContract = await ethers.getContractAt(
      "DataPortabilityGranteesImplementation",
      granteesContractDeploy.target,
    );

    const dataPermissionDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory(
        "DataPortabilityPermissionsImplementation",
      ),
      [
        trustedForwarder.address,
        owner.address,
        await dataRegistry.getAddress(),
        await testServersContract.getAddress(),
        await granteesContract.getAddress(),
      ],
      {
        kind: "uups",
      },
    );

    dataPermission = await ethers.getContractAt(
      "DataPortabilityPermissionsImplementation",
      dataPermissionDeploy.target,
    );

    await dataPermission
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);

    // Grant PERMISSION_MANAGER_ROLE to main contract so it can manage grantee permissions
    const PERMISSION_MANAGER_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
    );
    await granteesContract
      .connect(owner)
      .grantRole(PERMISSION_MANAGER_ROLE, await dataPermission.getAddress());

    // Grant PERMISSION_MANAGER_ROLE to DataPortabilityPermissions contract on DataPortabilityServers
    await testServersContract
      .connect(owner)
      .grantRole(PERMISSION_MANAGER_ROLE, await dataPermission.getAddress());
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
      (await dataPermission.version()).should.eq(2);
    });

    it("should grant roles", async function () {
      await dataPermission
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, testUser1.address).should.not.be.rejected;

      await dataPermission
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, testUser1.address).should.be.fulfilled;

      await dataPermission
        .connect(testUser1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      await dataPermission
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, testUser2.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dataPermission
        .connect(testUser1)
        .grantRole(DEFAULT_ADMIN_ROLE, testUser2.address).should.be.fulfilled;
    });
  });

  describe("AddPermission", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        granteeId: bigint;
        grant: string;
        fileIds: bigint[];
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityPermissions",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        Permission: [
          { name: "nonce", type: "uint256" },
          { name: "granteeId", type: "uint256" },
          { name: "grant", type: "string" },
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        granteeId: permission.granteeId,
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
        name: "VanaDataPortabilityPermissions",
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
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      // User1 should start with nonce 0
      (await dataPermission.userNonce(testUser1.address)).should.eq(0);

      const signature = await createPermissionSignature(permission, testUser1);

      const tx = await dataPermission
        .connect(testUser1)
        .addPermission(permission, signature);

      // Verify event was emitted
      await expect(tx).to.emit(dataPermission, "PermissionAdded");

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(1);

      // Verify nonce increased
      (await dataPermission.userNonce(testUser1.address)).should.eq(1);

      // Verify permission was stored
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grantor.should.eq(testUser1.address);
      storedPermission.nonce.should.eq(0);
      storedPermission.granteeId.should.eq(1);
      storedPermission.grant.should.eq(permission.grant);

      // Verify it's indexed by user
      (
        await dataPermission.userPermissionIdsLength(testUser1.address)
      ).should.eq(1);
      (
        await dataPermission.userPermissionIdsAt(testUser1.address, 0)
      ).should.eq(1n);

      // Test the userPermissionIdsValues function
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        testUser1.address,
      );
      userPermissionIds.should.deep.eq([1n]);
    });

    it("should reject permission with incorrect nonce", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 1n, // Wrong nonce - should be 0
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature),
      )
        .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(0, 1); // expected, provided

      // Nonce should remain unchanged
      (await dataPermission.userNonce(testUser1.address)).should.eq(0);
    });

    it("should reject permission with empty grant", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "", // Empty grant
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature),
      ).to.be.revertedWithCustomError(dataPermission, "EmptyGrant");

      // Nonce should remain unchanged
      (await dataPermission.userNonce(testUser1.address)).should.eq(0);
    });

    it("should allow multiple permissions with the same grant", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission1 = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://samegrant",
        fileIds: [],
      };

      const permission2 = {
        nonce: 1n,
        granteeId: 1n,
        grant: "ipfs://samegrant", // Same grant - should be allowed now
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(
        permission1,
        testUser1,
      );
      const signature2 = await createPermissionSignature(
        permission2,
        testUser1,
      );

      // Add first permission
      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);

      // Add second permission with same grant - should succeed
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify both permissions were added
      (await dataPermission.permissionsCount()).should.eq(2);
      (await dataPermission.userNonce(testUser1.address)).should.eq(2);

      // Verify both permissions have the same grant
      const storedPermission1 = await dataPermission.permissions(1);
      const storedPermission2 = await dataPermission.permissions(2);
      storedPermission1.grant.should.eq("ipfs://samegrant");
      storedPermission2.grant.should.eq("ipfs://samegrant");
    });

    it("should add multiple permissions for the same user with sequential nonces", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission1 = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 1n,
        granteeId: 1n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(
        permission1,
        testUser1,
      );
      const signature2 = await createPermissionSignature(
        permission2,
        testUser1,
      );

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
          testUser1.address,
          permission1.granteeId,
          permission1.grant,
          [],
        );

      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          2,
          testUser1.address,
          permission2.granteeId,
          permission2.grant,
          [],
        );

      // Verify permissions count increased
      (await dataPermission.permissionsCount()).should.eq(2);

      // Verify nonce increased to 2
      (await dataPermission.userNonce(testUser1.address)).should.eq(2);

      // Verify both permissions are indexed by user
      (
        await dataPermission.userPermissionIdsLength(testUser1.address)
      ).should.eq(2);
      (
        await dataPermission.userPermissionIdsAt(testUser1.address, 0)
      ).should.eq(1n);
      (
        await dataPermission.userPermissionIdsAt(testUser1.address, 1)
      ).should.eq(2n);

      // Test userPermissionIdsValues
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        testUser1.address,
      );
      userPermissionIds.should.deep.eq([1n, 2n]);
    });

    it("should add permissions for different users independently", async function () {
      // First register grantees for both users
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
      await granteesContract
        .connect(testUser2)
        .registerGrantee(testUser1.address, testUser1.address, "publicKey2");

      const permission1 = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n, // Each user starts with nonce 0
        granteeId: 2n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(
        permission1,
        testUser1,
      );
      const signature2 = await createPermissionSignature(
        permission2,
        testUser2,
      );

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify each user has their nonce incremented independently
      (await dataPermission.userNonce(testUser1.address)).should.eq(1);
      (await dataPermission.userNonce(testUser2.address)).should.eq(1);

      // Verify each user has one permission
      (
        await dataPermission.userPermissionIdsLength(testUser1.address)
      ).should.eq(1);
      (
        await dataPermission.userPermissionIdsLength(testUser2.address)
      ).should.eq(1);

      // Verify stored permissions have correct user fields
      const storedPermission1 = await dataPermission.permissions(1);
      const storedPermission2 = await dataPermission.permissions(2);
      storedPermission1.grantor.should.eq(testUser1.address);
      storedPermission2.grantor.should.eq(testUser2.address);
    });

    it("should assign sequential IDs to permissions", async function () {
      // First register grantees for all users
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
      await granteesContract
        .connect(testUser2)
        .registerGrantee(user3.address, user3.address, "publicKey2");
      await granteesContract
        .connect(user3)
        .registerGrantee(maintainer.address, maintainer.address, "publicKey3");

      const permissions = [
        { nonce: 0n, granteeId: 1n, grant: "ipfs://grant1", fileIds: [] },
        { nonce: 0n, granteeId: 2n, grant: "ipfs://grant2", fileIds: [] },
        { nonce: 0n, granteeId: 3n, grant: "ipfs://grant3", fileIds: [] },
      ];

      const users = [testUser1, testUser2, user3];

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
    });

    it("should revert when accessing out of bounds permission indices", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Should revert when accessing index 1 (only index 0 exists)
      await expect(dataPermission.userPermissionIdsAt(testUser1.address, 1)).to
        .be.rejected;

      // Should revert for non-existent user
      await expect(dataPermission.userPermissionIdsAt(testUser2.address, 0)).to
        .be.rejected;
    });

    it("should track nonces correctly across multiple users", async function () {
      // First register grantees for both users
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
      await granteesContract
        .connect(testUser2)
        .registerGrantee(testUser1.address, testUser1.address, "publicKey2");

      const permission1 = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n,
        granteeId: 2n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      // Both users start with nonce 0
      (await dataPermission.userNonce(testUser1.address)).should.eq(0);
      (await dataPermission.userNonce(testUser2.address)).should.eq(0);

      const signature1 = await createPermissionSignature(
        permission1,
        testUser1,
      );
      const signature2 = await createPermissionSignature(
        permission2,
        testUser2,
      );

      await dataPermission
        .connect(sponsor)
        .addPermission(permission1, signature1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify nonces were incremented independently
      (await dataPermission.userNonce(testUser1.address)).should.eq(1);
      (await dataPermission.userNonce(testUser2.address)).should.eq(1);

      // Add another permission for testUser1
      const permission3 = {
        nonce: 1n,
        granteeId: 1n,
        grant: "ipfs://grant3",
        fileIds: [],
      };

      const signature3 = await createPermissionSignature(
        permission3,
        testUser1,
      );
      await dataPermission
        .connect(sponsor)
        .addPermission(permission3, signature3);

      // Verify testUser1's nonce incremented while testUser2's remained the same
      (await dataPermission.userNonce(testUser1.address)).should.eq(2);
      (await dataPermission.userNonce(testUser2.address)).should.eq(1);
    });

    it("should handle grants with special characters", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant-with-special-chars_123!@#$%^&*()",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);
    });

    it("should test userPermissionIdsValues function with multiple permissions", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permissions = [
        { nonce: 0n, granteeId: 1n, grant: "ipfs://grant1", fileIds: [] },
        { nonce: 1n, granteeId: 1n, grant: "ipfs://grant2", fileIds: [] },
        { nonce: 2n, granteeId: 1n, grant: "ipfs://grant3", fileIds: [] },
      ];

      // Add all permissions for testUser1
      for (let i = 0; i < permissions.length; i++) {
        const signature = await createPermissionSignature(
          permissions[i],
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permissions[i], signature);
      }

      // Test userPermissionIdsValues
      const userPermissionIds = await dataPermission.userPermissionIdsValues(
        testUser1.address,
      );
      userPermissionIds.should.deep.eq([1n, 2n, 3n]);

      // Test for user with no permissions
      const emptyUserPermissionIds =
        await dataPermission.userPermissionIdsValues(testUser2.address);
      emptyUserPermissionIds.should.deep.eq([]);
    });

    it("should emit events with correct parameters for multiple permissions", async function () {
      // First register grantees for both users
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
      await granteesContract
        .connect(testUser2)
        .registerGrantee(testUser1.address, testUser1.address, "publicKey2");

      const permission1 = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const permission2 = {
        nonce: 0n,
        granteeId: 2n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(
        permission1,
        testUser1,
      );
      const signature2 = await createPermissionSignature(
        permission2,
        testUser2,
      );

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
          testUser1.address,
          permission1.granteeId,
          permission1.grant,
          [],
        );

      // Verify second event
      await expect(tx2)
        .to.emit(dataPermission, "PermissionAdded")
        .withArgs(
          2,
          testUser2.address,
          permission2.granteeId,
          permission2.grant,
          [],
        );
    });

    it("should work when called by sponsor wallet but signed by actual user", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      // sponsor calls the function but permission is signed by testUser1
      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      // Verify it's indexed by the signer (testUser1), not the caller (sponsor)
      (
        await dataPermission.userPermissionIdsLength(testUser1.address)
      ).should.eq(1);
      (
        await dataPermission.userPermissionIdsAt(testUser1.address, 0)
      ).should.eq(1n);

      (await dataPermission.userPermissionIdsLength(sponsor.address)).should.eq(
        0,
      );

      // Verify stored permission has correct user field
      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grantor.should.eq(testUser1.address);
    });

    it("should validate IPFS URI format in grant field", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const validPermission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(
        validPermission,
        testUser1,
      );

      await dataPermission
        .connect(sponsor)
        .addPermission(validPermission, signature).should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(validPermission.grant);
    });

    it("should handle grant field with very long strings", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const longGrant = "ipfs://" + "a".repeat(1000); // Very long grant
      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: longGrant,
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(longGrant);
    });

    it("should handle unicode characters in grant", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant-with-unicode-🚀-💎-🌟",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      await dataPermission.connect(sponsor).addPermission(permission, signature)
        .should.be.fulfilled;

      const storedPermission = await dataPermission.permissions(1);
      storedPermission.grant.should.eq(permission.grant);
    });

    it("should verify signature but not store it", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      const signature = await createPermissionSignature(permission, testUser1);

      // Create an invalid signature by modifying the valid one
      const invalidSignature = signature.slice(0, -2) + "00";

      // Should accept valid signature
      await expect(
        dataPermission.connect(sponsor).addPermission(permission, signature),
      ).to.not.be.reverted;

      // Should reject invalid signature (using incremented nonce)
      permission.nonce = 1n;
      await expect(
        dataPermission
          .connect(sponsor)
          .addPermission(permission, invalidSignature),
      ).to.be.reverted;
    });

    it("should handle max nonce values", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileIds: [],
      };

      // Add first permission to increment nonce
      let signature = await createPermissionSignature(permission, testUser1);
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature);

      // Try with very large nonce (but wrong)
      const largeNoncePermission = {
        nonce: 999999n,
        granteeId: 1n,
        grant: "ipfs://grant2",
        fileIds: [],
      };

      signature = await createPermissionSignature(
        largeNoncePermission,
        testUser1,
      );

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
      (await dataPermission.hasRole(DEFAULT_ADMIN_ROLE, testUser1)).should.eq(
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
        granteeId: bigint;
        grant: string;
        fileIds: bigint[];
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityPermissions",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        Permission: [
          { name: "nonce", type: "uint256" },
          { name: "granteeId", type: "uint256" },
          { name: "grant", type: "string" },
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        granteeId: permission.granteeId,
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
        name: "VanaDataPortabilityPermissions",
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
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // First add a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Verify permission was created successfully
        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(1);

        // Revoke the permission
        const tx = await dataPermission.connect(testUser1).revokePermission(1);

        // Verify event was emitted
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify permission was revoked

        // Verify permission is removed from user's active permissions
        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(0);

        // Verify permission data still exists
        const revokedPermission = await dataPermission.permissions(1);
        revokedPermission.grantor.should.eq(testUser1.address);
        revokedPermission.grant.should.eq(permission.grant);
      });

      it("should reject revocation by non-owner", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // User1 adds a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // User2 tries to revoke testUser1's permission
        await expect(
          dataPermission.connect(testUser2).revokePermission(1),
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");

        // Verify permission data is accessible
        const permissionData = await dataPermission.permissions(1);
        permissionData.grantor.should.eq(testUser1.address);
      });

      it("should reject revoking already revoked permission", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add and revoke a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await dataPermission.connect(testUser1).revokePermission(1);

        // Try to revoke again
        await expect(dataPermission.connect(testUser1).revokePermission(1))
          .to.be.revertedWithCustomError(dataPermission, "InactivePermission")
          .withArgs(1);
      });

      it("should handle multiple permissions correctly", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add multiple permissions
        const permissions = [
          { nonce: 0n, granteeId: 1n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, granteeId: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, granteeId: 1n, grant: "ipfs://grant3", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, testUser1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Verify all are active
        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(3);

        // Revoke the middle permission
        await dataPermission.connect(testUser1).revokePermission(2);

        // Verify permissions were managed correctly
        const remainingPermissions =
          await dataPermission.userPermissionIdsValues(testUser1.address);
        remainingPermissions.length.should.eq(2);

        // Verify user now has 2 active permissions
        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(2);

        // Verify remaining permissions
        const remainingPermIds = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        remainingPermIds.should.deep.eq([1n, 3n]);
      });
    });

    describe("Signature-based Revocation", () => {
      it("should revoke permission with valid signature", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission first
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // User nonce should be 1 after adding permission
        (await dataPermission.userNonce(testUser1.address)).should.eq(1);

        // Create revoke permission input
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        // Sponsor executes the revocation
        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Verify event
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify nonce was incremented
        (await dataPermission.userNonce(testUser1.address)).should.eq(2);

        // Verify permission was properly processed
      });

      it("should reject revocation with wrong nonce", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Try to revoke with wrong nonce
        const revokeInput = {
          nonce: 0n, // Wrong - should be 1
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature),
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0);
      });

      it("should reject revocation of non-owned permission", async function () {
        // First register grantees for both users
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
        await granteesContract
          .connect(testUser2)
          .registerGrantee(testUser1.address, testUser1.address, "publicKey2");

        // User1 adds a permission
        const permission1 = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const sig1 = await createPermissionSignature(permission1, testUser1);
        await dataPermission.connect(sponsor).addPermission(permission1, sig1);

        // User2 adds a permission
        const permission2 = {
          nonce: 0n,
          granteeId: 2n,
          grant: "ipfs://grant2",
          fileIds: [],
        };

        const sig2 = await createPermissionSignature(permission2, testUser2);
        await dataPermission.connect(sponsor).addPermission(permission2, sig2);

        // User2 tries to revoke testUser1's permission (ID 1)
        const revokeInput = {
          nonce: 1n, // User2's current nonce
          permissionId: 1n, // User1's permission
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser2,
        );

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature),
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");
      });

      it("should handle gasless revocation via sponsor", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        // Sponsor pays for gas
        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Verify it worked
        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // Verify the permission belongs to testUser1, not sponsor
        const revokedPerm = await dataPermission.permissions(1);
        revokedPerm.grantor.should.eq(testUser1.address);
      });
    });

    describe("Edge Cases and State Management", () => {
      it("should correctly update user permission sets", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add 3 permissions
        const permissions = [
          { nonce: 0n, granteeId: 1n, grant: "ipfs://grant1", fileIds: [] },
          { nonce: 1n, granteeId: 1n, grant: "ipfs://grant2", fileIds: [] },
          { nonce: 2n, granteeId: 1n, grant: "ipfs://grant3", fileIds: [] },
        ];

        for (const perm of permissions) {
          const sig = await createPermissionSignature(perm, testUser1);
          await dataPermission.connect(sponsor).addPermission(perm, sig);
        }

        // Initial state
        let activePerms = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePerms.should.deep.eq([1n, 2n, 3n]);

        // Revoke permission 2
        await dataPermission.connect(testUser1).revokePermission(2);

        // Check updated state
        activePerms = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePerms.should.deep.eq([1n, 3n]);

        // Revoke permission 1
        await dataPermission.connect(testUser1).revokePermission(1);

        // Check state again
        activePerms = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePerms.should.deep.eq([3n]);

        // Revoke last permission
        await dataPermission.connect(testUser1).revokePermission(3);

        // Should have no active permissions
        activePerms = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePerms.should.deep.eq([]);

        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(0);
      });

      it("should prevent replay attacks on revocation", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        // First revocation succeeds
        await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        // Replay attempt should fail due to incremented nonce
        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature),
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(2, 1); // Expected nonce 2, provided 1
      });

      it("should handle revocation of non-existent permission", async function () {
        // Try to revoke permission that doesn't exist
        await expect(
          dataPermission.connect(testUser1).revokePermission(999),
        ).to.be.revertedWithCustomError(dataPermission, "NotPermissionGrantor");
      });

      it("should maintain correct state after mixed operations", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add permission 1
        const perm1 = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };
        const sig1 = await createPermissionSignature(perm1, testUser1);
        await dataPermission.connect(sponsor).addPermission(perm1, sig1);

        // Add permission 2
        const perm2 = {
          nonce: 1n,
          granteeId: 1n,
          grant: "ipfs://grant2",
          fileIds: [],
        };
        const sig2 = await createPermissionSignature(perm2, testUser1);
        await dataPermission.connect(sponsor).addPermission(perm2, sig2);

        // Revoke permission 1
        await dataPermission.connect(testUser1).revokePermission(1);

        // Add permission 3
        const perm3 = {
          nonce: 2n,
          granteeId: 1n,
          grant: "ipfs://grant3",
          fileIds: [],
        };
        const sig3 = await createPermissionSignature(perm3, testUser1);
        await dataPermission.connect(sponsor).addPermission(perm3, sig3);

        // Check final state
        const activePerms = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePerms.should.deep.eq([2n, 3n]);

        // Verify permission states were managed correctly
        const activePermissions = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        activePermissions.length.should.eq(2);
      });
    });

    describe("Integration with Other Features", () => {
      it("should work correctly with trusted servers", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Add and trust a server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.com",
        );

        // Revoke the permission
        await dataPermission.connect(testUser1).revokePermission(1);

        // Server trust should be unaffected
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        // Permission should be revoked
        const userPermissions = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        userPermissions.length.should.eq(0);
      });

      it("should handle nonce correctly across different operations", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Initial nonce
        (await dataPermission.userNonce(testUser1.address)).should.eq(0);

        // Add permission (increments nonce to 1)
        const perm1 = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };
        const sig1 = await createPermissionSignature(perm1, testUser1);
        await dataPermission.connect(sponsor).addPermission(perm1, sig1);

        // Add another permission (increments nonce to 2)
        const perm2 = {
          nonce: 1n,
          granteeId: 1n,
          grant: "ipfs://grant2",
          fileIds: [],
        };
        const sig2 = await createPermissionSignature(perm2, testUser1);
        await dataPermission.connect(sponsor).addPermission(perm2, sig2);

        // Revoke with signature (increments nonce to 3)
        const revokeInput = {
          nonce: 2n,
          permissionId: 1n,
        };
        const revokeSig = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSig);

        // Final nonce should be 3
        (await dataPermission.userNonce(testUser1.address)).should.eq(3);

        // Direct revocation should not affect nonce
        await dataPermission.connect(testUser1).revokePermission(2);
        (await dataPermission.userNonce(testUser1.address)).should.eq(3);
      });
    });

    describe("Pause Functionality", () => {
      it("should reject revocation when paused", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Pause the contract
        await dataPermission.connect(maintainer).pause();

        // Try to revoke directly
        await expect(
          dataPermission.connect(testUser1).revokePermission(1),
        ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

        // Try to revoke with signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };
        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        await expect(
          dataPermission
            .connect(sponsor)
            .revokePermissionWithSignature(revokeInput, revokeSignature),
        ).to.be.revertedWithCustomError(dataPermission, "EnforcedPause");

        // Unpause
        await dataPermission.connect(maintainer).unpause();

        // Now revocation should work
        await dataPermission.connect(testUser1).revokePermission(1);
        const userPermissions = await dataPermission.userPermissionIdsValues(
          testUser1.address,
        );
        userPermissions.length.should.eq(0);
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
        granteeId: bigint;
        grant: string;
        fileIds: bigint[];
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityPermissions",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        Permission: [
          { name: "nonce", type: "uint256" },
          { name: "granteeId", type: "uint256" },
          { name: "grant", type: "string" },
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        granteeId: permission.granteeId,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    it("should handle multiple users with same grant (should succeed)", async function () {
      // First register grantees
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
      await granteesContract
        .connect(testUser2)
        .registerGrantee(user3.address, user3.address, "publicKey2");

      const permission = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://same-grant",
        fileIds: [],
      };

      const signature1 = await createPermissionSignature(permission, testUser1);

      const permission2 = {
        nonce: 0n,
        granteeId: 2n,
        grant: "ipfs://same-grant",
        fileIds: [],
      };
      const signature2 = await createPermissionSignature(
        permission2,
        testUser2,
      );

      // First user should succeed
      await dataPermission
        .connect(sponsor)
        .addPermission(permission, signature1);

      // Second user should also succeed (same grant is now allowed)
      await dataPermission
        .connect(sponsor)
        .addPermission(permission2, signature2);

      // Verify both permissions were created
      (await dataPermission.permissionsCount()).should.eq(2);

      // Verify both have the same grant
      const storedPermission1 = await dataPermission.permissions(1);
      const storedPermission2 = await dataPermission.permissions(2);
      storedPermission1.grant.should.eq("ipfs://same-grant");
      storedPermission2.grant.should.eq("ipfs://same-grant");

      // Verify they have different grantors
      storedPermission1.grantor.should.eq(testUser1.address);
      storedPermission2.grantor.should.eq(testUser2.address);
    });

    it("should handle rapid succession of permissions", async function () {
      // First register a grantee
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

      const permissions = [];
      const signatures = [];

      // Create 10 permissions rapidly
      for (let i = 0; i < 10; i++) {
        const permission = {
          nonce: BigInt(i),
          granteeId: 1n,
          grant: `ipfs://grant${i}`,
          fileIds: [],
        };
        permissions.push(permission);
        signatures.push(await createPermissionSignature(permission, testUser1));
      }

      // Add them all
      for (let i = 0; i < 10; i++) {
        await dataPermission
          .connect(sponsor)
          .addPermission(permissions[i], signatures[i]);
      }

      // Verify all were added
      (await dataPermission.permissionsCount()).should.eq(10);
      (await dataPermission.userNonce(testUser1.address)).should.eq(10);
      (
        await dataPermission.userPermissionIdsLength(testUser1.address)
      ).should.eq(10);
    });
  });

  describe("Server Functions", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createPermissionSignature = async (
      permission: {
        nonce: bigint;
        granteeId: bigint;
        grant: string;
        fileIds: bigint[];
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityPermissions",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await dataPermission.getAddress(),
      };

      const types = {
        Permission: [
          { name: "nonce", type: "uint256" },
          { name: "granteeId", type: "uint256" },
          { name: "grant", type: "string" },
          { name: "fileIds", type: "uint256[]" },
        ],
      };

      const value = {
        nonce: permission.nonce,
        granteeId: permission.granteeId,
        grant: permission.grant,
        fileIds: permission.fileIds,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createTrustServerSignature = async (
      trustServerInput: {
        nonce: bigint;
        serverId: bigint;
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityServers",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await testServersContract.getAddress(),
      };

      const types = {
        TrustServer: [
          { name: "nonce", type: "uint256" },
          { name: "serverId", type: "uint256" },
        ],
      };

      const value = {
        nonce: trustServerInput.nonce,
        serverId: trustServerInput.serverId,
      };

      return await signer.signTypedData(domain, types, value);
    };

    const createUntrustServerSignature = async (
      untrustServerInput: {
        nonce: bigint;
        serverId: bigint;
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityServers",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await testServersContract.getAddress(),
      };

      const types = {
        UntrustServer: [
          { name: "nonce", type: "uint256" },
          { name: "serverId", type: "uint256" },
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
        const serverUrl = "https://testServer1.example.com";

        // Server should not exist initially
        const serverIdBefore = await testServersContract.serverAddressToId(
          testServer1.address,
        );
        serverIdBefore.should.eq(0);

        // Add and trust server using the helper function
        const serverId = await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        // Verify server was created
        serverId.should.eq(1);
        const serverAfter = await testServersContract.serverByAddress(
          testServer1.address,
        );
        serverAfter.url.should.eq(serverUrl);
      });

      it("should reject adding server with empty URL", async function () {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          "",
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: serverNonce,
              serverAddress: testServer1.address,
              publicKey: "0x1234567890abcdef",
              serverUrl: "",
            },
            serverSignature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
      });

      it("should reject registering same server twice", async function () {
        const serverUrl = "https://testServer1.example.com";

        // First user registers server
        const nonce1 = await testServersContract.userNonce(testUser1.address);
        const signature1 = await createAddServerSignature(
          testUser1,
          nonce1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce1,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          signature1,
        );

        // Second user tries to register same server address
        const nonce2 = await testServersContract.userNonce(testUser2.address);
        const signature2 = await createAddServerSignature(
          testUser2,
          nonce2,
          testServer1.address,
          "0xabcdef1234567890",
          "https://different.com",
        );
        await expect(
          testServersContract.connect(testUser2).addServerWithSignature(
            {
              nonce: nonce2,
              serverAddress: testServer1.address,
              publicKey: "0xabcdef1234567890",
              serverUrl: "https://different.com",
            },
            signature2,
          ),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerAlreadyRegistered",
        );
      });

      it("should allow different servers to be created and trusted", async function () {
        const serverUrl1 = "https://testServer1.example.com";
        const serverUrl2 = "https://testServer2.example.com";

        // User1 adds and trusts testServer1
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl1,
        );

        // User2 adds and trusts testServer2
        await addAndTrustServer(
          testUser2,
          testServer2.address,
          "0xabcdef1234567890",
          serverUrl2,
        );

        // Verify both servers exist
        const serverInfo1 = await testServersContract.serverByAddress(
          testServer1.address,
        );
        const serverInfo2 = await testServersContract.serverByAddress(
          testServer2.address,
        );

        serverInfo1.url.should.eq(serverUrl1);
        serverInfo2.url.should.eq(serverUrl2);
      });
    });

    describe("trustServer", () => {
      const serverUrl = "https://server.example.com";

      it("should trust a server successfully", async function () {
        // First register the server
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          serverSignature,
        );

        // Then trust it
        const tx = await testServersContract.connect(testUser1).trustServer(1);

        await expect(tx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, 1);

        // Verify server is in user's trusted list
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsAt(testUser1.address, 0)
        ).should.eq(1);
      });

      it("should add and trust a new server", async function () {
        const serverId = await addAndTrustServer(
          testUser1,
          testServer2.address,
          "0xabcdef1234567890",
          "https://newserver.com",
        );

        // Verify server was created with ID 1
        serverId.should.eq(1);

        // Verify server is in user's trusted list
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsAt(testUser1.address, 0)
        ).should.eq(1);
      });

      it("should reject trusting server that doesn't exist", async function () {
        // Try to trust server that doesn't exist
        await expect(
          testServersContract.connect(testUser1).trustServer(999),
        ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
      });

      it("should reject trusting server with ID 0", async function () {
        await expect(
          testServersContract.connect(testUser1).trustServer(0),
        ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
      });

      it("should allow trusting already trusted server (idempotent)", async function () {
        // First register and trust the server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        // Trust again - should succeed (idempotent)
        await testServersContract.connect(testUser1).trustServer(1);

        // Should still have only one trusted server
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
      });

      it("should allow trusting multiple servers", async function () {
        const serverUrl2 = "https://testServer2.example.com";

        // Register and trust both servers
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        await addAndTrustServer(
          testUser1,
          testServer2.address,
          "0xabcdef1234567890",
          serverUrl2,
        );

        // Verify both are trusted
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(2);

        const trustedServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        trustedServers.should.deep.eq([1n, 2n]);
      });

      it("should handle trusting same server multiple times gracefully", async function () {
        // Register server first
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          serverSignature,
        );

        // Trust server
        await testServersContract.connect(testUser1).trustServer(1);

        // Trust again - should succeed (idempotent behavior)
        await testServersContract.connect(testUser1).trustServer(1);

        // Should still have only one trusted server
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        // Verify server is still trusted
        const trustedServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        trustedServers.should.deep.eq([1n]);
      });
    });

    describe("trustServerWithSignature", () => {
      const serverUrl = "https://server.example.com";

      it("should trust server with valid signature", async function () {
        // First register the server
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addSignature = await createAddServerSignature(
          testUser1,
          nonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          addSignature,
        );

        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        // User nonce should be 1 after adding server
        (await testServersContract.userNonce(testUser1.address)).should.eq(1);

        const tx = await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, trustSignature);

        await expect(tx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, 1);

        // Verify nonce was incremented (was 1 after adding server, now 2 after trusting)
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);

        // Verify server is trusted
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
      });

      it("should reject with incorrect nonce", async function () {
        // First register the server
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addSignature = await createAddServerSignature(
          testUser1,
          nonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          addSignature,
        );

        // After adding server, nonce should be incremented by 1
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce + 1n, // Wrong nonce (should be currentNonce)
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        await expect(
          testServersContract
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, trustSignature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(currentNonce, currentNonce + 1n);
      });

      it("should work when called by sponsor but signed by user", async function () {
        // First register the server
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addSignature = await createAddServerSignature(
          testUser1,
          nonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          addSignature,
        );

        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, trustSignature);

        // Verify it's indexed by the signer (testUser1), not the caller (sponsor)
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsLength(sponsor.address)
        ).should.eq(0);
      });
    });

    describe("untrustServer", () => {
      const serverUrl = "https://server.example.com";

      beforeEach(async function () {
        // Register and trust server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
      });

      it("should untrust a server successfully", async function () {
        // Verify server is trusted
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        const tx = await testServersContract
          .connect(testUser1)
          .untrustServer(1);

        await expect(tx)
          .to.emit(testServersContract, "ServerUntrusted")
          .withArgs(testUser1.address, 1);

        // Verify server remains in list but is not active
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
      });

      it("should reject untrusting non-trusted server", async function () {
        // Register another server but don't trust it
        const nonce = await testServersContract.userNonce(testUser1.address);
        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          testServer2.address,
          "0xabcdef1234567890",
          "https://testServer2.example.com",
        );

        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce,
            serverAddress: testServer2.address,
            publicKey: "0xabcdef1234567890",
            serverUrl: "https://testServer2.example.com",
          },
          signature,
        );

        await expect(
          testServersContract.connect(testUser1).untrustServer(2),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerNotTrusted",
        );
      });

      it("should reject untrusting server with ID 0", async function () {
        await expect(
          testServersContract.connect(testUser1).untrustServer(0),
        ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
      });

      it("should not affect other users' trust", async function () {
        // User2 also trusts the server
        await testServersContract.connect(testUser2).trustServer(1);

        // User1 untrusts
        await testServersContract.connect(testUser1).untrustServer(1);

        // User1 should still have the server in list but inactive
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        // User2 should still trust the server
        (
          await testServersContract.userServerIdsLength(testUser2.address)
        ).should.eq(1);
      });
    });

    describe("untrustServerWithSignature", () => {
      const serverUrl = "https://server.example.com";

      beforeEach(async function () {
        // Register and trust server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
      });

      it("should untrust server with valid signature", async function () {
        // After addAndTrustServer helper, nonce should be 1 (from addServerWithSignature)
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const untrustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const signature = await createUntrustServerSignature(
          untrustServerInput,
          testUser1,
        );

        const tx = await testServersContract
          .connect(sponsor)
          .untrustServerWithSignature(untrustServerInput, signature);

        await expect(tx)
          .to.emit(testServersContract, "ServerUntrusted")
          .withArgs(testUser1.address, 1);

        // Verify nonce was incremented
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);

        // Verify server remains in list but is not active
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
      });

      it("should reject with incorrect nonce", async function () {
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const untrustServerInput = {
          nonce: currentNonce + 1n, // Wrong nonce (should be currentNonce)
          serverId: 1n,
        };

        const signature = await createUntrustServerSignature(
          untrustServerInput,
          testUser1,
        );

        await expect(
          testServersContract
            .connect(sponsor)
            .untrustServerWithSignature(untrustServerInput, signature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(currentNonce, currentNonce + 1n);
      });
    });

    describe("View Functions", () => {
      beforeEach(async function () {
        // Setup: Create 3 servers by having different users trust them
        const servers = [
          {
            serverAddress: testServer1.address,
            url: "https://testServer1.com",
          },
          {
            serverAddress: testServer2.address,
            url: "https://testServer2.com",
          },
          { serverAddress: maintainer.address, url: "https://server3.com" },
        ];

        // User1 adds and trusts first two servers
        await addAndTrustServer(
          testUser1,
          servers[0].serverAddress,
          "0x1234567890abcdef",
          servers[0].url,
        );

        await addAndTrustServer(
          testUser1,
          servers[1].serverAddress,
          "0xabcdef1234567890",
          servers[1].url,
        );

        // User2 adds and trusts the third server
        await addAndTrustServer(
          testUser2,
          servers[2].serverAddress,
          "0x9876543210fedcba",
          servers[2].url,
        );
      });

      it("should return correct userServerIdsLength", async function () {
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(2);
        (
          await testServersContract.userServerIdsLength(testUser2.address)
        ).should.eq(1);
      });

      it("should return correct userServerIdsAt", async function () {
        (
          await testServersContract.userServerIdsAt(testUser1.address, 0)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsAt(testUser1.address, 1)
        ).should.eq(2);
      });

      it("should revert on out of bounds userServerIdsAt", async function () {
        await expect(testServersContract.userServerIdsAt(testUser1.address, 2))
          .to.be.reverted;
      });

      it("should return correct userServerIdsValues", async function () {
        const serverIds = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        serverIds.should.deep.eq([1n, 2n]);

        const testUser2ServerIds =
          await testServersContract.userServerIdsValues(testUser2.address);
        testUser2ServerIds.should.deep.eq([3n]);

        // Test a user with no trusted servers
        const emptyServerIds = await testServersContract.userServerIdsValues(
          user3.address,
        );
        emptyServerIds.should.deep.eq([]);
      });

      it("should return correct server info", async function () {
        const serverInfo1 = await testServersContract.serverByAddress(
          testServer1.address,
        );
        serverInfo1.url.should.eq("https://testServer1.com");

        const serverInfo2 = await testServersContract.serverByAddress(
          testServer2.address,
        );
        serverInfo2.url.should.eq("https://testServer2.com");

        // Non-existent server should return empty
        const nonExistent = await testServersContract.serverByAddress(
          user3.address,
        );
        nonExistent.url.should.eq("");
      });

      it("should return correct userServerValues", async function () {
        // Get all trusted servers for testUser1
        const user1Servers = await testServersContract.userServerValues(
          testUser1.address,
        );

        // testUser1 trusted servers 1 and 2
        user1Servers.should.have.lengthOf(2);

        // Check first server details
        user1Servers[0].id.should.eq(1n);
        user1Servers[0].owner.should.eq(testUser1.address);
        user1Servers[0].serverAddress.should.eq(testServer1.address);
        user1Servers[0].publicKey.should.eq("0x1234567890abcdef");
        user1Servers[0].url.should.eq("https://testServer1.com");
        user1Servers[0].startBlock.should.be.gt(0n);
        user1Servers[0].endBlock.should.eq(ethers.MaxUint256);

        // Check second server details
        user1Servers[1].id.should.eq(2n);
        user1Servers[1].owner.should.eq(testUser1.address);
        user1Servers[1].serverAddress.should.eq(testServer2.address);
        user1Servers[1].publicKey.should.eq("0xabcdef1234567890");
        user1Servers[1].url.should.eq("https://testServer2.com");
        user1Servers[1].startBlock.should.be.gt(0n);
        user1Servers[1].endBlock.should.eq(ethers.MaxUint256);

        // Get all trusted servers for testUser2
        const user2Servers = await testServersContract.userServerValues(
          testUser2.address,
        );

        // testUser2 trusted only server 3
        user2Servers.should.have.lengthOf(1);
        user2Servers[0].id.should.eq(3n);
        user2Servers[0].owner.should.eq(testUser2.address);
        user2Servers[0].serverAddress.should.eq(maintainer.address);

        // Test user with no trusted servers
        const user3Servers = await testServersContract.userServerValues(
          user3.address,
        );
        user3Servers.should.have.lengthOf(0);
      });

      it("should return correct userServers for specific server", async function () {
        // Get specific server info for testUser1 and server 1
        const server1Info = await testServersContract.userServers(
          testUser1.address,
          1,
        );

        server1Info.id.should.eq(1n);
        server1Info.owner.should.eq(testUser1.address);
        server1Info.serverAddress.should.eq(testServer1.address);
        server1Info.publicKey.should.eq("0x1234567890abcdef");
        server1Info.url.should.eq("https://testServer1.com");
        server1Info.startBlock.should.be.gt(0n);
        server1Info.endBlock.should.eq(ethers.MaxUint256);

        // Get specific server info for testUser1 and server 2
        const server2Info = await testServersContract.userServers(
          testUser1.address,
          2,
        );

        server2Info.id.should.eq(2n);
        server2Info.serverAddress.should.eq(testServer2.address);

        // Should revert when querying a server not trusted by the user
        await expect(
          testServersContract.userServers(testUser1.address, 3),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerNotTrusted",
        );

        // Should revert when user has not trusted any server
        await expect(
          testServersContract.userServers(user3.address, 1),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerNotTrusted",
        );
      });

      it("should reflect changes in userServerValues after untrusting", async function () {
        // Initial state - testUser1 has 2 servers
        let servers = await testServersContract.userServerValues(
          testUser1.address,
        );
        servers.should.have.lengthOf(2);

        // Untrust server 1
        await testServersContract.connect(testUser1).untrustServer(1);

        // Check that server 1 was processed correctly (untrusted servers remain in list)
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        userServers.length.should.eq(2);

        // userServerValues still returns all servers (including untrusted ones)
        servers = await testServersContract.userServerValues(testUser1.address);
        servers.should.have.lengthOf(2);

        // But the untrusted server should have endBlock set to current block
        const untrustBlock = await ethers.provider.getBlockNumber();
        servers[0].endBlock.should.eq(BigInt(untrustBlock));
        servers[1].endBlock.should.eq(ethers.MaxUint256); // Server 2 still trusted
      });
    });

    describe("Replay Attack Prevention", () => {
      const serverUrl = "https://server.example.com";

      it("should prevent replay of trustServerWithSignature", async function () {
        // First register the server
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addSignature = await createAddServerSignature(
          testUser1,
          nonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          addSignature,
        );

        // Create trust signature with correct nonce
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        // First call should succeed
        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, trustSignature);

        // Verify nonce was incremented
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);

        // Replay attempt with same signature should fail due to wrong nonce
        await expect(
          testServersContract
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, trustSignature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(2, 1); // expects nonce 2, but signature has nonce 1
      });

      it("should prevent replay of untrustServerWithSignature", async function () {
        // First register and trust the server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const untrustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const signature = await createUntrustServerSignature(
          untrustServerInput,
          testUser1,
        );

        // First call should succeed
        await testServersContract
          .connect(sponsor)
          .untrustServerWithSignature(untrustServerInput, signature);

        // Verify nonce was incremented
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);

        // Replay attempt should fail due to wrong nonce
        await expect(
          testServersContract
            .connect(sponsor)
            .untrustServerWithSignature(untrustServerInput, signature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(2, 1);
      });

      it("should prevent cross-user replay attacks", async function () {
        // First register the server
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          serverSignature,
        );

        // User1 creates a trust signature with correct nonce
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const testUser1Signature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        // User1 trusts the server
        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, testUser1Signature);

        // User2 tries to replay User1's signature
        // This should fail because the signature verification will extract testUser1's address
        // but testUser2's nonce is still 0, so it will try to trust on behalf of testUser1
        // which will fail due to nonce mismatch (testUser1's nonce is now 1)
        await expect(
          testServersContract
            .connect(sponsor)
            .trustServerWithSignature(trustServerInput, testUser1Signature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(2, 1);

        // Even if we try with testUser2 signing with the same parameters
        // it's a different signature and will work for testUser2
        const testUser2Nonce = await testServersContract.userNonce(
          testUser2.address,
        );
        const testUser2TrustInput = {
          nonce: testUser2Nonce,
          serverId: 1n,
        };
        const testUser2Signature = await createTrustServerSignature(
          testUser2TrustInput,
          testUser2,
        );

        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(testUser2TrustInput, testUser2Signature);

        // Verify each user has their own trust relationship
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsLength(testUser2.address)
        ).should.eq(1);
      });

      it("should prevent replay attacks across different operations", async function () {
        // First register the server
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          serverSignature,
        );

        // Create signatures for both trust and untrust with same nonce
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );

        const trustInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const untrustInput = {
          nonce: currentNonce,
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustInput,
          testUser1,
        );
        const untrustSignature = await createUntrustServerSignature(
          untrustInput,
          testUser1,
        );

        // Execute trust operation
        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustInput, trustSignature);

        // Nonce is now 1, so untrust with nonce 0 should fail
        await expect(
          testServersContract
            .connect(sponsor)
            .untrustServerWithSignature(untrustInput, untrustSignature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(2, 1);

        // Create new untrust signature with correct nonce
        const newUntrustInput = {
          nonce: 2n,
          serverId: 1n,
        };

        const newUntrustSignature = await createUntrustServerSignature(
          newUntrustInput,
          testUser1,
        );

        // This should succeed
        await testServersContract
          .connect(sponsor)
          .untrustServerWithSignature(newUntrustInput, newUntrustSignature);
      });

      it("should prevent replay of permission signatures in server context", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );

        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Nonce is now 1
        (await dataPermission.userNonce(testUser1.address)).should.eq(1);

        // Try to replay the permission - should fail due to nonce mismatch
        await expect(
          dataPermission
            .connect(sponsor)
            .addPermission(permission, permSignature),
        )
          .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
          .withArgs(1, 0); // Expected nonce 1, provided 0

        // Now try server operations - they should use the updated nonce
        // First create a server
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.com",
        );

        // Untrust the server first, then trust it again to test the signature
        await testServersContract.connect(testUser1).untrustServer(1n);

        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustServerInput = {
          nonce: currentNonce, // Use current nonce from server contract
          serverId: 1n,
        };

        const trustSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(trustServerInput, trustSignature);

        // Verify nonce incremented again
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);
      });

      it("should maintain separate nonces per user preventing cross-contamination", async function () {
        // Both users start with nonce 0
        (await testServersContract.userNonce(testUser1.address)).should.eq(0);
        (await testServersContract.userNonce(testUser2.address)).should.eq(0);

        // Register server first
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: serverUrl,
          },
          serverSignature,
        );

        // User1 performs operation
        const testUser1CurrentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const testUser1Input = {
          nonce: testUser1CurrentNonce,
          serverId: 1n,
        };

        const testUser1Signature = await createTrustServerSignature(
          testUser1Input,
          testUser1,
        );

        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(testUser1Input, testUser1Signature);

        // User1's nonce incremented twice (add + trust), testUser2's unchanged
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);
        (await testServersContract.userNonce(testUser2.address)).should.eq(0);

        // User2 can still use nonce 0
        const testUser2CurrentNonce = await testServersContract.userNonce(
          testUser2.address,
        );
        const testUser2Input = {
          nonce: testUser2CurrentNonce,
          serverId: 1n,
        };

        const testUser2Signature = await createTrustServerSignature(
          testUser2Input,
          testUser2,
        );

        await testServersContract
          .connect(sponsor)
          .trustServerWithSignature(testUser2Input, testUser2Signature);

        // testUser1 has nonce 2 (add+trust), testUser2 has nonce 1 (trust only)
        (await testServersContract.userNonce(testUser1.address)).should.eq(2);
        (await testServersContract.userNonce(testUser2.address)).should.eq(1);
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
          name: "VanaDataPortabilityPermissions",
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
        // First register grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Set up files owned by testUser1
        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser1.address, "ipfs://file2");
        await dataRegistry.setFile(3, testUser1.address, "ipfs://file3");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Verify event was emitted
        await expect(tx).to.emit(dataPermission, "PermissionAdded").withArgs(
          1, // permissionId
          testUser1.address, // grantor
          permission.granteeId, // granteeId
          permission.grant,
          [1n, 2n, 3n],
        );

        // Verify permission was stored with fileIds
        const permissionInfo = await dataPermission.permissions(1);
        permissionInfo.grantor.should.eq(testUser1.address);
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
        // First register grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Set up files owned by different users
        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser2.address, "ipfs://file2"); // Owned by testUser2
        await dataRegistry.setFile(3, testUser1.address, "ipfs://file3");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n], // File 2 is not owned by testUser1
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

        await expect(
          dataPermission.connect(sponsor).addPermission(permission, signature),
        )
          .to.be.revertedWithCustomError(dataPermission, "NotFileOwner")
          .withArgs(testUser2.address, testUser1.address);
      });

      it("should handle empty fileIds array", async function () {
        // First register grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [], // Empty array
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

        const tx = await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        await expect(tx).to.emit(dataPermission, "PermissionAdded");

        // Verify no file associations
        const fileIds = await dataPermission.permissionFileIds(1);
        fileIds.should.deep.eq([]);
      });

      it("should handle duplicate fileIds in input", async function () {
        // First register grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 1n, 2n, 1n], // Duplicates
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

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
        // First register grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");

        // First permission
        const permission1 = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n],
        };

        const signature1 = await createPermissionSignature(
          permission1,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission1, signature1);

        // Second permission for same file
        const permission2 = {
          nonce: 1n,
          granteeId: 1n,
          grant: "ipfs://grant2",
          fileIds: [1n],
        };

        const signature2 = await createPermissionSignature(
          permission2,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission2, signature2);

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
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser1.address, "ipfs://file2");
        await dataRegistry.setFile(3, testUser1.address, "ipfs://file3");
        await dataRegistry.setFile(4, testUser1.address, "ipfs://file4");

        // First permission with files 1, 2, 3
        const permission1 = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n, 3n],
        };

        const signature1 = await createPermissionSignature(
          permission1,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission1, signature1);

        // Second permission with files 2, 3, 4
        const permission2 = {
          nonce: 1n,
          granteeId: 1n,
          grant: "ipfs://grant2",
          fileIds: [2n, 3n, 4n],
        };

        const signature2 = await createPermissionSignature(
          permission2,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission2, signature2);

        // Verify file mappings
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]); // Only permission 1
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n, 2n]); // Both permissions
        (await dataPermission.filePermissionIds(3)).should.deep.eq([1n, 2n]); // Both permissions
        (await dataPermission.filePermissionIds(4)).should.deep.eq([2n]); // Only permission 2
      });

      it("should clean up file associations when permission is revoked", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n],
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, signature);

        // Verify initial associations
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
        (await dataPermission.permissionFileIds(1)).should.deep.eq([1n, 2n]);

        // Revoke the permission
        await dataPermission.connect(testUser1).revokePermission(1);

        // Permission should still have fileIds stored
        const permissionData = await dataPermission.permissions(1);
        permissionData.grantor.should.eq(testUser1.address);

        // File associations should remain for historical tracking
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
        (await dataPermission.permissionFileIds(1)).should.deep.eq([1n, 2n]);
      });

      it("should handle large number of fileIds", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Set up 100 files owned by testUser1
        const fileCount = 100;
        for (let i = 1; i <= fileCount; i++) {
          await dataRegistry.setFile(i, testUser1.address, `ipfs://file${i}`);
        }

        const fileIds = [];
        for (let i = 1; i <= fileCount; i++) {
          fileIds.push(BigInt(i));
        }

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: fileIds,
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

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
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Only set up file 1
        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 999n], // File 999 doesn't exist
        };

        const signature = await createPermissionSignature(
          permission,
          testUser1,
        );

        await expect(
          dataPermission.connect(sponsor).addPermission(permission, signature),
        )
          .to.be.revertedWithCustomError(dataPermission, "NotFileOwner")
          .withArgs(ethers.ZeroAddress, testUser1.address);
      });

      it("should handle revocation with signature for permissions with fileIds", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        await dataRegistry.setFile(1, testUser1.address, "ipfs://file1");
        await dataRegistry.setFile(2, testUser1.address, "ipfs://file2");

        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [1n, 2n],
        };

        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Create revocation signature
        const revokeInput = {
          nonce: 1n,
          permissionId: 1n,
        };

        const revokeSignature = await createRevokePermissionSignature(
          revokeInput,
          testUser1,
        );

        const tx = await dataPermission
          .connect(sponsor)
          .revokePermissionWithSignature(revokeInput, revokeSignature);

        await expect(tx)
          .to.emit(dataPermission, "PermissionRevoked")
          .withArgs(1);

        // File associations remain for historical tracking
        (await dataPermission.filePermissionIds(1)).should.deep.eq([1n]);
        (await dataPermission.filePermissionIds(2)).should.deep.eq([1n]);
      });
    });

    describe("Integration Tests", () => {
      it("should handle full server lifecycle", async function () {
        const serverUrl = "https://lifecycle.example.com";

        // 1. First user adds and trusts the server
        const serverId = await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        // Verify server was created with ID 1
        serverId.should.eq(1);

        // 2. Second user trusts the same server
        await testServersContract.connect(testUser2).trustServer(1);

        // Verify both users trust the server
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsLength(testUser2.address)
        ).should.eq(1);

        // 3. User1 untrusts the server
        await testServersContract.connect(testUser1).untrustServer(1);

        // Verify testUser1 server is inactive but remains in list, testUser2 still active
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsLength(testUser2.address)
        ).should.eq(1);

        // 4. Server info should still be available
        const server = await testServersContract.serverByAddress(
          testServer1.address,
        );
        server.url.should.eq(serverUrl);
      });

      it("should handle permissions and servers together", async function () {
        // First register a grantee
        await granteesContract
          .connect(testUser1)
          .registerGrantee(testUser2.address, testUser2.address, "publicKey1");

        // Add a permission for testUser1
        const permission = {
          nonce: 0n,
          granteeId: 1n,
          grant: "ipfs://grant1",
          fileIds: [],
        };
        const permSignature = await createPermissionSignature(
          permission,
          testUser1,
        );
        await dataPermission
          .connect(sponsor)
          .addPermission(permission, permSignature);

        // Trust a server (this will create it)
        const serverUrl = "https://integrated.example.com";
        await addAndTrustServer(
          testUser1,
          testServer1.address,
          "0x1234567890abcdef",
          serverUrl,
        );

        // Verify user has both permissions and trusted servers
        (
          await dataPermission.userPermissionIdsLength(testUser1.address)
        ).should.eq(1);
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        // Nonce should have been incremented by permission (not by direct trust)
        (await dataPermission.userNonce(testUser1.address)).should.eq(1);
      });
    });
  });

  describe("DataPortabilityServers Contract", () => {
    let testServersContract: DataPortabilityServersImplementation;
    let owner: HardhatEthersSigner;
    let testUser1: HardhatEthersSigner;
    let testUser2: HardhatEthersSigner;
    let testServer1: HardhatEthersSigner;
    let testServer2: HardhatEthersSigner;

    beforeEach(async () => {
      await deploy();
      [owner, testUser1, testUser2, testServer1, testServer2] =
        await ethers.getSigners();

      // Use the already deployed and initialized servers contract from the main deployment
      testServersContract = await ethers.getContractAt(
        "DataPortabilityServersImplementation",
        await dataPermission.dataPortabilityServers(),
      );
    });

    // Helper function to create signature for trusting a server
    const createTrustServerSignature = async (
      trustServerInput: {
        nonce: bigint;
        serverId: bigint;
      },
      signer: HardhatEthersSigner,
    ) => {
      const domain = {
        name: "VanaDataPortabilityServers",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await testServersContract.getAddress(),
      };

      const types = {
        TrustServer: [
          { name: "nonce", type: "uint256" },
          { name: "serverId", type: "uint256" },
        ],
      };

      const value = {
        nonce: trustServerInput.nonce,
        serverId: trustServerInput.serverId,
      };

      return await signer.signTypedData(domain, types, value);
    };

    describe("Server Registration", () => {
      it("should register a new server", async () => {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );

        const tx = await testServersContract
          .connect(testUser1)
          .addServerWithSignature(
            {
              nonce: serverNonce,
              serverAddress: testServer1.address,
              publicKey: "0x1234567890abcdef",
              serverUrl: "https://testServer1.example.com",
            },
            serverSignature,
          );

        await expect(tx)
          .to.emit(testServersContract, "ServerRegistered")
          .withArgs(
            1,
            testUser1.address,
            testServer1.address,
            "0x1234567890abcdef",
            "https://testServer1.example.com",
          );

        // Verify server was registered
        const serverInfo = await testServersContract.servers(1);
        expect(serverInfo.owner).to.equal(testUser1.address);
        expect(serverInfo.serverAddress).to.equal(testServer1.address);
        expect(serverInfo.url).to.equal("https://testServer1.example.com");
        expect(serverInfo.publicKey).to.equal("0x1234567890abcdef");

        // Verify servers count
        expect(await testServersContract.serversCount()).to.equal(1);
      });

      it("should reject server registration with empty URL", async () => {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          "",
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: serverNonce,
              serverAddress: testServer1.address,
              publicKey: "0x1234567890abcdef",
              serverUrl: "",
            },
            serverSignature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
      });

      it("should reject server registration with empty public key", async () => {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "",
          "https://testServer1.example.com",
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: serverNonce,
              serverAddress: testServer1.address,
              publicKey: "",
              serverUrl: "https://testServer1.example.com",
            },
            serverSignature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyPublicKey");
      });

      it("should reject server registration with invalid nonce", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        // Use wrong nonce
        const signature = await createAddServerSignature(
          testUser1,
          nonce + 1n,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: nonce + 1n,
              serverAddress: testServer1.address,
              publicKey: "0x1234567890abcdef",
              serverUrl: "https://testServer1.example.com",
            },
            signature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "InvalidNonce");
      });

      it("should reject server registration with zero address server", async () => {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          ethers.ZeroAddress,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: serverNonce,
              serverAddress: ethers.ZeroAddress,
              publicKey: "0x1234567890abcdef",
              serverUrl: "https://testServer1.example.com",
            },
            serverSignature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "ZeroAddress");
      });

      it("should reject duplicate server registration", async () => {
        // First user registers server
        const nonce1 = await testServersContract.userNonce(testUser1.address);
        const signature1 = await createAddServerSignature(
          testUser1,
          nonce1,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: nonce1,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: "https://testServer1.example.com",
          },
          signature1,
        );

        // Second user tries to register same server address
        const nonce2 = await testServersContract.userNonce(testUser2.address);
        const signature2 = await createAddServerSignature(
          testUser2,
          nonce2,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );
        await expect(
          testServersContract.connect(testUser2).addServerWithSignature(
            {
              nonce: nonce2,
              serverAddress: testServer1.address,
              publicKey: "0x1234567890abcdef",
              serverUrl: "https://testServer1.example.com",
            },
            signature2,
          ),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerAlreadyRegistered",
        );
      });
    });

    describe("Server Updates", () => {
      beforeEach(async () => {
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          testServer1.address,
          "0x1234567890abcdef",
          "https://testServer1.example.com",
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: testServer1.address,
            publicKey: "0x1234567890abcdef",
            serverUrl: "https://testServer1.example.com",
          },
          serverSignature,
        );
      });

      it("should update server URL by owner", async () => {
        const newUrl = "https://updated.example.com";

        const tx = await testServersContract
          .connect(testUser1)
          .updateServer(1, newUrl);

        await expect(tx)
          .to.emit(testServersContract, "ServerUpdated")
          .withArgs(1, newUrl);

        const serverInfo = await testServersContract.servers(1);
        expect(serverInfo.url).to.equal(newUrl);
      });

      it("should reject update by non-owner", async () => {
        const newUrl = "https://updated.example.com";

        await expect(
          testServersContract.connect(testUser2).updateServer(1, newUrl),
        ).to.be.revertedWithCustomError(testServersContract, "NotServerOwner");
      });

      it("should reject update with empty URL", async () => {
        await expect(
          testServersContract.connect(testUser1).updateServer(1, ""),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
      });

      it("should reject update for non-existent server", async () => {
        await expect(
          testServersContract
            .connect(testUser1)
            .updateServer(999, "https://test.com"),
        ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
      });
    });

    describe("Server Trust Management", () => {
      beforeEach(async () => {
        const serverInput = {
          owner: testUser1.address,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          serverInput.serverAddress,
          serverInput.publicKey,
          serverInput.serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: serverInput.serverAddress,
            publicKey: serverInput.publicKey,
            serverUrl: serverInput.serverUrl,
          },
          serverSignature,
        );
      });

      it("should trust a server", async () => {
        const tx = await testServersContract.connect(testUser1).trustServer(1);

        await expect(tx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, 1);

        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers).to.include(1n);
      });

      it("should reject trusting non-existent server", async () => {
        await expect(
          testServersContract.connect(testUser1).trustServer(999),
        ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
      });

      it("should allow trusting already trusted server (idempotent)", async () => {
        await testServersContract.connect(testUser1).trustServer(1);

        // Trust again - should succeed (idempotent)
        await testServersContract.connect(testUser1).trustServer(1);

        // Should still have only one trusted server
        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
      });

      it("should untrust a server", async () => {
        await testServersContract.connect(testUser1).trustServer(1);

        const tx = await testServersContract
          .connect(testUser1)
          .untrustServer(1);

        await expect(tx)
          .to.emit(testServersContract, "ServerUntrusted")
          .withArgs(testUser1.address, 1);

        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers.length).to.equal(1);
      });

      it("should reject untrusting non-trusted server", async () => {
        await expect(
          testServersContract.connect(testUser1).untrustServer(1),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerNotTrusted",
        );
      });

      it("should reject untrusting already untrusted server", async () => {
        await testServersContract.connect(testUser1).trustServer(1);
        await testServersContract.connect(testUser1).untrustServer(1);

        await expect(
          testServersContract.connect(testUser1).untrustServer(1),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerAlreadyUntrusted",
        );
      });
    });

    describe("Add and Trust Server", () => {
      it("should add and trust server in one transaction", async () => {
        const serverInput = {
          owner: testUser1.address,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const serverId = await addAndTrustServer(
          testUser1,
          serverInput.serverAddress,
          serverInput.publicKey,
          serverInput.serverUrl,
        );

        // Verify server was created and trusted
        serverId.should.eq(1);
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers).to.include(1n);
      });

      it("should add and trust server with signature in one transaction", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addServerInput = {
          nonce: nonce,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          addServerInput.serverAddress,
          addServerInput.publicKey,
          addServerInput.serverUrl,
        );

        const tx = await testServersContract
          .connect(testUser1)
          .addAndTrustServerWithSignature(addServerInput, signature);

        // Check that both ServerRegistered and ServerTrusted events were emitted
        await expect(tx)
          .to.emit(testServersContract, "ServerRegistered")
          .withArgs(
            1,
            testUser1.address,
            testServer1.address,
            "0x1234567890abcdef",
            "https://testServer1.example.com",
          );

        await expect(tx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, 1);

        // Verify server was created and trusted
        const serverInfo = await testServersContract.servers(1);
        serverInfo.owner.should.eq(testUser1.address);
        serverInfo.serverAddress.should.eq(testServer1.address);
        serverInfo.publicKey.should.eq("0x1234567890abcdef");
        serverInfo.url.should.eq("https://testServer1.example.com");

        // Verify server is trusted by user
        (
          await testServersContract.userServerIdsLength(testUser1.address)
        ).should.eq(1);

        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers).to.include(1n);

        // Verify nonce was incremented
        (await testServersContract.userNonce(testUser1.address)).should.eq(1);
      });

      it("should reject addAndTrustServerWithSignature with invalid nonce", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addServerInput = {
          nonce: nonce + 1n, // Wrong nonce
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const signature = await createAddServerSignature(
          testUser1,
          nonce + 1n,
          addServerInput.serverAddress,
          addServerInput.publicKey,
          addServerInput.serverUrl,
        );

        await expect(
          testServersContract
            .connect(testUser1)
            .addAndTrustServerWithSignature(addServerInput, signature),
        )
          .to.be.revertedWithCustomError(testServersContract, "InvalidNonce")
          .withArgs(nonce, nonce + 1n);
      });

      it("should reject addAndTrustServerWithSignature with empty public key", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addServerInput = {
          nonce: nonce,
          serverAddress: testServer1.address,
          publicKey: "", // Empty public key
          serverUrl: "https://testServer1.example.com",
        };

        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          addServerInput.serverAddress,
          addServerInput.publicKey,
          addServerInput.serverUrl,
        );

        await expect(
          testServersContract
            .connect(testUser1)
            .addAndTrustServerWithSignature(addServerInput, signature),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyPublicKey");
      });

      it("should reject addAndTrustServerWithSignature with empty URL", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addServerInput = {
          nonce: nonce,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "", // Empty URL
        };

        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          addServerInput.serverAddress,
          addServerInput.publicKey,
          addServerInput.serverUrl,
        );

        await expect(
          testServersContract
            .connect(testUser1)
            .addAndTrustServerWithSignature(addServerInput, signature),
        ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
      });

      it("should reject addAndTrustServerWithSignature for duplicate server", async () => {
        // First add a server
        const nonce1 = await testServersContract.userNonce(testUser1.address);
        const addServerInput1 = {
          nonce: nonce1,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const signature1 = await createAddServerSignature(
          testUser1,
          nonce1,
          addServerInput1.serverAddress,
          addServerInput1.publicKey,
          addServerInput1.serverUrl,
        );

        await testServersContract
          .connect(testUser1)
          .addAndTrustServerWithSignature(addServerInput1, signature1);

        // Try to add the same server again
        const nonce2 = await testServersContract.userNonce(testUser2.address);
        const addServerInput2 = {
          nonce: nonce2,
          serverAddress: testServer1.address, // Same server address
          publicKey: "0xabcdef1234567890",
          serverUrl: "https://different.example.com",
        };

        const signature2 = await createAddServerSignature(
          testUser2,
          nonce2,
          addServerInput2.serverAddress,
          addServerInput2.publicKey,
          addServerInput2.serverUrl,
        );

        await expect(
          testServersContract
            .connect(testUser2)
            .addAndTrustServerWithSignature(addServerInput2, signature2),
        ).to.be.revertedWithCustomError(
          testServersContract,
          "ServerAlreadyRegistered",
        );
      });

      it("should work when called by sponsor but signed by user", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const addServerInput = {
          nonce: nonce,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          addServerInput.serverAddress,
          addServerInput.publicKey,
          addServerInput.serverUrl,
        );

        const tx = await testServersContract
          .connect(sponsor) // Called by sponsor
          .addAndTrustServerWithSignature(addServerInput, signature);

        // Verify server was created with testUser1 as owner (not sponsor)
        const serverInfo = await testServersContract.servers(1);
        serverInfo.owner.should.eq(testUser1.address);

        // Verify server is trusted by testUser1 (not sponsor)
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers).to.include(1n);

        const sponsorServers = await testServersContract.userServerIdsValues(
          sponsor.address,
        );
        expect(sponsorServers).to.not.include(1n);
      });
    });

    describe("Signature-based Operations", () => {
      beforeEach(async () => {
        const serverInput = {
          owner: testUser1.address,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };
        const serverNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature = await createAddServerSignature(
          testUser1,
          serverNonce,
          serverInput.serverAddress,
          serverInput.publicKey,
          serverInput.serverUrl,
        );
        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce,
            serverAddress: serverInput.serverAddress,
            publicKey: serverInput.publicKey,
            serverUrl: serverInput.serverUrl,
          },
          serverSignature,
        );
      });

      it("should trust server with valid signature", async () => {
        const nonce = await testServersContract.userNonce(testUser1.address);
        const trustInput = {
          nonce: nonce,
          serverId: 1n,
        };

        const domain = {
          name: "VanaDataPortabilityServers",
          version: "1",
          chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
          verifyingContract: await testServersContract.getAddress(),
        };

        const types = {
          TrustServer: [
            { name: "nonce", type: "uint256" },
            { name: "serverId", type: "uint256" },
          ],
        };

        const signature = await testUser1.signTypedData(
          domain,
          types,
          trustInput,
        );

        const tx = await testServersContract
          .connect(testUser2)
          .trustServerWithSignature(trustInput, signature);

        await expect(tx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, 1);

        expect(await testServersContract.userNonce(testUser1.address)).to.equal(
          nonce + 1n,
        );
        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
      });

      it("should reject trust with invalid nonce", async () => {
        const currentNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const trustInput = {
          nonce: currentNonce + 1n, // Wrong nonce (should be currentNonce)
          serverId: 1n,
        };

        const domain = {
          name: "VanaDataPortabilityServers",
          version: "1",
          chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
          verifyingContract: await testServersContract.getAddress(),
        };

        const types = {
          TrustServer: [
            { name: "nonce", type: "uint256" },
            { name: "serverId", type: "uint256" },
          ],
        };

        const signature = await testUser1.signTypedData(
          domain,
          types,
          trustInput,
        );

        await expect(
          testServersContract
            .connect(testUser2)
            .trustServerWithSignature(trustInput, signature),
        ).to.be.revertedWithCustomError(testServersContract, "InvalidNonce");
      });

      it("should add and trust server with signature", async () => {
        // First, add the server with signature
        const addServerNonce = await testServersContract.userNonce(
          testUser1.address,
        );
        const addServerInput = {
          nonce: addServerNonce,
          serverAddress: testServer2.address,
          publicKey: "0xabcdef1234567890",
          serverUrl: "https://testServer2.example.com",
        };

        const addServerSignature = await createAddServerSignature(
          testUser1,
          addServerNonce,
          testServer2.address,
          "0xabcdef1234567890",
          "https://testServer2.example.com",
        );

        const addTx = await testServersContract
          .connect(testUser2)
          .addServerWithSignature(addServerInput, addServerSignature);

        await expect(addTx)
          .to.emit(testServersContract, "ServerRegistered")
          .withArgs(
            2,
            testUser1.address,
            testServer2.address,
            "0xabcdef1234567890",
            "https://testServer2.example.com",
          );

        // Get the server ID
        const serverId = await testServersContract.serverAddressToId(
          testServer2.address,
        );

        // Then trust the server with signature
        const trustServerInput = {
          nonce: await testServersContract.userNonce(testUser1.address),
          serverId: serverId,
        };

        const trustServerSignature = await createTrustServerSignature(
          trustServerInput,
          testUser1,
        );

        const trustTx = await testServersContract
          .connect(testUser2)
          .trustServerWithSignature(trustServerInput, trustServerSignature);

        await expect(trustTx)
          .to.emit(testServersContract, "ServerTrusted")
          .withArgs(testUser1.address, serverId);

        // Nonce should be incremented by 2 (once for add, once for trust)
        expect(await testServersContract.userNonce(testUser1.address)).to.equal(
          addServerNonce + 2n,
        );
        expect(
          await testServersContract.userServerIdsLength(testUser1.address),
        ).to.equal(1);
      });
    });

    describe("View Functions", () => {
      beforeEach(async () => {
        const serverInput1 = {
          owner: testUser1.address,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const serverInput2 = {
          owner: testUser2.address,
          serverAddress: testServer2.address,
          publicKey: "0xabcdef1234567890",
          serverUrl: "https://testServer2.example.com",
        };

        const serverNonce1 = await testServersContract.userNonce(
          testUser1.address,
        );
        const serverSignature1 = await createAddServerSignature(
          testUser1,
          serverNonce1,
          serverInput1.serverAddress,
          serverInput1.publicKey,
          serverInput1.serverUrl,
        );

        await testServersContract.connect(testUser1).addServerWithSignature(
          {
            nonce: serverNonce1,
            serverAddress: serverInput1.serverAddress,
            publicKey: serverInput1.publicKey,
            serverUrl: serverInput1.serverUrl,
          },
          serverSignature1,
        );
        const serverNonce2 = await testServersContract.userNonce(
          testUser2.address,
        );
        const serverSignature2 = await createAddServerSignature(
          testUser2,
          serverNonce2,
          serverInput2.serverAddress,
          serverInput2.publicKey,
          serverInput2.serverUrl,
        );
        await testServersContract.connect(testUser2).addServerWithSignature(
          {
            nonce: serverNonce2,
            serverAddress: serverInput2.serverAddress,
            publicKey: serverInput2.publicKey,
            serverUrl: serverInput2.serverUrl,
          },
          serverSignature2,
        );
        await testServersContract.connect(testUser1).trustServer(1);
        await testServersContract.connect(testUser1).trustServer(2);
      });

      it("should return correct server info", async () => {
        const serverInfo = await testServersContract.servers(1);
        expect(serverInfo.id).to.equal(1);
        expect(serverInfo.owner).to.equal(testUser1.address);
        expect(serverInfo.serverAddress).to.equal(testServer1.address);
        expect(serverInfo.url).to.equal("https://testServer1.example.com");
        expect(serverInfo.publicKey).to.equal("0x1234567890abcdef");
      });

      it("should return server info by address", async () => {
        const serverInfo = await testServersContract.serverByAddress(
          testServer1.address,
        );
        expect(serverInfo.id).to.equal(1);
        expect(serverInfo.owner).to.equal(testUser1.address);
        expect(serverInfo.serverAddress).to.equal(testServer1.address);
        expect(serverInfo.url).to.equal("https://testServer1.example.com");
      });

      it("should return user server IDs", async () => {
        const serverIds = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(serverIds).to.deep.equal([1n, 2n]);
      });

      it("should return user server ID at index", async () => {
        const serverId = await testServersContract.userServerIdsAt(
          testUser1.address,
          0,
        );
        expect(serverId).to.equal(1);
      });

      it("should return user server IDs length", async () => {
        const length = await testServersContract.userServerIdsLength(
          testUser1.address,
        );
        expect(length).to.equal(2);
      });

      it("should return user info", async () => {
        const [nonce, trustedServerIds] = await testServersContract.users(
          testUser1.address,
        );
        expect(nonce).to.equal(1); // testUser1 added one server with signature
        expect(trustedServerIds).to.deep.equal([1n, 2n]);
      });

      it("should return servers count", async () => {
        const count = await testServersContract.serversCount();
        expect(count).to.equal(2);
      });

      it("should return server address to ID mapping", async () => {
        const serverId = await testServersContract.serverAddressToId(
          testServer1.address,
        );
        expect(serverId).to.equal(1);
      });

      it("should verify server trust relationships", async () => {
        const userServers = await testServersContract.userServerIdsValues(
          testUser1.address,
        );
        expect(userServers).to.include(1n);
        const user2Servers = await testServersContract.userServerIdsValues(
          testUser2.address,
        );
        expect(user2Servers).to.not.include(1n);
      });
    });

    describe("Admin Functions", () => {
      it("should update trusted forwarder", async () => {
        const newForwarder = testUser2.address;
        const [, , deployOwner] = await ethers.getSigners();
        await testServersContract
          .connect(deployOwner)
          .updateTrustedForwarder(newForwarder);
        expect(await testServersContract.trustedForwarder()).to.equal(
          newForwarder,
        );
      });

      it("should pause and unpause", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await testServersContract.connect(deployOwner).pause();

        const serverInput = {
          owner: testUser1.address,
          serverAddress: testServer1.address,
          publicKey: "0x1234567890abcdef",
          serverUrl: "https://testServer1.example.com",
        };

        const nonce = await testServersContract.userNonce(testUser1.address);
        const signature = await createAddServerSignature(
          testUser1,
          nonce,
          serverInput.serverAddress,
          serverInput.publicKey,
          serverInput.serverUrl,
        );

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: nonce,
              serverAddress: serverInput.serverAddress,
              publicKey: serverInput.publicKey,
              serverUrl: serverInput.serverUrl,
            },
            signature,
          ),
        ).to.be.revertedWithCustomError(testServersContract, "EnforcedPause");

        await testServersContract.connect(deployOwner).unpause();

        await expect(
          testServersContract.connect(testUser1).addServerWithSignature(
            {
              nonce: nonce,
              serverAddress: serverInput.serverAddress,
              publicKey: serverInput.publicKey,
              serverUrl: serverInput.serverUrl,
            },
            signature,
          ),
        ).to.not.be.reverted;
      });

      it("should set user nonce", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await testServersContract
          .connect(deployOwner)
          .setUserNonce(testUser1.address, 5);
        expect(await testServersContract.userNonce(testUser1.address)).to.equal(
          5,
        );
      });
    });
  });

  describe("DataPortabilityGrantees Contract", () => {
    let granteesContract: DataPortabilityGranteesImplementation;
    let owner: HardhatEthersSigner;
    let testUser1: HardhatEthersSigner;
    let testUser2: HardhatEthersSigner;
    let grantee1: HardhatEthersSigner;
    let grantee2: HardhatEthersSigner;

    beforeEach(async () => {
      await deploy();
      [owner, testUser1, testUser2, grantee1, grantee2] =
        await ethers.getSigners();

      // Use the already deployed and initialized grantees contract from the main deployment
      granteesContract = await ethers.getContractAt(
        "DataPortabilityGranteesImplementation",
        await dataPermission.dataPortabilityGrantees(),
      );
    });

    describe("Grantee Registration", () => {
      it("should register a new grantee", async () => {
        const tx = await granteesContract
          .connect(testUser1)
          .registerGrantee(grantee1.address, grantee1.address, "publicKey1");

        await expect(tx)
          .to.emit(granteesContract, "GranteeRegistered")
          .withArgs(1, grantee1.address, grantee1.address, "publicKey1");

        // Verify grantee was registered
        const granteeInfo = await granteesContract.grantees(1);
        expect(granteeInfo.owner).to.equal(grantee1.address);
        expect(granteeInfo.granteeAddress).to.equal(grantee1.address);
        expect(granteeInfo.publicKey).to.equal("publicKey1");
        expect(granteeInfo.permissionIds).to.deep.equal([]);

        // Verify grantees count
        expect(await granteesContract.granteesCount()).to.equal(1);
      });

      it("should reject grantee registration with empty public key", async () => {
        await expect(
          granteesContract
            .connect(testUser1)
            .registerGrantee(grantee1.address, grantee1.address, ""),
        ).to.be.revertedWithCustomError(granteesContract, "EmptyPublicKey");
      });

      it("should reject grantee registration with zero address grantee", async () => {
        await expect(
          granteesContract
            .connect(testUser1)
            .registerGrantee(
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              "publicKey1",
            ),
        ).to.be.revertedWithCustomError(granteesContract, "ZeroAddress");
      });

      it("should reject grantee registration with zero address owner", async () => {
        await expect(
          granteesContract
            .connect(testUser1)
            .registerGrantee(
              ethers.ZeroAddress,
              ethers.ZeroAddress,
              "publicKey1",
            ),
        ).to.be.revertedWithCustomError(granteesContract, "ZeroAddress");
      });

      it("should reject duplicate grantee registration", async () => {
        await granteesContract
          .connect(testUser1)
          .registerGrantee(grantee1.address, grantee1.address, "publicKey1");

        await expect(
          granteesContract
            .connect(testUser2)
            .registerGrantee(grantee1.address, grantee1.address, "publicKey2"),
        ).to.be.revertedWithCustomError(
          granteesContract,
          "GranteeAlreadyRegistered",
        );
      });

      it("should register multiple grantees", async () => {
        await granteesContract
          .connect(testUser1)
          .registerGrantee(grantee1.address, grantee1.address, "publicKey1");

        await granteesContract
          .connect(testUser2)
          .registerGrantee(grantee2.address, grantee2.address, "publicKey2");

        expect(await granteesContract.granteesCount()).to.equal(2);

        const grantee1Info = await granteesContract.grantees(1);
        expect(grantee1Info.owner).to.equal(grantee1.address);
        expect(grantee1Info.granteeAddress).to.equal(grantee1.address);

        const grantee2Info = await granteesContract.grantees(2);
        expect(grantee2Info.owner).to.equal(grantee2.address);
        expect(grantee2Info.granteeAddress).to.equal(grantee2.address);
      });
    });

    describe("View Functions", () => {
      beforeEach(async () => {
        await granteesContract
          .connect(testUser1)
          .registerGrantee(grantee1.address, grantee1.address, "publicKey1");
        await granteesContract
          .connect(testUser2)
          .registerGrantee(grantee2.address, grantee2.address, "publicKey2");
      });

      it("should return grantee info", async () => {
        const granteeInfo = await granteesContract.grantees(1);
        expect(granteeInfo.owner).to.equal(grantee1.address);
        expect(granteeInfo.granteeAddress).to.equal(grantee1.address);
        expect(granteeInfo.publicKey).to.equal("publicKey1");
        expect(granteeInfo.permissionIds).to.deep.equal([]);
      });

      it("should return grantee info by granteeInfo method", async () => {
        const granteeInfo = await granteesContract.granteeInfo(1);
        expect(granteeInfo.owner).to.equal(grantee1.address);
        expect(granteeInfo.granteeAddress).to.equal(grantee1.address);
        expect(granteeInfo.publicKey).to.equal("publicKey1");
      });

      it("should return grantee by address", async () => {
        const granteeInfo = await granteesContract.granteeByAddress(
          grantee1.address,
        );
        expect(granteeInfo.owner).to.equal(grantee1.address);
        expect(granteeInfo.granteeAddress).to.equal(grantee1.address);
        expect(granteeInfo.publicKey).to.equal("publicKey1");
      });

      it("should return grantees count", async () => {
        const count = await granteesContract.granteesCount();
        expect(count).to.equal(2);
      });

      it("should return grantee address to ID mapping", async () => {
        const granteeId = await granteesContract.granteeAddressToId(
          grantee1.address,
        );
        expect(granteeId).to.equal(1);
      });

      it("should return grantee permission IDs", async () => {
        const permissionIds = await granteesContract.granteePermissionIds(1);
        expect(permissionIds).to.deep.equal([]);
      });

      it("should return grantee permissions", async () => {
        const permissions = await granteesContract.granteePermissions(1);
        expect(permissions).to.deep.equal([]);
      });
    });

    describe("Permission Management", () => {
      beforeEach(async () => {
        await granteesContract
          .connect(testUser1)
          .registerGrantee(grantee1.address, grantee1.address, "publicKey1");

        // Grant permission manager role to deployOwner for testing
        const PERMISSION_MANAGER_ROLE =
          await granteesContract.PERMISSION_MANAGER_ROLE();
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract
          .connect(deployOwner)
          .grantRole(PERMISSION_MANAGER_ROLE, deployOwner.address);
      });

      it("should add permission to grantee", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract
          .connect(deployOwner)
          .addPermissionToGrantee(1, 100);

        const permissionIds = await granteesContract.granteePermissionIds(1);
        expect(permissionIds).to.deep.equal([100n]);
      });

      it("should remove permission from grantee", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract
          .connect(deployOwner)
          .addPermissionToGrantee(1, 100);
        await granteesContract
          .connect(deployOwner)
          .removePermissionFromGrantee(1, 100);

        const permissionIds = await granteesContract.granteePermissionIds(1);
        expect(permissionIds).to.deep.equal([]);
      });

      it("should reject permission management for non-existent grantee", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await expect(
          granteesContract
            .connect(deployOwner)
            .addPermissionToGrantee(999, 100),
        ).to.be.revertedWithCustomError(granteesContract, "GranteeNotFound");
      });

      it("should reject permission management by non-manager", async () => {
        await expect(
          granteesContract.connect(testUser1).addPermissionToGrantee(1, 100),
        ).to.be.reverted;
      });

      it("should handle multiple permissions", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract
          .connect(deployOwner)
          .addPermissionToGrantee(1, 100);
        await granteesContract
          .connect(deployOwner)
          .addPermissionToGrantee(1, 200);
        await granteesContract
          .connect(deployOwner)
          .addPermissionToGrantee(1, 300);

        const permissionIds = await granteesContract.granteePermissionIds(1);
        expect(permissionIds).to.deep.equal([100n, 200n, 300n]);
      });
    });

    describe("Admin Functions", () => {
      it("should update trusted forwarder", async () => {
        const newForwarder = testUser2.address;
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract
          .connect(deployOwner)
          .updateTrustedForwarder(newForwarder);
        expect(await granteesContract.trustedForwarder()).to.equal(
          newForwarder,
        );
      });

      it("should pause and unpause", async () => {
        const [, , deployOwner] = await ethers.getSigners();
        await granteesContract.connect(deployOwner).pause();

        await expect(
          granteesContract
            .connect(testUser1)
            .registerGrantee(testUser1.address, grantee1.address, "publicKey1"),
        ).to.be.revertedWithCustomError(granteesContract, "EnforcedPause");

        await granteesContract.connect(deployOwner).unpause();

        await expect(
          granteesContract
            .connect(grantee1)
            .registerGrantee(grantee1.address, grantee1.address, "publicKey1"),
        ).to.not.be.reverted;
      });

      it("should manage roles", async () => {
        const PERMISSION_MANAGER_ROLE =
          await granteesContract.PERMISSION_MANAGER_ROLE();
        const [, , deployOwner] = await ethers.getSigners();

        await granteesContract
          .connect(deployOwner)
          .grantRole(PERMISSION_MANAGER_ROLE, testUser1.address);
        expect(
          await granteesContract.hasRole(
            PERMISSION_MANAGER_ROLE,
            testUser1.address,
          ),
        ).to.be.true;

        await granteesContract
          .connect(deployOwner)
          .revokeRole(PERMISSION_MANAGER_ROLE, testUser1.address);
        expect(
          await granteesContract.hasRole(
            PERMISSION_MANAGER_ROLE,
            testUser1.address,
          ),
        ).to.be.false;
      });
    });
  });

  describe("addAndTrustServerByManager", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should add and trust server by manager", async function () {
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      // Call addAndTrustServerByManager from an account with PERMISSION_MANAGER_ROLE
      // Grant role to maintainer for testing
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      const tx = await testServersContract
        .connect(maintainer)
        .addAndTrustServerByManager(testUser1.address, serverInput);

      // Verify server was added
      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );
      expect(serverId).to.be.greaterThan(0);

      // Verify server details
      const serverInfo = await testServersContract.servers(serverId);
      expect(serverInfo.owner).to.equal(testUser1.address);
      expect(serverInfo.serverAddress).to.equal(testServer1.address);
      expect(serverInfo.publicKey).to.equal("publicKey1");
      expect(serverInfo.url).to.equal("https://server1.example.com");

      // Verify server is trusted by the user
      const userServers = await testServersContract.userServerIdsValues(
        testUser1.address,
      );
      expect(userServers).to.include(BigInt(serverId));

      // Verify server count increased
      expect(await testServersContract.serversCount()).to.equal(1);

      // Verify events were emitted
      await expect(tx).to.emit(testServersContract, "ServerRegistered");
      await expect(tx).to.emit(testServersContract, "ServerTrusted");
    });

    it("should reject call from non-PERMISSION_MANAGER_ROLE", async function () {
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );

      // Should reject when called by testUser1 (who doesn't have PERMISSION_MANAGER_ROLE)
      await expect(
        testServersContract
          .connect(testUser1)
          .addAndTrustServerByManager(testUser1.address, serverInput),
      )
        .to.be.revertedWithCustomError(
          testServersContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(testUser1.address, PERMISSION_MANAGER_ROLE);
    });

    it("should reject with zero server address", async function () {
      const serverInput = {
        serverAddress: ethers.ZeroAddress,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      // Grant role to maintainer for testing
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      await expect(
        testServersContract
          .connect(maintainer)
          .addAndTrustServerByManager(testUser1.address, serverInput),
      ).to.be.revertedWithCustomError(testServersContract, "ZeroAddress");
    });

    it("should reject with empty public key", async function () {
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "",
        serverUrl: "https://server1.example.com",
      };

      // Grant role to maintainer for testing
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      await expect(
        testServersContract
          .connect(maintainer)
          .addAndTrustServerByManager(testUser1.address, serverInput),
      ).to.be.revertedWithCustomError(testServersContract, "EmptyPublicKey");
    });

    it("should reject with empty server URL", async function () {
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "",
      };

      // Grant role to maintainer for testing
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      await expect(
        testServersContract
          .connect(maintainer)
          .addAndTrustServerByManager(testUser1.address, serverInput),
      ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
    });

    it("should reject duplicate server address", async function () {
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      // Grant role to maintainer for testing
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      // Add server first time
      await testServersContract
        .connect(maintainer)
        .addAndTrustServerByManager(testUser1.address, serverInput);

      // Try to add same server address again
      await expect(
        testServersContract
          .connect(maintainer)
          .addAndTrustServerByManager(testUser2.address, serverInput),
      ).to.be.revertedWithCustomError(
        testServersContract,
        "ServerAlreadyRegistered",
      );
    });
  });

  describe("trustServerByManager", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should trust an existing server by manager", async function () {
      // First, add a server without trusting it
      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      // Add server as testUser1
      const addServerInput = {
        nonce: 0n,
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      const signature = await createAddServerSignature(
        testUser1,
        addServerInput.nonce,
        addServerInput.serverAddress,
        addServerInput.publicKey,
        addServerInput.serverUrl,
      );

      await testServersContract
        .connect(testUser1)
        .addServerWithSignature(addServerInput, signature);

      // Verify server was added
      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );
      expect(serverId).to.be.greaterThan(0);

      // Verify server is not trusted by testUser2
      let userServers = await testServersContract.userServerIdsValues(
        testUser2.address,
      );
      expect(userServers).to.not.include(BigInt(serverId));

      // Grant PERMISSION_MANAGER_ROLE to maintainer
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      // Trust server for testUser2 using manager role
      const tx = await testServersContract
        .connect(maintainer)
        .trustServerByManager(testUser2.address, serverId);

      // Verify server is now trusted by testUser2
      userServers = await testServersContract.userServerIdsValues(
        testUser2.address,
      );
      expect(userServers).to.include(BigInt(serverId));

      // Verify event was emitted
      await expect(tx)
        .to.emit(testServersContract, "ServerTrusted")
        .withArgs(testUser2.address, serverId);

      // Verify trust details
      const trustedServer = await testServersContract.userServers(
        testUser2.address,
        serverId,
      );
      expect(trustedServer.id).to.equal(serverId);
      expect(trustedServer.startBlock).to.be.greaterThan(0);
      expect(trustedServer.endBlock).to.equal(ethers.MaxUint256);
    });

    it("should reject call from non-PERMISSION_MANAGER_ROLE", async function () {
      // First, add a server
      const addServerInput = {
        nonce: 0n,
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      const signature = await createAddServerSignature(
        testUser1,
        addServerInput.nonce,
        addServerInput.serverAddress,
        addServerInput.publicKey,
        addServerInput.serverUrl,
      );

      await testServersContract
        .connect(testUser1)
        .addServerWithSignature(addServerInput, signature);

      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );

      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );

      // Should reject when called by testUser1 (who doesn't have PERMISSION_MANAGER_ROLE)
      await expect(
        testServersContract
          .connect(testUser1)
          .trustServerByManager(testUser2.address, serverId),
      )
        .to.be.revertedWithCustomError(
          testServersContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(testUser1.address, PERMISSION_MANAGER_ROLE);
    });

    it("should reject with invalid server ID", async function () {
      // Grant PERMISSION_MANAGER_ROLE to maintainer
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      // Try to trust a non-existent server
      await expect(
        testServersContract
          .connect(maintainer)
          .trustServerByManager(testUser1.address, 999),
      ).to.be.revertedWithCustomError(testServersContract, "ServerNotFound");
    });

    it("should allow re-trusting an untrusted server", async function () {
      // First, add and trust a server for testUser1
      const PERMISSION_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
      );
      await testServersContract
        .connect(owner)
        .grantRole(PERMISSION_MANAGER_ROLE, maintainer.address);

      const serverInput = {
        serverAddress: testServer1.address,
        publicKey: "publicKey1",
        serverUrl: "https://server1.example.com",
      };

      await testServersContract
        .connect(maintainer)
        .addAndTrustServerByManager(testUser1.address, serverInput);

      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );

      // Untrust the server as testUser1
      await testServersContract.connect(testUser1).untrustServer(serverId);

      // Verify server is untrusted (endBlock should be current block)
      let trustedServer = await testServersContract.userServers(
        testUser1.address,
        serverId,
      );
      expect(trustedServer.endBlock).to.be.lessThan(ethers.MaxUint256);

      // Re-trust the server using manager role
      const tx = await testServersContract
        .connect(maintainer)
        .trustServerByManager(testUser1.address, serverId);

      // Verify server is trusted again
      trustedServer = await testServersContract.userServers(
        testUser1.address,
        serverId,
      );
      expect(trustedServer.startBlock).to.be.greaterThan(0);
      expect(trustedServer.endBlock).to.equal(ethers.MaxUint256);

      // Verify event was emitted
      await expect(tx)
        .to.emit(testServersContract, "ServerTrusted")
        .withArgs(testUser1.address, serverId);
    });
  });

  describe("addServerFilesAndPermissions", () => {
    beforeEach(async () => {
      await deploy();
      // Register a grantee for testing
      await granteesContract
        .connect(testUser1)
        .registerGrantee(testUser2.address, testUser2.address, "publicKey1");
    });

    it("should add server, files, and permissions in one transaction", async function () {
      const serverFilesAndPermissionInput: ServerFilesAndPermissionData = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com", "https://file2.example.com"],
        schemaIds: [1n, 1n], // Schema IDs for each file
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[], []], // No DataRegistry permissions for each file
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target,
        testUser1,
      );

      const recoveredSigner = await recoverServerFilesAndPermissionSigner(
        serverFilesAndPermissionInput,
        dataPermission.target,
        signature,
      );

      const tx = await dataPermission
        .connect(deployer)
        .addServerFilesAndPermissions(serverFilesAndPermissionInput, signature);

      // Verify server was added and trusted
      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );
      expect(serverId).to.be.greaterThan(0);
      const userServers = await testServersContract.userServerIdsValues(
        testUser1.address,
      );
      expect(userServers).to.include(BigInt(serverId));

      // Verify files were added
      const file1Id = await dataRegistry.fileIdByUrl(
        "https://file1.example.com",
      );
      const file2Id = await dataRegistry.fileIdByUrl(
        "https://file2.example.com",
      );
      expect(file1Id).to.be.greaterThan(0);
      expect(file2Id).to.be.greaterThan(0);

      // Verify files are owned by the signer
      const file1Info = await dataRegistry.files(file1Id);
      const file2Info = await dataRegistry.files(file2Id);
      expect(file1Info.ownerAddress).to.equal(testUser1.address);
      expect(file2Info.ownerAddress).to.equal(testUser1.address);

      // Verify permission was created
      expect(await dataPermission.permissionsCount()).to.equal(1);
      const permission = await dataPermission.permissions(1);
      expect(permission.grantor).to.equal(testUser1.address);
      expect(permission.granteeId).to.equal(1n);
      expect(permission.grant).to.equal("ipfs://grant1");

      // Verify permission includes both files
      const permissionFileIds = await dataPermission.permissionFileIds(1);
      expect(permissionFileIds).to.include(file1Id);
      expect(permissionFileIds).to.include(file2Id);

      // Verify nonce was incremented
      expect(await dataPermission.userNonce(testUser1.address)).to.equal(1);

      // Verify events were emitted
      await expect(tx).to.emit(testServersContract, "ServerRegistered");
      await expect(tx).to.emit(testServersContract, "ServerTrusted");
      await expect(tx).to.emit(dataPermission, "PermissionAdded");
    });

    it("should handle existing files correctly", async function () {
      // Pre-add one file
      await dataRegistry
        .connect(testUser1)
        .addFile("https://existing-file.example.com");
      const existingFileId = await dataRegistry.fileIdByUrl(
        "https://existing-file.example.com",
      );

      console.log(testUser1.address);
      console.log(await dataRegistry.files(existingFileId));

      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: [
          "https://existing-file.example.com",
          "https://new-file.example.com",
        ],
        schemaIds: [1n, 1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[], []], // No DataRegistry permissions for each file
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await dataPermission
        .connect(testUser1)
        .addServerFilesAndPermissions(serverFilesAndPermissionInput, signature);

      // Verify both files are in the permission
      const permissionFileIds = await dataPermission.permissionFileIds(1);
      expect(permissionFileIds.length).to.equal(2);
      expect(permissionFileIds).to.include(existingFileId);

      const newFileId = await dataRegistry.fileIdByUrl(
        "https://new-file.example.com",
      );
      expect(permissionFileIds).to.include(newFileId);
    });

    it("should reject if existing file is not owned by signer", async function () {
      // Pre-add file with different owner
      await dataRegistry
        .connect(testUser2)
        .addFile("https://other-user-file.example.com");

      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://other-user-file.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      ).to.be.revertedWithCustomError(dataPermission, "NotFileOwner");
    });

    it("should reject with invalid nonce", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 1n, // Wrong nonce, should be 0
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(dataPermission, "InvalidNonce")
        .withArgs(0, 1);
    });

    it("should reject with empty grant", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "",
        fileUrls: ["https://file1.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      ).to.be.revertedWithCustomError(dataPermission, "EmptyGrant");
    });

    it("should reject with invalid grantee ID", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 999n, // Non-existent grantee
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      ).to.be.revertedWithCustomError(dataPermission, "GranteeNotFound");
    });

    it("should reject with empty server public key", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      ).to.be.revertedWithCustomError(testServersContract, "EmptyPublicKey");
    });

    it("should reject with empty server URL", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com"],
        schemaIds: [1n],
        serverAddress: testServer1.address,
        serverUrl: "",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      ).to.be.revertedWithCustomError(testServersContract, "EmptyUrl");
    });

    it("should handle empty fileUrls array", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: [], // Empty array
        schemaIds: [],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [], // Empty permissions array to match empty fileUrls
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      const tx = await dataPermission
        .connect(testUser1)
        .addServerFilesAndPermissions(serverFilesAndPermissionInput, signature);

      // Should still create server and permission, just with no files
      const serverId = await testServersContract.serverAddressToId(
        testServer1.address,
      );
      expect(serverId).to.be.greaterThan(0);

      const permission = await dataPermission.permissions(1);
      expect(permission.grantor).to.equal(testUser1.address);

      const permissionFileIds = await dataPermission.permissionFileIds(1);
      expect(permissionFileIds.length).to.equal(0);

      await expect(tx).to.emit(dataPermission, "PermissionAdded");
    });

    it("should work when called by different user than signer", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com", "https://file2.example.com"],
        schemaIds: [1n, 1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [
          [{ account: user3.address, key: "key1" }],
          [{ account: user3.address, key: "key1" }],
        ], // No DataRegistry permissions
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      // Call from different user (sponsor) but signature is from testUser1
      await dataPermission
        .connect(sponsor)
        .addServerFilesAndPermissions(serverFilesAndPermissionInput, signature);

      // Should be attributed to the signer (testUser1), not the caller (sponsor)
      const permission = await dataPermission.permissions(1);
      expect(permission.grantor).to.equal(testUser1.address);

      expect(await dataPermission.userNonce(testUser1.address)).to.equal(1);
      expect(await dataPermission.userNonce(sponsor.address)).to.equal(0);
    });

    it("should reject when filePermissions array length doesn't match fileUrls", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com", "https://file2.example.com"],
        schemaIds: [1n, 1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [[]], // Only one permission array for two files
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await expect(
        dataPermission
          .connect(testUser1)
          .addServerFilesAndPermissions(
            serverFilesAndPermissionInput,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(
          dataPermission,
          "InvalidPermissionsLength",
        )
        .withArgs(2, 1);
    });

    it("should handle files with DataRegistry permissions", async function () {
      const serverFilesAndPermissionInput = {
        nonce: 0n,
        granteeId: 1n,
        grant: "ipfs://grant1",
        fileUrls: ["https://file1.example.com", "https://file2.example.com"],
        schemaIds: [1n, 1n],
        serverAddress: testServer1.address,
        serverUrl: "https://server1.example.com",
        serverPublicKey: "publicKey1",
        filePermissions: [
          [{ account: testUser2.address, key: "encryptionKey1" }], // Permission for file 1
          [
            { account: testUser2.address, key: "encryptionKey2" },
            { account: testServer1.address, key: "encryptionKey3" },
          ], // Multiple permissions for file 2
        ],
      };

      const signature = await createServerFilesAndPermissionSignature(
        serverFilesAndPermissionInput,
        dataPermission.target.toString(),
        testUser1,
      );

      await dataPermission
        .connect(testUser1)
        .addServerFilesAndPermissions(serverFilesAndPermissionInput, signature);

      console.log(testUser1.address);
      console.log(await dataPermission.permissionsCount());
      console.log((await dataPermission.permissions(1)).grantor);

      // Verify files were created with correct permissions
      const file1Id = await dataRegistry.fileIdByUrl(
        "https://file1.example.com",
      );
      const file2Id = await dataRegistry.fileIdByUrl(
        "https://file2.example.com",
      );

      // Check file 1 permissions
      const file1Permission = await dataRegistry.filePermissions(
        file1Id,
        testUser2.address,
      );
      expect(file1Permission).to.equal("encryptionKey1");

      // Check file 2 permissions
      const file2Permission1 = await dataRegistry.filePermissions(
        file2Id,
        testUser2.address,
      );
      const file2Permission2 = await dataRegistry.filePermissions(
        file2Id,
        testServer1.address,
      );
      expect(file2Permission1).to.equal("encryptionKey2");
      expect(file2Permission2).to.equal("encryptionKey3");
    });
  });
});
