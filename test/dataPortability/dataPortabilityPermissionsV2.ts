import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DataPortabilityPermissionsV2Implementation,
  DataPortabilityServersV2Implementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DataPortabilityPermissionsV2", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let grantor: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let serverSigner: HardhatEthersSigner;
  let otherOwner: HardhatEthersSigner;
  let otherServerSigner: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let permissionsContract: DataPortabilityPermissionsV2Implementation;
  let serversContract: DataPortabilityServersV2Implementation;

  let chainId: bigint;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const GRANTEE_ID_1 = ethers.keccak256(ethers.toUtf8Bytes("grantee-1"));
  const GRANTEE_ID_2 = ethers.keccak256(ethers.toUtf8Bytes("grantee-2"));

  const grantRegistrationTypes = {
    GrantRegistration: [
      { name: "grantorAddress", type: "address" },
      { name: "granteeId", type: "bytes32" },
      { name: "scopes", type: "string[]" },
      { name: "grantVersion", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  };

  const serverRegistrationTypes = {
    ServerRegistration: [
      { name: "ownerAddress", type: "address" },
      { name: "serverAddress", type: "address" },
      { name: "publicKey", type: "string" },
      { name: "serverUrl", type: "string" },
    ],
  };

  const serverDeregistrationTypes = {
    ServerDeregistration: [
      { name: "ownerAddress", type: "address" },
      { name: "serverAddress", type: "address" },
      { name: "serverId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const permissionsDomain = async () => ({
    name: "Vana Data Portability",
    version: "1",
    chainId: chainId,
    verifyingContract: await permissionsContract.getAddress(),
  });

  const serversDomain = async () => ({
    name: "Vana Data Portability",
    version: "1",
    chainId: chainId,
    verifyingContract: await serversContract.getAddress(),
  });

  type PermissionInput = {
    grantorAddress: string;
    granteeId: string;
    scopes: string[];
    grantVersion: bigint | number;
    expiresAt: bigint | number;
  };

  const makeInput = (
    overrides: Partial<PermissionInput> = {},
  ): PermissionInput => ({
    grantorAddress: grantor.address,
    granteeId: GRANTEE_ID_1,
    scopes: ["read:files", "read:profile"],
    grantVersion: 1,
    expiresAt: 0,
    ...overrides,
  });

  const signGrantRegistration = async (
    signer: HardhatEthersSigner,
    input: PermissionInput,
  ) => {
    return signer.signTypedData(
      await permissionsDomain(),
      grantRegistrationTypes,
      {
        grantorAddress: input.grantorAddress,
        granteeId: input.granteeId,
        scopes: input.scopes,
        grantVersion: input.grantVersion,
        expiresAt: input.expiresAt,
      },
    );
  };

  // Registers a server on ServersV2, signed by `serverOwner` (EIP-712).
  const registerServer = async (
    serverOwner: HardhatEthersSigner,
    serverAddress: string,
    publicKey = "test-public-key",
    serverUrl = "https://server.example.com",
  ): Promise<string> => {
    const registration = {
      ownerAddress: serverOwner.address,
      serverAddress,
      publicKey,
      serverUrl,
    };
    const signature = await serverOwner.signTypedData(
      await serversDomain(),
      serverRegistrationTypes,
      registration,
    );
    await serversContract
      .connect(relayer)
      .registerServerWithSignature(registration, signature);
    return await serversContract.activeServerId(serverAddress);
  };

  const deregisterServer = async (
    serverOwner: HardhatEthersSigner,
    serverAddress: string,
    serverId: string,
  ) => {
    const deadline = (await time.latest()) + 3600;
    const deregistration = {
      ownerAddress: serverOwner.address,
      serverAddress,
      serverId,
      deadline,
    };
    const signature = await serverOwner.signTypedData(
      await serversDomain(),
      serverDeregistrationTypes,
      deregistration,
    );
    await serversContract
      .connect(relayer)
      .deregisterServerWithSignature(deregistration, signature);
  };

  const computeGrantIdTs = async (
    grantorAddress: string,
    granteeId: string,
  ): Promise<string> => {
    const ds = ethers.TypedDataEncoder.hashDomain(await permissionsDomain());
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "bytes32"],
        [ds, grantorAddress, granteeId],
      ),
    );
  };

  const deploy = async () => {
    [
      deployer,
      owner,
      grantor,
      relayer,
      serverSigner,
      otherOwner,
      otherServerSigner,
      stranger,
    ] = await ethers.getSigners();

    chainId = (await ethers.provider.getNetwork()).chainId;

    const permissionsDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Implementation",
      ),
      [owner.address],
      { kind: "uups" },
    );
    permissionsContract = await ethers.getContractAt(
      "DataPortabilityPermissionsV2Implementation",
      permissionsDeploy.target,
    );

    const serversDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      ),
      [owner.address],
      { kind: "uups" },
    );
    serversContract = await ethers.getContractAt(
      "DataPortabilityServersV2Implementation",
      serversDeploy.target,
    );
  };

  beforeEach(async () => {
    await deploy();
  });

  describe("initialize", () => {
    it("should grant DEFAULT_ADMIN_ROLE to the owner", async () => {
      (
        await permissionsContract.hasRole(DEFAULT_ADMIN_ROLE, owner.address)
      ).should.eq(true);
      (
        await permissionsContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).should.eq(false);
    });

    it("should return version 2", async () => {
      (await permissionsContract.version()).should.eq(2);
    });

    it("should leave dataPortabilityServers unset after deploy", async () => {
      (await permissionsContract.dataPortabilityServers()).should.eq(
        ethers.ZeroAddress,
      );
    });

    it("should reject re-initialization", async () => {
      await expect(
        permissionsContract.connect(owner).initialize(owner.address),
      ).to.be.revertedWithCustomError(
        permissionsContract,
        "InvalidInitialization",
      );
    });

    it("should reject a zero owner address", async () => {
      const implFactory = await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Implementation",
      );
      const impl = await implFactory.deploy();
      await impl.waitForDeployment();

      const proxyFactory = await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Proxy",
      );
      const initData = implFactory.interface.encodeFunctionData("initialize", [
        ethers.ZeroAddress,
      ]);
      await expect(
        proxyFactory.deploy(impl.target, initData),
      ).to.be.revertedWithCustomError(impl, "ZeroAddress");
    });
  });

  describe("grantId and domainSeparator views", () => {
    it("domainSeparator() should match ethers.TypedDataEncoder.hashDomain", async () => {
      const expected = ethers.TypedDataEncoder.hashDomain(
        await permissionsDomain(),
      );
      (await permissionsContract.domainSeparator()).should.eq(expected);
    });

    it("grantId() should equal keccak256(abi.encode(domainSeparator, grantor, granteeId))", async () => {
      const expected = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
      (
        await permissionsContract.grantId(grantor.address, GRANTEE_ID_1)
      ).should.eq(expected);

      const expected2 = await computeGrantIdTs(
        otherOwner.address,
        GRANTEE_ID_2,
      );
      (
        await permissionsContract.grantId(otherOwner.address, GRANTEE_ID_2)
      ).should.eq(expected2);
      expected.should.not.eq(expected2);
    });

    it("GRANT_REGISTRATION_TYPEHASH should match the declared type string", async () => {
      const expected = ethers.keccak256(
        ethers.toUtf8Bytes(
          "GrantRegistration(address grantorAddress,bytes32 granteeId,string[] scopes,uint256 grantVersion,uint256 expiresAt)",
        ),
      );
      (await permissionsContract.GRANT_REGISTRATION_TYPEHASH()).should.eq(
        expected,
      );
    });
  });

  describe("addPermission (direct)", () => {
    it("should revert with GrantorMismatch when msg.sender is not the grantor", async () => {
      const input = makeInput();
      await expect(
        permissionsContract.connect(stranger).addPermission(input),
      )
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, stranger.address);
    });

    it("should create a permission and emit PermissionSet", async () => {
      const input = makeInput({ expiresAt: (await time.latest()) + 10_000 });
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      await expect(permissionsContract.connect(grantor).addPermission(input))
        .to.emit(permissionsContract, "PermissionSet")
        .withArgs(
          id,
          grantor.address,
          GRANTEE_ID_1,
          input.scopes,
          input.grantVersion,
          input.expiresAt,
        );

      const stored = await permissionsContract.permissions(id);
      stored.grantorAddress.should.eq(grantor.address);
      stored.granteeId.should.eq(GRANTEE_ID_1);
      stored.scopes.should.deep.eq(input.scopes);
      stored.grantVersion.should.eq(1);
      stored.expiresAt.should.eq(input.expiresAt);
    });

    it("should return the deterministic grant id", async () => {
      const input = makeInput();
      const expectedId = await computeGrantIdTs(
        grantor.address,
        GRANTEE_ID_1,
      );
      const returnedId = await permissionsContract
        .connect(grantor)
        .addPermission.staticCall(input);
      returnedId.should.eq(expectedId);
    });

    it("should revert with ZeroGranteeId for a zero granteeId", async () => {
      const input = makeInput({ granteeId: ethers.ZeroHash });
      await expect(
        permissionsContract.connect(grantor).addPermission(input),
      ).to.be.revertedWithCustomError(permissionsContract, "ZeroGranteeId");
    });

    it("should revert with EmptyScopes for an empty scopes array", async () => {
      const input = makeInput({ scopes: [] });
      await expect(
        permissionsContract.connect(grantor).addPermission(input),
      ).to.be.revertedWithCustomError(permissionsContract, "EmptyScopes");
    });

    describe("grantVersion monotonicity", () => {
      it("should reject grantVersion 0 on first write with InvalidGrantVersion(0, 0)", async () => {
        const input = makeInput({ grantVersion: 0 });
        await expect(
          permissionsContract.connect(grantor).addPermission(input),
        )
          .to.be.revertedWithCustomError(
            permissionsContract,
            "InvalidGrantVersion",
          )
          .withArgs(0, 0);
      });

      it("should accept grantVersion 1 as the first write", async () => {
        await permissionsContract
          .connect(grantor)
          .addPermission(makeInput({ grantVersion: 1 })).should.be.fulfilled;
      });

      it("should reject a re-write with the same grantVersion", async () => {
        await permissionsContract
          .connect(grantor)
          .addPermission(makeInput({ grantVersion: 1 }));
        await expect(
          permissionsContract
            .connect(grantor)
            .addPermission(makeInput({ grantVersion: 1 })),
        )
          .to.be.revertedWithCustomError(
            permissionsContract,
            "InvalidGrantVersion",
          )
          .withArgs(1, 1);
      });

      it("should reject a re-write with a lower grantVersion", async () => {
        await permissionsContract
          .connect(grantor)
          .addPermission(makeInput({ grantVersion: 5 }));
        await expect(
          permissionsContract
            .connect(grantor)
            .addPermission(makeInput({ grantVersion: 3 })),
        )
          .to.be.revertedWithCustomError(
            permissionsContract,
            "InvalidGrantVersion",
          )
          .withArgs(5, 3);
      });

      it("should overwrite (upsert) with a higher grantVersion, fully replacing scopes and expiresAt", async () => {
        const firstExpiry = (await time.latest()) + 100_000;
        await permissionsContract.connect(grantor).addPermission(
          makeInput({
            scopes: ["scope:a", "scope:b", "scope:c"],
            grantVersion: 1,
            expiresAt: firstExpiry,
          }),
        );

        const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
        let stored = await permissionsContract.permissions(id);
        stored.scopes.should.deep.eq(["scope:a", "scope:b", "scope:c"]);
        stored.expiresAt.should.eq(firstExpiry);

        const secondExpiry = (await time.latest()) + 200_000;
        await permissionsContract.connect(grantor).addPermission(
          makeInput({
            scopes: ["scope:only"],
            grantVersion: 2,
            expiresAt: secondExpiry,
          }),
        );

        stored = await permissionsContract.permissions(id);
        stored.scopes.should.deep.eq(["scope:only"]);
        stored.scopes.length.should.eq(1);
        stored.grantVersion.should.eq(2);
        stored.expiresAt.should.eq(secondExpiry);
      });

      // ---- Hashlock 6th audit, L-01: capped step, gaps still allowed ----
      describe("step cap (MAX_GRANT_VERSION_STEP)", () => {
        const STEP = 2n ** 64n;
        const MAX_UINT256 = (1n << 256n) - 1n;

        it("exposes the cap", async () => {
          (await permissionsContract.MAX_GRANT_VERSION_STEP()).should.eq(STEP);
        });

        it("accepts gaps below the cap (the gateway submits only a grant's latest version)", async () => {
          await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
          await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 3 })).should.be.fulfilled;
          const ts = BigInt(Date.now()); // a client using millisecond timestamps
          await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: ts })).should.be.fulfilled;
          const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
          (await permissionsContract.permissions(id)).grantVersion.should.eq(ts);
        });

        it("accepts a step of exactly the cap and rejects one more", async () => {
          await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: STEP }));
          await expect(
            permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: STEP + STEP + 1n })),
          )
            .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
            .withArgs(STEP, STEP + STEP + 1n);
          await permissionsContract
            .connect(grantor)
            .addPermission(makeInput({ grantVersion: STEP + STEP })).should.be.fulfilled;
        });

        it("rejects a first write above the cap", async () => {
          await expect(permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: STEP + 1n })))
            .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
            .withArgs(0, STEP + 1n);
        });

        it("rejects type(uint256).max directly (no overflow in the step check)", async () => {
          await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
          await expect(permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: MAX_UINT256 })))
            .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
            .withArgs(1, MAX_UINT256);
        });
      });
    });
  });

  describe("isActive", () => {
    it("should return false for an unknown id", async () => {
      (
        await permissionsContract.isActive(
          ethers.keccak256(ethers.toUtf8Bytes("nonexistent")),
        )
      ).should.eq(false);
    });

    it("should return true for a perpetual permission (expiresAt == 0)", async () => {
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ expiresAt: 0 }));
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
      (await permissionsContract.isActive(id)).should.eq(true);

      // Still perpetual far in the future.
      await time.increase(10 * 365 * 24 * 3600);
      (await permissionsContract.isActive(id)).should.eq(true);
    });

    it("should be active before and exactly at expiresAt, inactive after", async () => {
      const expiresAt = (await time.latest()) + 10_000;
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ expiresAt }));
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      (await permissionsContract.isActive(id)).should.eq(true);

      // isActive uses <= — exactly at expiresAt is still active.
      await time.increaseTo(expiresAt);
      (await permissionsContract.isActive(id)).should.eq(true);

      await time.increaseTo(expiresAt + 1);
      (await permissionsContract.isActive(id)).should.eq(false);
    });

    it("should support revocation via upsert with a past expiresAt and higher grantVersion", async () => {
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ grantVersion: 1, expiresAt: 0 }));
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
      (await permissionsContract.isActive(id)).should.eq(true);

      const pastTimestamp = (await time.latest()) - 100;
      await permissionsContract
        .connect(grantor)
        .addPermission(
          makeInput({ grantVersion: 2, expiresAt: pastTimestamp }),
        );

      (await permissionsContract.isActive(id)).should.eq(false);
      // Record still exists.
      const stored = await permissionsContract.permissions(id);
      stored.grantorAddress.should.eq(grantor.address);
      stored.grantVersion.should.eq(2);
    });
  });

  describe("addPermissionWithSignature (grantor-signed)", () => {
    it("should allow any relayer to submit a grantor-signed permission", async () => {
      const input = makeInput();
      const signature = await signGrantRegistration(grantor, input);
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      const tx = await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, signature);

      await expect(tx)
        .to.emit(permissionsContract, "PermissionSet")
        .withArgs(
          id,
          grantor.address,
          GRANTEE_ID_1,
          input.scopes,
          input.grantVersion,
          input.expiresAt,
        );
      await expect(tx).to.not.emit(
        permissionsContract,
        "PermissionSignedByDelegate",
      );

      const stored = await permissionsContract.permissions(id);
      stored.grantorAddress.should.eq(grantor.address);
      stored.scopes.should.deep.eq(input.scopes);
    });

    it("should reject a replay of the same input + signature via grantVersion monotonicity", async () => {
      const input = makeInput({ grantVersion: 1 });
      const signature = await signGrantRegistration(grantor, input);

      await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, signature);

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "InvalidGrantVersion",
        )
        .withArgs(1, 1);
    });

    it("should reject a signature from an unrelated key with GrantorMismatch", async () => {
      const input = makeInput();
      const signature = await signGrantRegistration(stranger, input);

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      )
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, stranger.address);
    });

    it("should revert for a malformed 65-byte signature", async () => {
      const input = makeInput();
      const garbageSignature = "0x" + "11".repeat(64) + "1b";
      // Either an ECDSA custom error or GrantorMismatch, depending on whether
      // the garbage bytes recover to some address — assert it reverts.
      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, garbageSignature),
      ).to.be.reverted;
    });

    it("should revert with ECDSAInvalidSignatureS for a high-s (malleable) signature", async () => {
      // Deterministic malformed-signature case: flip s into the upper half
      // of the curve order — OZ ECDSA rejects it outright, so a malleated
      // twin of a valid signature can never be replayed.
      const input = makeInput();
      const valid = ethers.Signature.from(
        await signGrantRegistration(grantor, input),
      );
      const N = BigInt(
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
      );
      const highS = ethers.toBeHex(N - BigInt(valid.s), 32);
      const flippedV = valid.v === 27 ? 28 : 27;
      const malleated = ethers.concat([
        valid.r,
        highS,
        ethers.toBeHex(flippedV, 1),
      ]);

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, malleated),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "ECDSAInvalidSignatureS",
        )
        .withArgs(highS);
    });

    it("should revert with ECDSAInvalidSignatureLength for a wrong-length signature", async () => {
      const input = makeInput();
      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, "0x1234"),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "ECDSAInvalidSignatureLength",
        )
        .withArgs(2);
    });

    it("should revert for a signature over different data (tampered input)", async () => {
      const input = makeInput({ scopes: ["read:files"] });
      const signature = await signGrantRegistration(grantor, input);
      const tampered = { ...input, scopes: ["read:files", "write:files"] };

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(tampered, signature),
      )
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        // The recovered signer of a tampered digest is unknowable, but the
        // claimed grantor must be reported as the first arg.
        .withArgs(grantor.address, anyValue);
    });
  });

  describe("setDataPortabilityServers", () => {
    it("should be admin-only", async () => {
      await expect(
        permissionsContract
          .connect(stranger)
          .setDataPortabilityServers(await serversContract.getAddress()),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });

    it("should reject the zero address", async () => {
      await expect(
        permissionsContract
          .connect(owner)
          .setDataPortabilityServers(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(permissionsContract, "ZeroAddress");
    });

    it("should set the registry and emit DataPortabilityServersUpdated", async () => {
      const serversAddress = await serversContract.getAddress();
      await expect(
        permissionsContract
          .connect(owner)
          .setDataPortabilityServers(serversAddress),
      )
        .to.emit(permissionsContract, "DataPortabilityServersUpdated")
        .withArgs(ethers.ZeroAddress, serversAddress);

      (await permissionsContract.dataPortabilityServers()).should.eq(
        serversAddress,
      );

      // Updating again reports the previous address.
      const serversDeploy2 = await upgrades.deployProxy(
        await ethers.getContractFactory(
          "DataPortabilityServersV2Implementation",
        ),
        [owner.address],
        { kind: "uups" },
      );
      await expect(
        permissionsContract
          .connect(owner)
          .setDataPortabilityServers(serversDeploy2.target),
      )
        .to.emit(permissionsContract, "DataPortabilityServersUpdated")
        .withArgs(serversAddress, serversDeploy2.target);
    });
  });

  describe("addPermissionWithSignature (delegate-signed)", () => {
    beforeEach(async () => {
      await permissionsContract
        .connect(owner)
        .setDataPortabilityServers(await serversContract.getAddress());
    });

    // Hashlock 6th audit, L-01: the audit's PoC. A trusted (or compromised)
    // delegate signs a perpetual grant at type(uint256).max to freeze the slot.
    it("rejects a delegate-signed grant that jumps to type(uint256).max (L-01 PoC)", async () => {
      await registerServer(grantor, serverSigner.address);
      const MAX_UINT256 = (1n << 256n) - 1n;
      const locked = makeInput({ grantVersion: MAX_UINT256, expiresAt: 0 });
      const signature = await signGrantRegistration(serverSigner, locked);
      await expect(permissionsContract.connect(relayer).addPermissionWithSignature(locked, signature))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(0, MAX_UINT256);
    });

    it("after a delegate's largest allowed jump the grantor can still revoke", async () => {
      await registerServer(grantor, serverSigner.address);
      const STEP = 2n ** 64n;
      const grant = makeInput({ grantVersion: STEP, expiresAt: 0 });
      await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(grant, await signGrantRegistration(serverSigner, grant));
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
      (await permissionsContract.isActive(id)).should.eq(true);

      // Revocation = upsert with a past expiry and a higher version.
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ grantVersion: STEP + 1n, expiresAt: 1 }));
      (await permissionsContract.isActive(id)).should.eq(false);
    });

    it("should accept a signature from a server registered to the grantor and emit both events", async () => {
      await registerServer(grantor, serverSigner.address);

      const input = makeInput();
      const signature = await signGrantRegistration(serverSigner, input);
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      const tx = await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, signature);

      await expect(tx)
        .to.emit(permissionsContract, "PermissionSet")
        .withArgs(
          id,
          grantor.address,
          GRANTEE_ID_1,
          input.scopes,
          input.grantVersion,
          input.expiresAt,
        );
      await expect(tx)
        .to.emit(permissionsContract, "PermissionSignedByDelegate")
        .withArgs(id, grantor.address, serverSigner.address);

      const stored = await permissionsContract.permissions(id);
      stored.grantorAddress.should.eq(grantor.address);
    });

    it("should still accept a grantor-self-signed permission while the servers registry is set", async () => {
      // Registry configured AND the grantor has a registered delegate — the
      // self-signed path must keep working and must NOT be tagged as
      // delegate-signed.
      await registerServer(grantor, serverSigner.address);

      const input = makeInput();
      const signature = await signGrantRegistration(grantor, input);
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      const tx = await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, signature);

      await expect(tx)
        .to.emit(permissionsContract, "PermissionSet")
        .withArgs(
          id,
          grantor.address,
          GRANTEE_ID_1,
          input.scopes,
          input.grantVersion,
          input.expiresAt,
        );
      await expect(tx).to.not.emit(
        permissionsContract,
        "PermissionSignedByDelegate",
      );
    });

    it("should reject a signature from a server registered to a DIFFERENT owner", async () => {
      await registerServer(otherOwner, otherServerSigner.address);

      const input = makeInput(); // grantor is the claimed grantor
      const signature = await signGrantRegistration(otherServerSigner, input);

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      )
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, otherServerSigner.address);
    });

    it("should reject a delegate signature after the server is deregistered", async () => {
      const serverId = await registerServer(grantor, serverSigner.address);

      const input = makeInput();
      const signature = await signGrantRegistration(serverSigner, input);

      // Works while registered (static call proves it would succeed AND
      // returns the correct deterministic id).
      (
        await permissionsContract
          .connect(relayer)
          .addPermissionWithSignature.staticCall(input, signature)
      ).should.eq(await computeGrantIdTs(grantor.address, GRANTEE_ID_1));

      await deregisterServer(grantor, serverSigner.address, serverId);

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      )
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, serverSigner.address);
    });

    it("should reject a server signature when dataPortabilityServers is unset", async () => {
      // Fresh PermissionsV2 without setDataPortabilityServers.
      const freshDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory(
          "DataPortabilityPermissionsV2Implementation",
        ),
        [owner.address],
        { kind: "uups" },
      );
      const freshPermissions = await ethers.getContractAt(
        "DataPortabilityPermissionsV2Implementation",
        freshDeploy.target,
      );

      await registerServer(grantor, serverSigner.address);

      const input = makeInput();
      const freshDomain = {
        name: "Vana Data Portability",
        version: "1",
        chainId: chainId,
        verifyingContract: await freshPermissions.getAddress(),
      };
      const signature = await serverSigner.signTypedData(
        freshDomain,
        grantRegistrationTypes,
        {
          grantorAddress: input.grantorAddress,
          granteeId: input.granteeId,
          scopes: input.scopes,
          grantVersion: input.grantVersion,
          expiresAt: input.expiresAt,
        },
      );

      await expect(
        freshPermissions
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      )
        .to.be.revertedWithCustomError(freshPermissions, "GrantorMismatch")
        .withArgs(grantor.address, serverSigner.address);
    });
  });

  // ------------------------------------------------------------------
  // grantVersion freeze (two external reports + Hashlock 6th audit L-01)
  // and the grantor-only revokePermission escape hatch.
  // ------------------------------------------------------------------
  describe("revokePermission and grantVersion freeze regressions", () => {
    const STEP = 2n ** 64n;
    const MAX_UINT256 = (1n << 256n) - 1n;
    const NARROW = ["read:profile"];
    const WIDE = ["read:files", "read:profile", "read:messages", "read:contacts"];

    let id: string;

    const signAndSubmit = async (signer: HardhatEthersSigner, input: PermissionInput) =>
      permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, await signGrantRegistration(signer, input));

    // Writes `value` straight into the stored grantVersion of `grantIdHex`
    // (slot layout: _permissions at slot 0; Permission.grantVersion at +3).
    // Simulates a slot that the pre-cap implementation let reach a huge value.
    const setStoredGrantVersion = async (grantIdHex: string, value: bigint) => {
      const base = BigInt(
        ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [grantIdHex, 0])),
      );
      await ethers.provider.send("hardhat_setStorageAt", [
        await permissionsContract.getAddress(),
        ethers.toQuantity(base + 3n),
        ethers.zeroPadValue(ethers.toBeHex(value), 32),
      ]);
    };

    beforeEach(async () => {
      await permissionsContract.connect(owner).setDataPortabilityServers(await serversContract.getAddress());
      id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);
    });

    // Report 1: a registered personal server signs grantVersion = max with
    // expiresAt = 0; the owner deregisters the server and is still locked out.
    it("PoC 1: delegate cannot freeze the slot at type(uint256).max; owner deregisters, revokes and re-issues", async () => {
      const serverId = await registerServer(grantor, serverSigner.address);

      await expect(signAndSubmit(serverSigner, makeInput({ grantVersion: MAX_UINT256, expiresAt: 0 })))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(0, MAX_UINT256);

      // The worst the delegate can still do: the largest allowed jump, perpetual.
      await signAndSubmit(serverSigner, makeInput({ grantVersion: STEP, expiresAt: 0 }));
      (await permissionsContract.isActive(id)).should.eq(true);

      await deregisterServer(grantor, serverSigner.address, serverId);

      await expect(permissionsContract.connect(grantor).revokePermission(id))
        .to.emit(permissionsContract, "PermissionRevoked")
        .withArgs(id, grantor.address, GRANTEE_ID_1, 2n * STEP);
      (await permissionsContract.isActive(id)).should.eq(false);

      const expiry = BigInt(await time.latest()) + 86400n;
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ scopes: NARROW, grantVersion: 2n * STEP + 1n, expiresAt: expiry }));
      const stored = await permissionsContract.permissions(id);
      stored.scopes.should.deep.eq(NARROW);
      stored.expiresAt.should.eq(expiry);
      (await permissionsContract.isActive(id)).should.eq(true);
    });

    // Report 2: the delegate overwrites a narrow, expiring grant the owner
    // issued with wider scopes and no expiry.
    it("PoC 2: owner can revoke and restore after a delegate widens an owner-issued grant", async () => {
      const serverId = await registerServer(grantor, serverSigner.address);
      const expiry = BigInt(await time.latest()) + 86400n;
      const ownerGrant = makeInput({ scopes: NARROW, grantVersion: 1, expiresAt: expiry });
      await permissionsContract.connect(grantor).addPermission(ownerGrant);

      const widened = makeInput({ scopes: WIDE, grantVersion: 2, expiresAt: 0 });
      const widenedSig = await signGrantRegistration(serverSigner, widened);
      await permissionsContract.connect(relayer).addPermissionWithSignature(widened, widenedSig);
      (await permissionsContract.permissions(id)).scopes.should.deep.eq(WIDE);

      // Revoke while the server is still registered: the widened message
      // cannot be replayed.
      await permissionsContract.connect(grantor).revokePermission(id);
      (await permissionsContract.isActive(id)).should.eq(false);
      await expect(permissionsContract.connect(relayer).addPermissionWithSignature(widened, widenedSig))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(2n + STEP, 2);

      await deregisterServer(grantor, serverSigner.address, serverId);

      // Restore the original narrow grant.
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ scopes: NARROW, grantVersion: 2n + STEP + 1n, expiresAt: expiry }));
      const stored = await permissionsContract.permissions(id);
      stored.scopes.should.deep.eq(NARROW);
      stored.expiresAt.should.eq(expiry);
      (await permissionsContract.isActive(id)).should.eq(true);

      // A deregistered server can no longer write the slot at any version.
      await expect(signAndSubmit(serverSigner, makeInput({ scopes: WIDE, grantVersion: 3n + STEP })))
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, serverSigner.address);
    });

    it("PoC 2 (freeze variant): delegate cannot widen an owner-issued grant AND freeze it at max", async () => {
      await registerServer(grantor, serverSigner.address);
      const expiry = BigInt(await time.latest()) + 86400n;
      await permissionsContract
        .connect(grantor)
        .addPermission(makeInput({ scopes: NARROW, grantVersion: 1, expiresAt: expiry }));

      await expect(signAndSubmit(serverSigner, makeInput({ scopes: WIDE, grantVersion: MAX_UINT256, expiresAt: 0 })))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(1, MAX_UINT256);
      const stored = await permissionsContract.permissions(id);
      stored.scopes.should.deep.eq(NARROW);
      stored.expiresAt.should.eq(expiry);
      // The owner's own direct path keeps working.
      await permissionsContract.connect(grantor).addPermission(makeInput({ scopes: NARROW, grantVersion: 2, expiresAt: 1 }));
      (await permissionsContract.isActive(id)).should.eq(false);
    });

    it("kills grantor-signed updates queued off-chain, before and after re-issue", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      const queued2 = makeInput({ grantVersion: 2, scopes: WIDE });
      const queued3 = makeInput({ grantVersion: 3, scopes: WIDE });
      const sig2 = await signGrantRegistration(grantor, queued2);
      const sig3 = await signGrantRegistration(grantor, queued3);

      await permissionsContract.connect(grantor).revokePermission(id);
      for (const [input, sig] of [[queued2, sig2], [queued3, sig3]] as const) {
        await expect(permissionsContract.connect(relayer).addPermissionWithSignature(input, sig))
          .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
          .withArgs(1n + STEP, input.grantVersion);
      }

      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 2n + STEP }));
      await expect(permissionsContract.connect(relayer).addPermissionWithSignature(queued3, sig3))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(2n + STEP, 3);
    });

    it("documents why the jump is a full step: a +1 upsert revoke leaves a queued v3 replayable", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      const queued3 = makeInput({ grantVersion: 3 });
      const sig3 = await signGrantRegistration(grantor, queued3);

      // Legacy-style revocation: upsert v2 with a past expiry.
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 2, expiresAt: 1 }));
      (await permissionsContract.isActive(id)).should.eq(false);
      // Anyone can now land the queued v3 and re-activate the grant.
      await permissionsContract.connect(relayer).addPermissionWithSignature(queued3, sig3);
      (await permissionsContract.isActive(id)).should.eq(true);
    });

    it("a gasless full-step revoke is possible through the existing signed path", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      const queued2 = makeInput({ grantVersion: 2 });
      const sig2 = await signGrantRegistration(grantor, queued2);

      await signAndSubmit(grantor, makeInput({ grantVersion: 1n + STEP, expiresAt: 1 }));
      (await permissionsContract.isActive(id)).should.eq(false);
      await expect(permissionsContract.connect(relayer).addPermissionWithSignature(queued2, sig2))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(1n + STEP, 2);
    });

    it("only the grantor, directly, can revoke", async () => {
      await registerServer(grantor, serverSigner.address);
      await permissionsContract.connect(grantor).addPermission(makeInput());

      for (const caller of [stranger, relayer, serverSigner]) {
        await expect(permissionsContract.connect(caller).revokePermission(id))
          .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
          .withArgs(grantor.address, caller.address);
      }
      (await permissionsContract.isActive(id)).should.eq(true);
    });

    it("reverts PermissionNotFound for an unknown id", async () => {
      await expect(permissionsContract.connect(grantor).revokePermission(id))
        .to.be.revertedWithCustomError(permissionsContract, "PermissionNotFound")
        .withArgs(id);
    });

    it("emits PermissionSet with the new state, then PermissionRevoked, and returns the new version", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 7 }));
      (await permissionsContract.connect(grantor).revokePermission.staticCall(id)).should.eq(7n + STEP);

      const tx = permissionsContract.connect(grantor).revokePermission(id);
      await expect(tx)
        .to.emit(permissionsContract, "PermissionSet")
        .withArgs(id, grantor.address, GRANTEE_ID_1, makeInput().scopes, 7n + STEP, anyValue);
      await expect(tx)
        .to.emit(permissionsContract, "PermissionRevoked")
        .withArgs(id, grantor.address, GRANTEE_ID_1, 7n + STEP);

      const block = await ethers.provider.getBlock((await (await tx).wait())!.blockNumber);
      const stored = await permissionsContract.permissions(id);
      stored.grantVersion.should.eq(7n + STEP);
      stored.expiresAt.should.eq(BigInt(block!.timestamp) - 1n);
      stored.scopes.should.deep.eq(makeInput().scopes);
    });

    it("works while paused (writes stay blocked)", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput());
      await permissionsContract.connect(owner).pause();
      await permissionsContract.connect(grantor).revokePermission(id).should.be.fulfilled;
      (await permissionsContract.isActive(id)).should.eq(false);
      await expect(
        permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 2n + STEP })),
      ).to.be.revertedWithCustomError(permissionsContract, "EnforcedPause");
    });

    it("can be repeated, and normal supersede plus the step bound still apply after it", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      await permissionsContract.connect(grantor).revokePermission(id);
      await permissionsContract.connect(grantor).revokePermission(id);
      const v = 1n + 2n * STEP;
      (await permissionsContract.permissions(id)).grantVersion.should.eq(v);

      await expect(permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: v + STEP + 1n })))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(v, v + STEP + 1n);
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: v + 1n }));
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: v + 2n, scopes: NARROW }));
      (await permissionsContract.permissions(id)).scopes.should.deep.eq(NARROW);
      (await permissionsContract.isActive(id)).should.eq(true);
    });

    it("an untrusted signer is still rejected after a revoke", async () => {
      await registerServer(otherOwner, otherServerSigner.address);
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      await permissionsContract.connect(grantor).revokePermission(id);
      await expect(signAndSubmit(otherServerSigner, makeInput({ grantVersion: 2n + STEP })))
        .to.be.revertedWithCustomError(permissionsContract, "GrantorMismatch")
        .withArgs(grantor.address, otherServerSigner.address);
    });

    // Slots written by the pre-cap implementation could sit at any version.
    // None exist on mainnet (max observed: 28), but the upgraded code must
    // still let the grantor shut such a slot off.
    it("legacy slot already at type(uint256).max: revoke still works (saturates), re-issue is impossible", async () => {
      await signAndSubmit(grantor, makeInput({ grantVersion: 1, expiresAt: 0 }));
      await setStoredGrantVersion(id, MAX_UINT256);
      (await permissionsContract.isActive(id)).should.eq(true);

      await expect(permissionsContract.connect(grantor).revokePermission(id))
        .to.emit(permissionsContract, "PermissionRevoked")
        .withArgs(id, grantor.address, GRANTEE_ID_1, MAX_UINT256);
      (await permissionsContract.isActive(id)).should.eq(false);
      (await permissionsContract.permissions(id)).grantVersion.should.eq(MAX_UINT256);
      await expect(permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: MAX_UINT256 })))
        .to.be.revertedWithCustomError(permissionsContract, "InvalidGrantVersion")
        .withArgs(MAX_UINT256, MAX_UINT256);
    });

    it("legacy slot within one step of max: revoke saturates at type(uint256).max", async () => {
      await permissionsContract.connect(grantor).addPermission(makeInput({ grantVersion: 1 }));
      await setStoredGrantVersion(id, MAX_UINT256 - 5n);
      await permissionsContract.connect(grantor).revokePermission(id);
      (await permissionsContract.permissions(id)).grantVersion.should.eq(MAX_UINT256);
      (await permissionsContract.isActive(id)).should.eq(false);
    });
  });

  describe("pause / unpause", () => {
    it("should be admin-only", async () => {
      await expect(
        permissionsContract.connect(stranger).pause(),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);

      await permissionsContract.connect(owner).pause();

      await expect(
        permissionsContract.connect(stranger).unpause(),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });

    it("should block addPermission and addPermissionWithSignature while paused, and restore on unpause", async () => {
      const input = makeInput();
      const signature = await signGrantRegistration(grantor, input);

      await permissionsContract.connect(owner).pause();
      (await permissionsContract.paused()).should.eq(true);

      await expect(
        permissionsContract.connect(grantor).addPermission(input),
      ).to.be.revertedWithCustomError(permissionsContract, "EnforcedPause");

      await expect(
        permissionsContract
          .connect(relayer)
          .addPermissionWithSignature(input, signature),
      ).to.be.revertedWithCustomError(permissionsContract, "EnforcedPause");

      await permissionsContract.connect(owner).unpause();
      (await permissionsContract.paused()).should.eq(false);

      await permissionsContract
        .connect(relayer)
        .addPermissionWithSignature(input, signature).should.be.fulfilled;

      const input2 = makeInput({ granteeId: GRANTEE_ID_2 });
      await permissionsContract.connect(grantor).addPermission(input2).should
        .be.fulfilled;
    });
  });

  describe("upgrade authorization", () => {
    it("should reject upgradeToAndCall from a non-admin", async () => {
      const implFactory = await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Implementation",
      );
      const newImpl = await implFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        permissionsContract
          .connect(stranger)
          .upgradeToAndCall(newImpl.target, "0x"),
      )
        .to.be.revertedWithCustomError(
          permissionsContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });

    it("should allow an admin upgrade and preserve state", async () => {
      // Write some state first.
      const input = makeInput();
      await permissionsContract.connect(grantor).addPermission(input);
      const id = await computeGrantIdTs(grantor.address, GRANTEE_ID_1);

      const implFactory = await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Implementation",
      );
      const newImpl = await implFactory.deploy();
      await newImpl.waitForDeployment();

      await permissionsContract
        .connect(owner)
        .upgradeToAndCall(newImpl.target, "0x").should.be.fulfilled;

      const implAddress = await upgrades.erc1967.getImplementationAddress(
        await permissionsContract.getAddress(),
      );
      implAddress.should.eq(await newImpl.getAddress());

      // State preserved across the upgrade.
      (await permissionsContract.version()).should.eq(2);
      const stored = await permissionsContract.permissions(id);
      stored.grantorAddress.should.eq(grantor.address);
      stored.scopes.should.deep.eq(input.scopes);
      (await permissionsContract.isActive(id)).should.eq(true);
    });
  });
});
