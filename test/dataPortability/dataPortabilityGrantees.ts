import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
  DataPortabilityGranteesImplementation,
  DataPortabilityPermissionsImplementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);

describe("DataPortabilityGrantees", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let granteeAddress1: HardhatEthersSigner;
  let granteeAddress2: HardhatEthersSigner;
  let trustedForwarder: HardhatEthersSigner;

  let granteesContract: DataPortabilityGranteesImplementation;
  let permissionsContract: DataPortabilityPermissionsImplementation;

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const MAINTAINER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MAINTAINER_ROLE"));
  const PERMISSION_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"));

  beforeEach(async () => {
    [deployer, owner, maintainer, user1, user2, granteeAddress1, granteeAddress2, trustedForwarder] =
      await ethers.getSigners();

    // Deploy DataPortabilityGrantees
    const DataPortabilityGranteesFactory = await ethers.getContractFactory(
      "DataPortabilityGranteesImplementation"
    );
    granteesContract = await upgrades.deployProxy(
      DataPortabilityGranteesFactory,
      [trustedForwarder.address, owner.address],
      { initializer: "initialize" }
    ) as unknown as DataPortabilityGranteesImplementation;
    await granteesContract.waitForDeployment();

    // Grant roles
    await granteesContract.connect(owner).grantRole(MAINTAINER_ROLE, maintainer.address);
    await granteesContract.connect(owner).grantRole(PERMISSION_MANAGER_ROLE, owner.address);
  });

  describe("granteePermissionsPaginated", () => {
    let granteeId: bigint;
    const publicKey = "test-public-key-123";
    const permissionIds: bigint[] = [];

    beforeEach(async () => {
      // Register a grantee
      const tx = await granteesContract.connect(granteeAddress1).registerGrantee(
        granteeAddress1.address,
        granteeAddress1.address,
        publicKey
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      granteeId = granteesContract.interface.parseLog(event!)!.args[0];

      // Add multiple permissions to test pagination
      for (let i = 1; i <= 25; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
        permissionIds.push(BigInt(i));
      }
    });

    it("should return all permissions when limit exceeds total", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        100
      );

      expect(ids.length).to.equal(25);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.false;

      // Verify all permission IDs are present
      const returnedIds = ids.map(id => Number(id));
      for (let i = 1; i <= 25; i++) {
        expect(returnedIds).to.include(i);
      }
    });

    it("should paginate correctly with small pages", async () => {
      // First page
      const [ids1, totalCount1, hasMore1] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        10
      );
      expect(ids1.length).to.equal(10);
      expect(totalCount1).to.equal(25);
      expect(hasMore1).to.be.true;

      // Second page
      const [ids2, totalCount2, hasMore2] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        10,
        10
      );
      expect(ids2.length).to.equal(10);
      expect(totalCount2).to.equal(25);
      expect(hasMore2).to.be.true;

      // Third page (partial)
      const [ids3, totalCount3, hasMore3] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        20,
        10
      );
      expect(ids3.length).to.equal(5);
      expect(totalCount3).to.equal(25);
      expect(hasMore3).to.be.false;

      // Verify no duplicates and all IDs are covered
      const allIds = [...ids1, ...ids2, ...ids3].map(id => Number(id));
      expect(allIds.length).to.equal(25);
      const uniqueIds = [...new Set(allIds)];
      expect(uniqueIds.length).to.equal(25);
    });

    it("should handle offset at boundary correctly", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        25,
        10
      );

      expect(ids.length).to.equal(0);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.false;
    });

    it("should handle offset beyond total count", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        100,
        10
      );

      expect(ids.length).to.equal(0);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.false;
    });

    it("should return empty array for grantee with no permissions", async () => {
      // Register another grantee with no permissions
      const tx = await granteesContract.connect(granteeAddress2).registerGrantee(
        granteeAddress2.address,
        granteeAddress2.address,
        "another-public-key"
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      const newGranteeId = granteesContract.interface.parseLog(event!)!.args[0];

      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        newGranteeId,
        0,
        10
      );

      expect(ids.length).to.equal(0);
      expect(totalCount).to.equal(0);
      expect(hasMore).to.be.false;
    });

    it("should revert for non-existent grantee", async () => {
      await expect(
        granteesContract.granteePermissionsPaginated(999, 0, 10)
      ).to.be.revertedWithCustomError(granteesContract, "GranteeNotFound");
    });

    it("should revert for grantee ID 0", async () => {
      await expect(
        granteesContract.granteePermissionsPaginated(0, 0, 10)
      ).to.be.revertedWithCustomError(granteesContract, "GranteeNotFound");
    });

    it("should handle single item pagination", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        1
      );

      expect(ids.length).to.equal(1);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.true;
    });

    it("should handle last page correctly", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        24,
        10
      );

      expect(ids.length).to.equal(1);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.false;
    });

    it("should maintain consistency after removing permissions", async () => {
      // Remove some permissions
      await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 5);
      await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 10);
      await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 15);

      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        50
      );

      expect(ids.length).to.equal(22);
      expect(totalCount).to.equal(22);
      expect(hasMore).to.be.false;

      // Verify removed permissions are not present
      const returnedIds = ids.map(id => Number(id));
      expect(returnedIds).to.not.include(5);
      expect(returnedIds).to.not.include(10);
      expect(returnedIds).to.not.include(15);
    });

    it("should handle large pagination limits efficiently", async () => {
      // Add many more permissions to test with larger dataset
      for (let i = 26; i <= 100; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
      }

      // Request large page
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        50
      );

      expect(ids.length).to.equal(50);
      expect(totalCount).to.equal(100);
      expect(hasMore).to.be.true;

      // Get second large page
      const [ids2, totalCount2, hasMore2] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        50,
        50
      );

      expect(ids2.length).to.equal(50);
      expect(totalCount2).to.equal(100);
      expect(hasMore2).to.be.false;
    });

    it("should work correctly with limit of 0", async () => {
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        0
      );

      expect(ids.length).to.equal(0);
      expect(totalCount).to.equal(25);
      expect(hasMore).to.be.true;
    });

    it("should match regular granteePermissions for full retrieval", async () => {
      const regularPermissions = await granteesContract.granteePermissions(granteeId);
      const [paginatedPermissions, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        100
      );

      expect(paginatedPermissions.length).to.equal(regularPermissions.length);
      expect(totalCount).to.equal(regularPermissions.length);
      expect(hasMore).to.be.false;

      // Convert to sets for comparison (order might differ)
      const regularSet = new Set(regularPermissions.map(p => p.toString()));
      const paginatedSet = new Set(paginatedPermissions.map(p => p.toString()));

      expect(regularSet.size).to.equal(paginatedSet.size);
      for (const permission of regularSet) {
        expect(paginatedSet.has(permission)).to.be.true;
      }
    });

    it("should correctly report permissionsCount in GranteeInfoV2", async () => {
      const granteeInfo = await granteesContract.granteeInfoV2(granteeId);
      expect(granteeInfo.permissionsCount).to.equal(25);

      // Remove a permission and check again
      await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 1);
      const updatedInfo = await granteesContract.granteeInfoV2(granteeId);
      expect(updatedInfo.permissionsCount).to.equal(24);
    });
  });

  describe("Edge cases and stress tests", () => {
    it("should handle pagination with exactly matching boundaries", async () => {
      // Register a grantee (owner must equal granteeAddress when called by non-maintainer)
      const tx = await granteesContract.connect(granteeAddress1).registerGrantee(
        granteeAddress1.address,
        granteeAddress1.address,
        "test-key"
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      const granteeId = granteesContract.interface.parseLog(event!)!.args[0];

      // Add exactly 10 permissions
      for (let i = 1; i <= 10; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
      }

      // Get exactly all items
      const [ids, totalCount, hasMore] = await granteesContract.granteePermissionsPaginated(
        granteeId,
        0,
        10
      );

      expect(ids.length).to.equal(10);
      expect(totalCount).to.equal(10);
      expect(hasMore).to.be.false;
    });

    it("should handle sequential pagination correctly", async () => {
      // Register a grantee (owner must equal granteeAddress when called by non-maintainer)
      const tx = await granteesContract.connect(granteeAddress1).registerGrantee(
        granteeAddress1.address,
        granteeAddress1.address,
        "test-key"
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      const granteeId = granteesContract.interface.parseLog(event!)!.args[0];

      // Add 7 permissions for odd number testing
      for (let i = 1; i <= 7; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i * 10);
      }

      // Page through with size 3
      const allIds: bigint[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const [ids, , more] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          offset,
          3
        );
        allIds.push(...ids);
        hasMore = more;
        offset += 3;
      }

      expect(allIds.length).to.equal(7);
      const uniqueIds = [...new Set(allIds.map(id => id.toString()))];
      expect(uniqueIds.length).to.equal(7);
    });
  });

  describe("V2 Functions", () => {
    let granteeId: bigint;
    const publicKey = "test-public-key-v2";

    beforeEach(async () => {
      // Register a grantee
      const tx = await granteesContract.connect(granteeAddress1).registerGrantee(
        granteeAddress1.address,
        granteeAddress1.address,
        publicKey
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      granteeId = granteesContract.interface.parseLog(event!)!.args[0];

      // Add some permissions
      for (let i = 1; i <= 15; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
      }
    });

    describe("granteesV2", () => {
      it("should return grantee info with permissions count", async () => {
        const granteeInfo = await granteesContract.granteesV2(granteeId);

        expect(granteeInfo.owner).to.equal(granteeAddress1.address);
        expect(granteeInfo.granteeAddress).to.equal(granteeAddress1.address);
        expect(granteeInfo.publicKey).to.equal(publicKey);
        expect(granteeInfo.permissionsCount).to.equal(15);
      });

      it("should return correct permissions count after adding permissions", async () => {
        // Add more permissions
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 100);
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 101);

        const granteeInfo = await granteesContract.granteesV2(granteeId);
        expect(granteeInfo.permissionsCount).to.equal(17);
      });

      it("should return correct permissions count after removing permissions", async () => {
        // Remove some permissions
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 1);
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 5);
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 10);

        const granteeInfo = await granteesContract.granteesV2(granteeId);
        expect(granteeInfo.permissionsCount).to.equal(12);
      });

      it("should return zero permissions count for grantee with no permissions", async () => {
        // Register new grantee without permissions (owner must equal granteeAddress when called by non-maintainer)
        const tx = await granteesContract.connect(granteeAddress2).registerGrantee(
          granteeAddress2.address,
          granteeAddress2.address,
          "another-key"
        );
        const receipt = await tx.wait();
        const event = receipt?.logs.find(
          (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
        );
        const newGranteeId = granteesContract.interface.parseLog(event!)!.args[0];

        const granteeInfo = await granteesContract.granteesV2(newGranteeId);
        expect(granteeInfo.permissionsCount).to.equal(0);
      });

      it("should match permissions count with regular grantees function", async () => {
        const granteeInfoV1 = await granteesContract.grantees(granteeId);
        const granteeInfoV2 = await granteesContract.granteesV2(granteeId);

        expect(granteeInfoV2.permissionsCount).to.equal(granteeInfoV1.permissionIds.length);
      });
    });

    describe("granteeInfoV2", () => {
      it("should return grantee info with permissions count", async () => {
        const granteeInfo = await granteesContract.granteeInfoV2(granteeId);

        expect(granteeInfo.owner).to.equal(granteeAddress1.address);
        expect(granteeInfo.granteeAddress).to.equal(granteeAddress1.address);
        expect(granteeInfo.publicKey).to.equal(publicKey);
        expect(granteeInfo.permissionsCount).to.equal(15);
      });

      it("should return same data as granteesV2", async () => {
        const infoFromGrantees = await granteesContract.granteesV2(granteeId);
        const infoFromGranteeInfo = await granteesContract.granteeInfoV2(granteeId);

        expect(infoFromGranteeInfo.owner).to.equal(infoFromGrantees.owner);
        expect(infoFromGranteeInfo.granteeAddress).to.equal(infoFromGrantees.granteeAddress);
        expect(infoFromGranteeInfo.publicKey).to.equal(infoFromGrantees.publicKey);
        expect(infoFromGranteeInfo.permissionsCount).to.equal(infoFromGrantees.permissionsCount);
      });

      it("should update permissions count dynamically", async () => {
        const initialInfo = await granteesContract.granteeInfoV2(granteeId);
        expect(initialInfo.permissionsCount).to.equal(15);

        // Add permissions
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 50);
        const afterAddInfo = await granteesContract.granteeInfoV2(granteeId);
        expect(afterAddInfo.permissionsCount).to.equal(16);

        // Remove permissions
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 50);
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 1);
        const afterRemoveInfo = await granteesContract.granteeInfoV2(granteeId);
        expect(afterRemoveInfo.permissionsCount).to.equal(14);
      });
    });

    describe("granteeByAddressV2", () => {
      it("should return grantee info by address with permissions count", async () => {
        const granteeInfo = await granteesContract.granteeByAddressV2(granteeAddress1.address);

        expect(granteeInfo.owner).to.equal(granteeAddress1.address);
        expect(granteeInfo.granteeAddress).to.equal(granteeAddress1.address);
        expect(granteeInfo.publicKey).to.equal(publicKey);
        expect(granteeInfo.permissionsCount).to.equal(15);
      });

      it("should match granteeInfoV2 result when queried by ID", async () => {
        const infoById = await granteesContract.granteeInfoV2(granteeId);
        const infoByAddress = await granteesContract.granteeByAddressV2(granteeAddress1.address);

        expect(infoByAddress.owner).to.equal(infoById.owner);
        expect(infoByAddress.granteeAddress).to.equal(infoById.granteeAddress);
        expect(infoByAddress.publicKey).to.equal(infoById.publicKey);
        expect(infoByAddress.permissionsCount).to.equal(infoById.permissionsCount);
      });

      it("should return empty data for non-existent grantee address", async () => {
        const nonExistentAddress = ethers.Wallet.createRandom().address;
        const granteeInfo = await granteesContract.granteeByAddressV2(nonExistentAddress);

        expect(granteeInfo.owner).to.equal(ethers.ZeroAddress);
        expect(granteeInfo.granteeAddress).to.equal(ethers.ZeroAddress);
        expect(granteeInfo.publicKey).to.equal("");
        expect(granteeInfo.permissionsCount).to.equal(0);
      });

      it("should work with multiple grantees", async () => {
        // Register second grantee (owner must equal granteeAddress when called by non-maintainer)
        const tx = await granteesContract.connect(granteeAddress2).registerGrantee(
          granteeAddress2.address,
          granteeAddress2.address,
          "second-key"
        );
        const receipt = await tx.wait();
        const event = receipt?.logs.find(
          (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
        );
        const granteeId2 = granteesContract.interface.parseLog(event!)!.args[0];

        // Add different permissions to second grantee
        for (let i = 100; i <= 105; i++) {
          await granteesContract.connect(owner).addPermissionToGrantee(granteeId2, i);
        }

        // Check both grantees
        const info1 = await granteesContract.granteeByAddressV2(granteeAddress1.address);
        const info2 = await granteesContract.granteeByAddressV2(granteeAddress2.address);

        expect(info1.owner).to.equal(granteeAddress1.address);
        expect(info1.permissionsCount).to.equal(15);

        expect(info2.owner).to.equal(granteeAddress2.address);
        expect(info2.permissionsCount).to.equal(6);
      });
    });

    describe("V2 Functions Performance Benefits", () => {
      it("should be more gas efficient than V1 with many permissions", async () => {
        // Add many more permissions to demonstrate V2 efficiency
        for (let i = 20; i <= 100; i++) {
          await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
        }

        // Both should return correct data but V2 should use less gas for reading
        const infoV1 = await granteesContract.granteeInfo(granteeId);
        const infoV2 = await granteesContract.granteeInfoV2(granteeId);

        // Verify V2 returns count instead of full array
        expect(infoV2.permissionsCount).to.equal(96); // 15 initial + 81 new
        expect(infoV1.permissionIds.length).to.equal(96);

        // V2 should return just the count, not the full array
        expect(infoV2.permissionsCount).to.be.a("bigint");
      });

      it("should allow efficient permission count checks without loading full arrays", async () => {
        // Add large number of permissions
        for (let i = 20; i <= 500; i++) {
          await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
        }

        // V2 can efficiently check permission count
        const info = await granteesContract.granteeInfoV2(granteeId);
        expect(info.permissionsCount).to.equal(496); // 15 initial + 481 new

        // Use pagination to get actual permission IDs only when needed
        const [permissionIds] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          10
        );
        expect(permissionIds.length).to.equal(10);
      });
    });

    describe("V2 Functions Consistency", () => {
      it("should maintain consistency between all V2 query functions", async () => {
        const fromGrantees = await granteesContract.granteesV2(granteeId);
        const fromGranteeInfo = await granteesContract.granteeInfoV2(granteeId);
        const fromByAddress = await granteesContract.granteeByAddressV2(granteeAddress1.address);

        // All should return identical data
        expect(fromGrantees.owner).to.equal(fromGranteeInfo.owner);
        expect(fromGrantees.owner).to.equal(fromByAddress.owner);

        expect(fromGrantees.granteeAddress).to.equal(fromGranteeInfo.granteeAddress);
        expect(fromGrantees.granteeAddress).to.equal(fromByAddress.granteeAddress);

        expect(fromGrantees.publicKey).to.equal(fromGranteeInfo.publicKey);
        expect(fromGrantees.publicKey).to.equal(fromByAddress.publicKey);

        expect(fromGrantees.permissionsCount).to.equal(fromGranteeInfo.permissionsCount);
        expect(fromGrantees.permissionsCount).to.equal(fromByAddress.permissionsCount);
      });

      it("should maintain consistency between V1 and V2 permission counts", async () => {
        const infoV1 = await granteesContract.granteeInfo(granteeId);
        const infoV2 = await granteesContract.granteeInfoV2(granteeId);

        expect(BigInt(infoV1.permissionIds.length)).to.equal(infoV2.permissionsCount);

        // Test after modifications
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 200);
        const updatedV1 = await granteesContract.granteeInfo(granteeId);
        const updatedV2 = await granteesContract.granteeInfoV2(granteeId);

        expect(BigInt(updatedV1.permissionIds.length)).to.equal(updatedV2.permissionsCount);
      });

      it("should match paginated total count with V2 permissions count", async () => {
        const [, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          10
        );
        const infoV2 = await granteesContract.granteeInfoV2(granteeId);

        expect(totalCount).to.equal(infoV2.permissionsCount);
      });
    });
  });

  describe("V1 vs V2 Functions Comparison", () => {
    let granteeId: bigint;
    const publicKey = "comparison-test-key";

    beforeEach(async () => {
      // Register a grantee
      const tx = await granteesContract.connect(granteeAddress1).registerGrantee(
        granteeAddress1.address,
        granteeAddress1.address,
        publicKey
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => granteesContract.interface.parseLog(log)?.name === "GranteeRegistered"
      );
      granteeId = granteesContract.interface.parseLog(event!)!.args[0];

      // Add permissions
      for (let i = 1; i <= 30; i++) {
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
      }
    });

    describe("grantees() vs granteesV2()", () => {
      it("should have matching permission count and array length", async () => {
        const v1Result = await granteesContract.grantees(granteeId);
        const v2Result = await granteesContract.granteesV2(granteeId);

        // V2 permissionsCount should match V1 permissionIds array length
        expect(v2Result.permissionsCount).to.equal(v1Result.permissionIds.length);
        expect(v1Result.permissionIds.length).to.equal(30);
      });

      it("should have V1 permissionIds matching paginated results", async () => {
        const v1Result = await granteesContract.grantees(granteeId);
        const [paginatedIds, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // Arrays should have same length
        expect(v1Result.permissionIds.length).to.equal(paginatedIds.length);
        expect(v1Result.permissionIds.length).to.equal(totalCount);

        // Content should match
        const v1Set = new Set(v1Result.permissionIds.map(id => id.toString()));
        const paginatedSet = new Set(paginatedIds.map(id => id.toString()));

        expect(v1Set.size).to.equal(paginatedSet.size);
        for (const id of v1Set) {
          expect(paginatedSet.has(id)).to.be.true;
        }
      });

      it("should maintain consistency across all three methods", async () => {
        const v1Result = await granteesContract.grantees(granteeId);
        const v2Result = await granteesContract.granteesV2(granteeId);
        const [paginatedIds, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // All counts should match
        expect(v1Result.permissionIds.length).to.equal(30);
        expect(v2Result.permissionsCount).to.equal(30);
        expect(totalCount).to.equal(30);
        expect(paginatedIds.length).to.equal(30);
      });
    });

    describe("granteeInfo() vs granteeInfoV2()", () => {
      it("should have matching permission count and array length", async () => {
        const v1Result = await granteesContract.granteeInfo(granteeId);
        const v2Result = await granteesContract.granteeInfoV2(granteeId);

        // V2 permissionsCount should match V1 permissionIds array length
        expect(v2Result.permissionsCount).to.equal(v1Result.permissionIds.length);
        expect(v1Result.permissionIds.length).to.equal(30);
      });

      it("should have V1 permissionIds matching paginated results", async () => {
        const v1Result = await granteesContract.granteeInfo(granteeId);
        const [paginatedIds, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // Arrays should have same length
        expect(v1Result.permissionIds.length).to.equal(paginatedIds.length);
        expect(v1Result.permissionIds.length).to.equal(totalCount);

        // Content should match exactly
        const v1Set = new Set(v1Result.permissionIds.map(id => id.toString()));
        const paginatedSet = new Set(paginatedIds.map(id => id.toString()));

        expect(v1Set.size).to.equal(paginatedSet.size);
        for (const id of v1Set) {
          expect(paginatedSet.has(id)).to.be.true;
        }
      });

      it("should maintain data consistency between V1 and V2", async () => {
        const v1Result = await granteesContract.granteeInfo(granteeId);
        const v2Result = await granteesContract.granteeInfoV2(granteeId);

        // Basic fields should match
        expect(v1Result.owner).to.equal(v2Result.owner);
        expect(v1Result.granteeAddress).to.equal(v2Result.granteeAddress);
        expect(v1Result.publicKey).to.equal(v2Result.publicKey);

        // Count should match array length
        expect(BigInt(v1Result.permissionIds.length)).to.equal(v2Result.permissionsCount);
      });
    });

    describe("granteeByAddress() vs granteeByAddressV2()", () => {
      it("should have matching permission count and array length", async () => {
        const v1Result = await granteesContract.granteeByAddress(granteeAddress1.address);
        const v2Result = await granteesContract.granteeByAddressV2(granteeAddress1.address);

        // V2 permissionsCount should match V1 permissionIds array length
        expect(v2Result.permissionsCount).to.equal(v1Result.permissionIds.length);
        expect(v1Result.permissionIds.length).to.equal(30);
      });

      it("should have V1 permissionIds matching paginated results", async () => {
        const v1Result = await granteesContract.granteeByAddress(granteeAddress1.address);
        const [paginatedIds, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // Arrays should have same length
        expect(v1Result.permissionIds.length).to.equal(paginatedIds.length);
        expect(v1Result.permissionIds.length).to.equal(totalCount);

        // Content should match exactly
        const v1Set = new Set(v1Result.permissionIds.map(id => id.toString()));
        const paginatedSet = new Set(paginatedIds.map(id => id.toString()));

        expect(v1Set.size).to.equal(paginatedSet.size);
        for (const id of v1Set) {
          expect(paginatedSet.has(id)).to.be.true;
        }
      });

      it("should maintain data consistency between V1 and V2", async () => {
        const v1Result = await granteesContract.granteeByAddress(granteeAddress1.address);
        const v2Result = await granteesContract.granteeByAddressV2(granteeAddress1.address);

        // Basic fields should match
        expect(v1Result.owner).to.equal(v2Result.owner);
        expect(v1Result.granteeAddress).to.equal(v2Result.granteeAddress);
        expect(v1Result.publicKey).to.equal(v2Result.publicKey);

        // Count should match array length
        expect(BigInt(v1Result.permissionIds.length)).to.equal(v2Result.permissionsCount);
      });
    });

    describe("granteePermissions() vs granteePermissionsPaginated()", () => {
      it("should return identical permission arrays", async () => {
        const directResult = await granteesContract.granteePermissions(granteeId);
        const [paginatedResult, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // Length should match
        expect(directResult.length).to.equal(paginatedResult.length);
        expect(directResult.length).to.equal(totalCount);

        // Content should match exactly
        const directSet = new Set(directResult.map(id => id.toString()));
        const paginatedSet = new Set(paginatedResult.map(id => id.toString()));

        expect(directSet.size).to.equal(paginatedSet.size);
        for (const id of directSet) {
          expect(paginatedSet.has(id)).to.be.true;
        }
      });

      it("should match granteePermissionIds() results", async () => {
        const permissionsResult = await granteesContract.granteePermissions(granteeId);
        const permissionIdsResult = await granteesContract.granteePermissionIds(granteeId);

        // Should be identical
        expect(permissionsResult.length).to.equal(permissionIdsResult.length);

        for (let i = 0; i < permissionsResult.length; i++) {
          expect(permissionsResult[i]).to.equal(permissionIdsResult[i]);
        }
      });
    });

    describe("Comprehensive V1/V2/Paginated Consistency", () => {
      it("should have all functions return consistent data", async () => {
        // Get data from all functions
        const grantees = await granteesContract.grantees(granteeId);
        const granteesV2 = await granteesContract.granteesV2(granteeId);
        const granteeInfo = await granteesContract.granteeInfo(granteeId);
        const granteeInfoV2 = await granteesContract.granteeInfoV2(granteeId);
        const granteeByAddress = await granteesContract.granteeByAddress(granteeAddress1.address);
        const granteeByAddressV2 = await granteesContract.granteeByAddressV2(granteeAddress1.address);
        const granteePermissions = await granteesContract.granteePermissions(granteeId);
        const granteePermissionIds = await granteesContract.granteePermissionIds(granteeId);
        const [paginatedIds, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // All permission arrays should have same length
        expect(grantees.permissionIds.length).to.equal(30);
        expect(granteeInfo.permissionIds.length).to.equal(30);
        expect(granteeByAddress.permissionIds.length).to.equal(30);
        expect(granteePermissions.length).to.equal(30);
        expect(granteePermissionIds.length).to.equal(30);
        expect(paginatedIds.length).to.equal(30);

        // All V2 counts should match
        expect(granteesV2.permissionsCount).to.equal(30);
        expect(granteeInfoV2.permissionsCount).to.equal(30);
        expect(granteeByAddressV2.permissionsCount).to.equal(30);
        expect(totalCount).to.equal(30);

        // Convert all to sets for content comparison
        const sets = [
          new Set(grantees.permissionIds.map(id => id.toString())),
          new Set(granteeInfo.permissionIds.map(id => id.toString())),
          new Set(granteeByAddress.permissionIds.map(id => id.toString())),
          new Set(granteePermissions.map(id => id.toString())),
          new Set(granteePermissionIds.map(id => id.toString())),
          new Set(paginatedIds.map(id => id.toString()))
        ];

        // All sets should have same size and content
        for (let i = 1; i < sets.length; i++) {
          expect(sets[i].size).to.equal(sets[0].size);
          for (const id of sets[0]) {
            expect(sets[i].has(id)).to.be.true;
          }
        }
      });

      it("should maintain consistency after permission modifications", async () => {
        // Add new permissions
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 100);
        await granteesContract.connect(owner).addPermissionToGrantee(granteeId, 101);

        // Remove some permissions
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 1);
        await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 15);

        // Expected count: 30 - 2 + 2 = 30
        const expectedCount = 30;

        // Get all results
        const v1 = await granteesContract.grantees(granteeId);
        const v2 = await granteesContract.granteesV2(granteeId);
        const [paginated, totalCount] = await granteesContract.granteePermissionsPaginated(
          granteeId,
          0,
          100
        );

        // All counts should match
        expect(v1.permissionIds.length).to.equal(expectedCount);
        expect(v2.permissionsCount).to.equal(expectedCount);
        expect(totalCount).to.equal(expectedCount);
        expect(paginated.length).to.equal(expectedCount);

        // Content should match
        const v1Set = new Set(v1.permissionIds.map(id => id.toString()));
        const paginatedSet = new Set(paginated.map(id => id.toString()));

        expect(v1Set.size).to.equal(paginatedSet.size);
        for (const id of v1Set) {
          expect(paginatedSet.has(id)).to.be.true;
        }

        // Verify specific removals and additions
        expect(v1Set.has("1")).to.be.false;
        expect(v1Set.has("15")).to.be.false;
        expect(v1Set.has("100")).to.be.true;
        expect(v1Set.has("101")).to.be.true;
      });

      it("should handle paginated retrieval matching V1 full array", async () => {
        // Add more permissions to test multi-page pagination
        for (let i = 31; i <= 75; i++) {
          await granteesContract.connect(owner).addPermissionToGrantee(granteeId, i);
        }

        const v1Result = await granteesContract.grantees(granteeId);
        const v2Result = await granteesContract.granteesV2(granteeId);

        // Paginate through all results
        const allPaginatedIds: bigint[] = [];
        let offset = 0;
        const pageSize = 20;
        let hasMore = true;

        while (hasMore) {
          const [ids, , more] = await granteesContract.granteePermissionsPaginated(
            granteeId,
            offset,
            pageSize
          );
          allPaginatedIds.push(...ids);
          hasMore = more;
          offset += pageSize;
        }

        // V1 array, V2 count, and paginated results should all match
        expect(v1Result.permissionIds.length).to.equal(75);
        expect(v2Result.permissionsCount).to.equal(75);
        expect(allPaginatedIds.length).to.equal(75);

        // Content should match
        const v1Set = new Set(v1Result.permissionIds.map(id => id.toString()));
        const paginatedSet = new Set(allPaginatedIds.map(id => id.toString()));

        expect(v1Set.size).to.equal(paginatedSet.size);
        for (const id of v1Set) {
          expect(paginatedSet.has(id)).to.be.true;
        }
      });
    });
  });
});