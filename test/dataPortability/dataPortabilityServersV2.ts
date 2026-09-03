import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, upgrades } from "hardhat";
import { DataPortabilityServersV2Implementation } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DataPortabilityServersV2", () => {
  let trustedForwarder: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let serverOwner1: HardhatEthersSigner;
  let serverOwner2: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let server1: HardhatEthersSigner;
  let server2: HardhatEthersSigner;

  let serversContract: DataPortabilityServersV2Implementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const PUBLIC_KEY_1 = "0x04aabbccddeeff00112233445566778899";
  const SERVER_URL_1 = "https://server1.example.com";
  const PUBLIC_KEY_2 = "0x04ffeeddccbbaa99887766554433221100";
  const SERVER_URL_2 = "https://server2.example.com";

  type ServerRegistration = {
    ownerAddress: string;
    serverAddress: string;
    publicKey: string;
    serverUrl: string;
  };

  type ServerDeregistration = {
    ownerAddress: string;
    serverAddress: string;
    serverId: string;
    deadline: bigint | number;
  };

  const eip712Domain = async () => ({
    name: "Vana Data Portability",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await serversContract.getAddress(),
  });

  const signRegistration = async (
    signer: HardhatEthersSigner,
    registration: ServerRegistration,
  ) => {
    const domain = await eip712Domain();
    const types = {
      ServerRegistration: [
        { name: "ownerAddress", type: "address" },
        { name: "serverAddress", type: "address" },
        { name: "publicKey", type: "string" },
        { name: "serverUrl", type: "string" },
      ],
    };
    return await signer.signTypedData(domain, types, registration);
  };

  const signDeregistration = async (
    signer: HardhatEthersSigner,
    deregistration: ServerDeregistration,
  ) => {
    const domain = await eip712Domain();
    const types = {
      ServerDeregistration: [
        { name: "ownerAddress", type: "address" },
        { name: "serverAddress", type: "address" },
        { name: "serverId", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    };
    return await signer.signTypedData(domain, types, deregistration);
  };

  const futureDeadline = async (secondsFromNow = 3600) => {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block!.timestamp + secondsFromNow);
  };

  // Register a server owned by `ownerSigner` (submitted by `relayer` unless
  // overridden) and return { serverId, receipt }.
  const registerServer = async (
    ownerSigner: HardhatEthersSigner,
    serverAddress: string,
    publicKey: string,
    serverUrl: string,
    submitter: HardhatEthersSigner = relayer,
  ) => {
    const registration: ServerRegistration = {
      ownerAddress: ownerSigner.address,
      serverAddress,
      publicKey,
      serverUrl,
    };
    const signature = await signRegistration(ownerSigner, registration);
    const tx = await serversContract
      .connect(submitter)
      .registerServerWithSignature(registration, signature);
    const receipt = await tx.wait();
    const serverId = await serversContract.computeServerId(
      serverAddress,
      publicKey,
      serverUrl,
    );
    return { serverId, receipt, registration };
  };

  const deregisterServer = async (
    ownerSigner: HardhatEthersSigner,
    serverAddress: string,
    serverId: string,
    submitter: HardhatEthersSigner = relayer,
  ) => {
    const deregistration: ServerDeregistration = {
      ownerAddress: ownerSigner.address,
      serverAddress,
      serverId,
      deadline: await futureDeadline(),
    };
    const signature = await signDeregistration(ownerSigner, deregistration);
    const tx = await serversContract
      .connect(submitter)
      .deregisterServerWithSignature(deregistration, signature);
    return { deregistration, signature, receipt: await tx.wait() };
  };

  const deploy = async () => {
    [
      trustedForwarder,
      deployer,
      owner,
      maintainer,
      serverOwner1,
      serverOwner2,
      relayer,
      server1,
      server2,
    ] = await ethers.getSigners();

    const factory = await ethers.getContractFactory(
      "DataPortabilityServersV2Implementation",
    );

    const proxyDeploy = await upgrades.deployProxy(
      factory,
      [trustedForwarder.address, owner.address],
      { kind: "uups" },
    );

    serversContract = await ethers.getContractAt(
      "DataPortabilityServersV2Implementation",
      proxyDeploy.target,
    );

    await serversContract
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  beforeEach(async () => {
    await deploy();
  });

  describe("Setup", () => {
    it("should have correct params after deploy", async function () {
      (await serversContract.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(
        true,
      );
      (await serversContract.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
      (
        await serversContract.hasRole(MAINTAINER_ROLE, maintainer)
      ).should.eq(true);
      (await serversContract.trustedForwarder()).should.eq(
        trustedForwarder.address,
      );
      (await serversContract.version()).should.eq(1);
      (await serversContract.serversCount()).should.eq(0);
      (await serversContract.paused()).should.eq(false);
    });

    it("should expose the expected EIP-712 typehashes", async function () {
      (await serversContract.SERVER_REGISTRATION_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "ServerRegistration(address ownerAddress,address serverAddress,string publicKey,string serverUrl)",
          ),
        ),
      );
      (await serversContract.SERVER_DEREGISTRATION_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "ServerDeregistration(address ownerAddress,address serverAddress,bytes32 serverId,uint256 deadline)",
          ),
        ),
      );
    });

    it("should reject re-initialization", async function () {
      await expect(
        serversContract.initialize(trustedForwarder.address, owner.address),
      ).to.be.revertedWithCustomError(serversContract, "InvalidInitialization");
    });

    it("should reject initialization with zero owner", async function () {
      const implFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      );
      const impl = await implFactory.deploy();
      await impl.waitForDeployment();

      const proxyFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Proxy",
      );
      const initData = implFactory.interface.encodeFunctionData("initialize", [
        trustedForwarder.address,
        ethers.ZeroAddress,
      ]);

      await expect(
        proxyFactory.deploy(await impl.getAddress(), initData),
      ).to.be.revertedWithCustomError(implFactory, "ZeroAddress");
    });
  });

  describe("computeServerId", () => {
    it("should expose the standard EIP-712 domain separator", async function () {
      // Independent recomputation — this is the value off-chain gateways use
      // to predict serverIds, so it must match hashDomain of the documented
      // domain, not merely be internally consistent.
      (await serversContract.domainSeparator()).should.eq(
        ethers.TypedDataEncoder.hashDomain(await eip712Domain()),
      );
    });

    it("should equal keccak256(abi.encode(domainSeparator, serverAddress, publicKey, serverUrl))", async function () {
      const domainSep = ethers.TypedDataEncoder.hashDomain(
        await eip712Domain(),
      );
      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "string", "string"],
          [domainSep, server1.address, PUBLIC_KEY_1, SERVER_URL_1],
        ),
      );

      (
        await serversContract.computeServerId(
          server1.address,
          PUBLIC_KEY_1,
          SERVER_URL_1,
        )
      ).should.eq(expected);
    });

    it("should produce different ids for different inputs", async function () {
      const id1 = await serversContract.computeServerId(
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const id2 = await serversContract.computeServerId(
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_2,
      );
      const id3 = await serversContract.computeServerId(
        server2.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      id1.should.not.eq(id2);
      id1.should.not.eq(id3);
      id2.should.not.eq(id3);
    });
  });

  describe("registerServerWithSignature", () => {
    it("should register a server via any relayer with the owner's signature", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(serverOwner1, registration);

      const expectedServerId = await serversContract.computeServerId(
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      const tx = await serversContract
        .connect(relayer)
        .registerServerWithSignature(registration, signature);
      const receipt = await tx.wait();

      await expect(tx)
        .to.emit(serversContract, "ServerRegistered")
        .withArgs(
          expectedServerId,
          serverOwner1.address,
          server1.address,
          PUBLIC_KEY_1,
          SERVER_URL_1,
        );

      const server = await serversContract.getServer(expectedServerId);
      server.id.should.eq(expectedServerId);
      server.ownerAddress.should.eq(serverOwner1.address);
      server.serverAddress.should.eq(server1.address);
      server.publicKey.should.eq(PUBLIC_KEY_1);
      server.serverUrl.should.eq(SERVER_URL_1);
      server.registeredAtBlock.should.eq(receipt!.blockNumber);
      server.revokedAtBlock.should.eq(0);

      (await serversContract.activeServerId(server1.address)).should.eq(
        expectedServerId,
      );

      const activeServer = await serversContract.getActiveServerByAddress(
        server1.address,
      );
      activeServer.id.should.eq(expectedServerId);
      activeServer.ownerAddress.should.eq(serverOwner1.address);
      activeServer.serverAddress.should.eq(server1.address);
      activeServer.publicKey.should.eq(PUBLIC_KEY_1);
      activeServer.serverUrl.should.eq(SERVER_URL_1);

      const owned = await serversContract.ownerServers(serverOwner1.address);
      owned.length.should.eq(1);
      owned[0].id.should.eq(expectedServerId);

      (await serversContract.serversCount()).should.eq(1);
    });

    it("should register multiple servers and increment serversCount", async function () {
      const { serverId: id1 } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const { serverId: id2 } = await registerServer(
        serverOwner1,
        server2.address,
        PUBLIC_KEY_2,
        SERVER_URL_2,
      );

      (await serversContract.serversCount()).should.eq(2);
      const owned = await serversContract.ownerServers(serverOwner1.address);
      owned.length.should.eq(2);
      owned[0].id.should.eq(id1);
      owned[1].id.should.eq(id2);
    });

    it("should revert with ZeroAddress for zero ownerAddress", async function () {
      const registration: ServerRegistration = {
        ownerAddress: ethers.ZeroAddress,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(serverOwner1, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      ).to.be.revertedWithCustomError(serversContract, "ZeroAddress");
    });

    it("should revert with ZeroAddress for zero serverAddress", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: ethers.ZeroAddress,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(serverOwner1, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      ).to.be.revertedWithCustomError(serversContract, "ZeroAddress");
    });

    it("should revert with EmptyPublicKey for empty publicKey", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: "",
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(serverOwner1, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      ).to.be.revertedWithCustomError(serversContract, "EmptyPublicKey");
    });

    it("should revert with EmptyUrl for empty serverUrl", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: "",
      };
      const signature = await signRegistration(serverOwner1, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      ).to.be.revertedWithCustomError(serversContract, "EmptyUrl");
    });

    it("should revert with OwnerMismatch when signed by someone else", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      // serverOwner2 signs a payload claiming serverOwner1 as owner.
      const signature = await signRegistration(serverOwner2, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "OwnerMismatch")
        .withArgs(serverOwner1.address, serverOwner2.address);
    });

    it("should revert with OwnerMismatch when the signed payload differs from the submitted input", async function () {
      const signedRegistration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(
        serverOwner1,
        signedRegistration,
      );

      // Tamper with the serverUrl after signing.
      const tampered: ServerRegistration = {
        ...signedRegistration,
        serverUrl: SERVER_URL_2,
      };

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(tampered, signature),
      ).to.be.revertedWithCustomError(serversContract, "OwnerMismatch");
    });

    it("should revert with ECDSAInvalidSignature for an unrecoverable signature", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      // v = 0 makes ecrecover return address(0) deterministically — OZ
      // ECDSA surfaces this as its own typed error, never OwnerMismatch.
      const unrecoverable = "0x" + "11".repeat(64) + "00";

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, unrecoverable),
      ).to.be.revertedWithCustomError(serversContract, "ECDSAInvalidSignature");
    });

    it("should revert with ServerAlreadyRegistered for an already-active serverAddress", async function () {
      await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      const registration: ServerRegistration = {
        ownerAddress: serverOwner2.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_2,
        serverUrl: SERVER_URL_2,
      };
      const signature = await signRegistration(serverOwner2, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "ServerAlreadyRegistered",
        )
        .withArgs(server1.address);
    });
  });

  describe("Re-registration semantics", () => {
    it("should reject re-registering the identical tuple after deregistration (id collision)", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServer(serverOwner1, server1.address, serverId);

      // Same (serverAddress, publicKey, serverUrl) tuple -> same serverId,
      // which collides with the revoked record.
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(serverOwner1, registration);

      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, signature),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "ServerAlreadyRegistered",
        )
        .withArgs(server1.address);
    });

    it("should allow re-registering the same serverAddress with a different serverUrl", async function () {
      const { serverId: oldId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServer(serverOwner1, server1.address, oldId);

      const { serverId: newId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_2,
      );

      newId.should.not.eq(oldId);
      (await serversContract.activeServerId(server1.address)).should.eq(newId);
      (await serversContract.serversCount()).should.eq(2);

      const active = await serversContract.getActiveServerByAddress(
        server1.address,
      );
      active.id.should.eq(newId);
      active.serverUrl.should.eq(SERVER_URL_2);
      active.revokedAtBlock.should.eq(0);

      // Both records exist under the owner.
      const owned = await serversContract.ownerServers(serverOwner1.address);
      owned.length.should.eq(2);
      owned[0].id.should.eq(oldId);
      owned[0].revokedAtBlock.should.not.eq(0);
      owned[1].id.should.eq(newId);
    });

    it("should allow re-registering the same serverAddress with a different publicKey", async function () {
      const { serverId: oldId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServer(serverOwner1, server1.address, oldId);

      const { serverId: newId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_2,
        SERVER_URL_1,
      );

      newId.should.not.eq(oldId);
      (await serversContract.activeServerId(server1.address)).should.eq(newId);
      const active = await serversContract.getActiveServerByAddress(
        server1.address,
      );
      active.publicKey.should.eq(PUBLIC_KEY_2);
    });
  });

  describe("deregisterServerWithSignature", () => {
    let serverId: string;

    beforeEach(async () => {
      ({ serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      ));
    });

    it("should deregister a server via any relayer with the owner's signature", async function () {
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const signature = await signDeregistration(serverOwner1, deregistration);

      const tx = await serversContract
        .connect(relayer)
        .deregisterServerWithSignature(deregistration, signature);
      const receipt = await tx.wait();

      await expect(tx)
        .to.emit(serversContract, "ServerDeregistered")
        .withArgs(serverId, serverOwner1.address, server1.address);

      // Record is retained but revoked.
      const server = await serversContract.getServer(serverId);
      server.revokedAtBlock.should.eq(receipt!.blockNumber);

      // Active pointer is cleared.
      (await serversContract.activeServerId(server1.address)).should.eq(
        ethers.ZeroHash,
      );

      await expect(
        serversContract.getActiveServerByAddress(server1.address),
      ).to.be.revertedWithCustomError(serversContract, "ServerNotFound");

      // Owner enumeration still includes the revoked record.
      const owned = await serversContract.ownerServers(serverOwner1.address);
      owned.length.should.eq(1);
      owned[0].id.should.eq(serverId);
      owned[0].revokedAtBlock.should.eq(receipt!.blockNumber);

      // serversCount is a monotonic total; it does not decrease.
      (await serversContract.serversCount()).should.eq(1);
    });

    it("should revert with DeadlineExpired for an expired deadline", async function () {
      const block = await ethers.provider.getBlock("latest");
      const expiredDeadline = BigInt(block!.timestamp - 1);
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline: expiredDeadline,
      };
      const signature = await signDeregistration(serverOwner1, deregistration);

      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "DeadlineExpired")
        .withArgs(expiredDeadline, anyValue);
    });

    it("should accept a deregistration at exactly the deadline (boundary)", async function () {
      // The check is strict (`block.timestamp > deadline` reverts), so a tx
      // mined exactly AT the deadline must succeed.
      const deadline = BigInt(await time.latest()) + 100n;
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline,
      };
      const signature = await signDeregistration(serverOwner1, deregistration);

      await time.setNextBlockTimestamp(deadline);
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      ).to.emit(serversContract, "ServerDeregistered");
    });

    it("should revert getServer with ServerNotFound for an unknown id", async function () {
      const unknownId = ethers.id("no-such-server");
      await expect(serversContract.getServer(unknownId))
        .to.be.revertedWithCustomError(serversContract, "ServerNotFound")
        .withArgs(unknownId);
    });

    it("should revert with OwnerMismatch when signed by the wrong signer", async function () {
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const signature = await signDeregistration(serverOwner2, deregistration);

      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "OwnerMismatch")
        .withArgs(serverOwner1.address, serverOwner2.address);
    });

    it("should revert with NotServerOwner when a non-owner self-signs a deregistration", async function () {
      // serverOwner2 signs a deregistration naming THEMSELVES as owner over
      // serverOwner1's server: the signature is internally consistent (no
      // OwnerMismatch) and the serverId is the active one (no StaleServerId),
      // so only the stored-owner check stands between a third party and
      // revoking someone else's server.
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner2.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const signature = await signDeregistration(serverOwner2, deregistration);

      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "NotServerOwner")
        .withArgs(serverId, serverOwner2.address, serverOwner1.address);

      // The server is still active.
      (await serversContract.activeServerId(server1.address)).should.eq(
        serverId,
      );
    });

    it("should revert with ServerNotFound when no active registration exists", async function () {
      // server2 was never registered.
      const fakeServerId = await serversContract.computeServerId(
        server2.address,
        PUBLIC_KEY_2,
        SERVER_URL_2,
      );
      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server2.address,
        serverId: fakeServerId,
        deadline: await futureDeadline(),
      };
      const signature = await signDeregistration(serverOwner1, deregistration);

      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "ServerNotFound")
        .withArgs(fakeServerId);
    });

    it("should revert with ServerNotFound when replaying a deregistration after revoke", async function () {
      const { deregistration, signature } = await deregisterServer(
        serverOwner1,
        server1.address,
        serverId,
      );

      // Replaying the same signed deregistration: the active pointer is
      // cleared, so it fails as ServerNotFound.
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "ServerNotFound")
        .withArgs(serverId);
    });

    it("should revert with StaleServerId when replaying an old deregistration against a re-registration", async function () {
      // Deregister the original registration, keeping its signed payload.
      const { deregistration: oldDeregistration, signature: oldSignature } =
        await deregisterServer(serverOwner1, server1.address, serverId);

      // Re-register the same address with a different url -> fresh serverId.
      const { serverId: newId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_2,
      );
      newId.should.not.eq(serverId);

      // Replay the deregistration signed over the OLD serverId.
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(oldDeregistration, oldSignature),
      )
        .to.be.revertedWithCustomError(serversContract, "StaleServerId")
        .withArgs(newId, serverId);
    });
  });

  describe("ERC-2771 meta-transactions", () => {
    it("should attribute _msgSender to the appended address for forwarder calls", async function () {
      // The trusted forwarder appends the real sender (maintainer) as the
      // last 20 bytes of calldata. pause() is MAINTAINER_ROLE-gated, so this
      // only succeeds if the override block resolves the appended address.
      const pauseWithSender = ethers.concat([
        serversContract.interface.encodeFunctionData("pause"),
        maintainer.address,
      ]);

      await trustedForwarder.sendTransaction({
        to: await serversContract.getAddress(),
        data: pauseWithSender,
      });
      (await serversContract.paused()).should.eq(true);

      const unpauseWithSender = ethers.concat([
        serversContract.interface.encodeFunctionData("unpause"),
        maintainer.address,
      ]);
      await trustedForwarder.sendTransaction({
        to: await serversContract.getAddress(),
        data: unpauseWithSender,
      });
      (await serversContract.paused()).should.eq(false);
    });

    it("should ignore the appended address for non-forwarder callers", async function () {
      // The same suffix trick from anyone else must NOT impersonate the
      // maintainer — msg.sender (the relayer) is used and lacks the role.
      const pauseWithSender = ethers.concat([
        serversContract.interface.encodeFunctionData("pause"),
        maintainer.address,
      ]);

      await expect(
        relayer.sendTransaction({
          to: await serversContract.getAddress(),
          data: pauseWithSender,
        }),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(relayer.address, MAINTAINER_ROLE);
      (await serversContract.paused()).should.eq(false);
    });
  });

  describe("Pause / unpause / trusted forwarder", () => {
    it("should allow maintainer to pause and unpause", async function () {
      await serversContract.connect(maintainer).pause();
      (await serversContract.paused()).should.eq(true);

      await serversContract.connect(maintainer).unpause();
      (await serversContract.paused()).should.eq(false);
    });

    it("should reject pause and unpause from non-maintainer", async function () {
      await expect(serversContract.connect(serverOwner1).pause())
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(serverOwner1.address, MAINTAINER_ROLE);

      await serversContract.connect(maintainer).pause();

      await expect(serversContract.connect(serverOwner1).unpause())
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(serverOwner1.address, MAINTAINER_ROLE);
    });

    it("should reject register and deregister while paused", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      await serversContract.connect(maintainer).pause();

      const registration: ServerRegistration = {
        ownerAddress: serverOwner2.address,
        serverAddress: server2.address,
        publicKey: PUBLIC_KEY_2,
        serverUrl: SERVER_URL_2,
      };
      const regSignature = await signRegistration(serverOwner2, registration);
      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithSignature(registration, regSignature),
      ).to.be.revertedWithCustomError(serversContract, "EnforcedPause");

      const deregistration: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const deregSignature = await signDeregistration(
        serverOwner1,
        deregistration,
      );
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerWithSignature(deregistration, deregSignature),
      ).to.be.revertedWithCustomError(serversContract, "EnforcedPause");

      // After unpausing, both operations succeed again.
      await serversContract.connect(maintainer).unpause();
      await serversContract
        .connect(relayer)
        .registerServerWithSignature(registration, regSignature).should.be
        .fulfilled;
      await serversContract
        .connect(relayer)
        .deregisterServerWithSignature(deregistration, deregSignature).should
        .be.fulfilled;
    });

    it("should allow maintainer to update the trusted forwarder", async function () {
      await serversContract
        .connect(maintainer)
        .updateTrustedForwarder(serverOwner2.address);
      (await serversContract.trustedForwarder()).should.eq(
        serverOwner2.address,
      );
    });

    it("should reject updateTrustedForwarder from non-maintainer", async function () {
      await expect(
        serversContract
          .connect(serverOwner1)
          .updateTrustedForwarder(serverOwner1.address),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(serverOwner1.address, MAINTAINER_ROLE);
    });
  });

  describe("Upgrades", () => {
    it("should reject upgradeToAndCall from non-admin", async function () {
      const implFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      );
      const newImpl = await implFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        serversContract
          .connect(maintainer)
          .upgradeToAndCall(await newImpl.getAddress(), "0x"),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(maintainer.address, DEFAULT_ADMIN_ROLE);
    });

    it("should allow admin to upgrade via upgradeToAndCall and preserve state", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      const implFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      );
      const newImpl = await implFactory.deploy();
      await newImpl.waitForDeployment();

      await serversContract
        .connect(owner)
        .upgradeToAndCall(await newImpl.getAddress(), "0x").should.be
        .fulfilled;

      // State survives the upgrade.
      (await serversContract.serversCount()).should.eq(1);
      (await serversContract.activeServerId(server1.address)).should.eq(
        serverId,
      );
      const server = await serversContract.getServer(serverId);
      server.ownerAddress.should.eq(serverOwner1.address);
      (await serversContract.version()).should.eq(1);
    });

    it("should allow admin to upgrade via upgrades.upgradeProxy", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      const implFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
        owner,
      );

      await upgrades.upgradeProxy(
        await serversContract.getAddress(),
        implFactory,
        { redeployImplementation: "always" },
      ).should.be.fulfilled;

      (await serversContract.serversCount()).should.eq(1);
      (await serversContract.activeServerId(server1.address)).should.eq(
        serverId,
      );
      (await serversContract.version()).should.eq(1);
    });
  });
});
