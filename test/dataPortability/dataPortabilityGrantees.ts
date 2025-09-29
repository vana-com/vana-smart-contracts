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
      const tx = await granteesContract.connect(user1).registerGrantee(
        user1.address,
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
      const tx = await granteesContract.connect(user2).registerGrantee(
        user2.address,
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

    it("should correctly report permissionsCount in GranteeInfo", async () => {
      const granteeInfo = await granteesContract.granteeInfo(granteeId);
      expect(granteeInfo.permissionsCount).to.equal(25);

      // Remove a permission and check again
      await granteesContract.connect(owner).removePermissionFromGrantee(granteeId, 1);
      const updatedInfo = await granteesContract.granteeInfo(granteeId);
      expect(updatedInfo.permissionsCount).to.equal(24);
    });
  });

  describe("Edge cases and stress tests", () => {
    it("should handle pagination with exactly matching boundaries", async () => {
      // Register a grantee
      const tx = await granteesContract.connect(user1).registerGrantee(
        user1.address,
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
      // Register a grantee
      const tx = await granteesContract.connect(user1).registerGrantee(
        user1.address,
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
});