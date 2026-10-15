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
  let spareSigner: HardhatEthersSigner;
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

  type ServerSelfDeregistration = {
    serverAddress: string;
    serverId: string;
    registeredAtBlock: bigint | number;
    deadline: bigint | number;
  };

  // The server key's proof of possession: same fields as the owner's
  // ServerRegistration, different primary type.
  const signServerProof = async (
    signer: HardhatEthersSigner,
    registration: ServerRegistration,
  ) => {
    const domain = await eip712Domain();
    const types = {
      ServerProof: [
        { name: "ownerAddress", type: "address" },
        { name: "serverAddress", type: "address" },
        { name: "publicKey", type: "string" },
        { name: "serverUrl", type: "string" },
      ],
    };
    return await signer.signTypedData(domain, types, registration);
  };

  const signSelfDeregistration = async (
    signer: HardhatEthersSigner,
    deregistration: ServerSelfDeregistration,
  ) => {
    const domain = await eip712Domain();
    const types = {
      ServerSelfDeregistration: [
        { name: "serverAddress", type: "address" },
        { name: "serverId", type: "bytes32" },
        { name: "registeredAtBlock", type: "uint256" },
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

  // Register with both the owner's signature and the server key's proof.
  const registerServerWithProof = async (
    ownerSigner: HardhatEthersSigner,
    serverSigner: HardhatEthersSigner,
    publicKey: string,
    serverUrl: string,
  ) => {
    const registration: ServerRegistration = {
      ownerAddress: ownerSigner.address,
      serverAddress: serverSigner.address,
      publicKey,
      serverUrl,
    };
    const ownerSignature = await signRegistration(ownerSigner, registration);
    const serverSignature = await signServerProof(serverSigner, registration);
    const tx = await serversContract
      .connect(relayer)
      .registerServerWithProof(registration, ownerSignature, serverSignature);
    const receipt = await tx.wait();
    const serverId = await serversContract.computeServerId(
      serverSigner.address,
      publicKey,
      serverUrl,
    );
    return { serverId, receipt, registration };
  };

  const deregisterServerByServer = async (
    serverSigner: HardhatEthersSigner,
    serverId: string,
  ) => {
    const deregistration: ServerSelfDeregistration = {
      serverAddress: serverSigner.address,
      serverId,
      registeredAtBlock: (await serversContract.getServer(serverId)).registeredAtBlock,
      deadline: await futureDeadline(),
    };
    const signature = await signSelfDeregistration(serverSigner, deregistration);
    const tx = await serversContract
      .connect(relayer)
      .deregisterServerByServer(deregistration, signature);
    return { deregistration, signature, receipt: await tx.wait() };
  };

  const deploy = async () => {
    [
      spareSigner,
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

    const proxyDeploy = await upgrades.deployProxy(factory, [owner.address], {
      kind: "uups",
    });

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
      (await serversContract.version()).should.eq(2);
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
      (await serversContract.SERVER_PROOF_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "ServerProof(address ownerAddress,address serverAddress,string publicKey,string serverUrl)",
          ),
        ),
      );
      (await serversContract.SERVER_SELF_DEREGISTRATION_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "ServerSelfDeregistration(address serverAddress,bytes32 serverId,uint256 registeredAtBlock,uint256 deadline)",
          ),
        ),
      );
    });

    it("should reject re-initialization", async function () {
      await expect(
        serversContract.initialize(owner.address),
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

  describe("Server proof of possession", () => {
    // `spareSigner` plays the attacker: a valid owner key with no control
    // over the victim's server key (`server1`).

    it("should start with the server-proof requirement off", async function () {
      (await serversContract.requireServerProof()).should.eq(false);
    });

    it("should let only the maintainer change the requirement", async function () {
      await expect(
        serversContract.connect(serverOwner1).setRequireServerProof(true),
      )
        .to.be.revertedWithCustomError(
          serversContract,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(serverOwner1.address, MAINTAINER_ROLE);

      await expect(serversContract.connect(maintainer).setRequireServerProof(true))
        .to.emit(serversContract, "RequireServerProofUpdated")
        .withArgs(true);
      (await serversContract.requireServerProof()).should.eq(true);

      await serversContract.connect(maintainer).setRequireServerProof(false);
      (await serversContract.requireServerProof()).should.eq(false);
    });

    it("should register with the owner's signature and the server's proof", async function () {
      const { serverId, receipt } = await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      await expect(receipt)
        .to.emit(serversContract, "ServerRegistered")
        .withArgs(
          serverId,
          serverOwner1.address,
          server1.address,
          PUBLIC_KEY_1,
          SERVER_URL_1,
        );
      (await serversContract.activeServerId(server1.address)).should.eq(serverId);
      (await serversContract.serversCount()).should.eq(1);
    });

    it("should still accept proofs while the requirement is on", async function () {
      await serversContract.connect(maintainer).setRequireServerProof(true);
      await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      ).should.be.fulfilled;
    });

    it("should block the owner-only path once the requirement is on (squat closed)", async function () {
      await serversContract.connect(maintainer).setRequireServerProof(true);

      const squat: ServerRegistration = {
        ownerAddress: spareSigner.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const signature = await signRegistration(spareSigner, squat);
      await expect(
        serversContract
          .connect(spareSigner)
          .registerServerWithSignature(squat, signature),
      ).to.be.revertedWithCustomError(serversContract, "ServerProofRequired");
      (await serversContract.activeServerId(server1.address)).should.eq(
        ethers.ZeroHash,
      );
    });

    it("should reject a proof signed by a key other than serverAddress", async function () {
      const squat: ServerRegistration = {
        ownerAddress: spareSigner.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const ownerSignature = await signRegistration(spareSigner, squat);
      // The attacker signs the "proof" with its own key.
      const forgedProof = await signServerProof(spareSigner, squat);
      await expect(
        serversContract
          .connect(spareSigner)
          .registerServerWithProof(squat, ownerSignature, forgedProof),
      )
        .to.be.revertedWithCustomError(serversContract, "ServerMismatch")
        .withArgs(server1.address, spareSigner.address);
    });

    it("should reject a real server proof issued to a different owner", async function () {
      // server1 consents to serverOwner1, and the attacker lifts that proof.
      const genuine: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const genuineProof = await signServerProof(server1, genuine);

      const squat: ServerRegistration = { ...genuine, ownerAddress: spareSigner.address };
      const ownerSignature = await signRegistration(spareSigner, squat);
      await expect(
        serversContract
          .connect(spareSigner)
          .registerServerWithProof(squat, ownerSignature, genuineProof),
      ).to.be.revertedWithCustomError(serversContract, "ServerMismatch");
    });

    it("should reject a proof over a different publicKey or serverUrl", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const ownerSignature = await signRegistration(serverOwner1, registration);
      const proofForOtherUrl = await signServerProof(server1, {
        ...registration,
        serverUrl: SERVER_URL_2,
      });
      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithProof(registration, ownerSignature, proofForOtherUrl),
      ).to.be.revertedWithCustomError(serversContract, "ServerMismatch");
    });

    it("should not accept the owner's ServerRegistration signature as a proof", async function () {
      // Owner and server are the same key: the typehashes still differ, so
      // one signature cannot serve as both.
      const registration: ServerRegistration = {
        ownerAddress: server1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const ownerSignature = await signRegistration(server1, registration);
      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithProof(registration, ownerSignature, ownerSignature),
      ).to.be.revertedWithCustomError(serversContract, "ServerMismatch");
    });

    it("should still require the owner's signature", async function () {
      const registration: ServerRegistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        publicKey: PUBLIC_KEY_1,
        serverUrl: SERVER_URL_1,
      };
      const notOwner = await signRegistration(spareSigner, registration);
      const serverSignature = await signServerProof(server1, registration);
      await expect(
        serversContract
          .connect(relayer)
          .registerServerWithProof(registration, notOwner, serverSignature),
      )
        .to.be.revertedWithCustomError(serversContract, "OwnerMismatch")
        .withArgs(serverOwner1.address, spareSigner.address);
    });

    it("should reject a proof registration while paused", async function () {
      await serversContract.connect(maintainer).pause();
      await expect(
        registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1),
      ).to.be.revertedWithCustomError(serversContract, "EnforcedPause");
    });
  });

  describe("deregisterServerByServer (squat recovery)", () => {
    it("should let the real server key clear a squatted address and re-register", async function () {
      // A squat made before the requirement is on: attacker-owned record for server1.
      const { serverId: squatId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );

      // The legitimate operator is locked out.
      await expect(
        registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_2),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");

      const { receipt } = await deregisterServerByServer(server1, squatId);
      await expect(receipt)
        .to.emit(serversContract, "ServerDeregistered")
        .withArgs(squatId, spareSigner.address, server1.address);
      (await serversContract.activeServerId(server1.address)).should.eq(
        ethers.ZeroHash,
      );
      (await serversContract.getServer(squatId)).revokedAtBlock.should.not.eq(0);

      // The operator now registers its own address.
      const { serverId } = await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_2,
      );
      const server = await serversContract.getActiveServerByAddress(server1.address);
      server.id.should.eq(serverId);
      server.ownerAddress.should.eq(serverOwner1.address);
    });

    it("should let the operator reclaim the exact tuple a squatter used", async function () {
      // The squatter copies the operator's real publicKey and serverUrl.
      const { serverId: squatId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServerByServer(server1, squatId);

      const { serverId, receipt } = await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      serverId.should.eq(squatId);
      await expect(receipt)
        .to.emit(serversContract, "ServerRegistered")
        .withArgs(serverId, serverOwner1.address, server1.address, PUBLIC_KEY_1, SERVER_URL_1);

      const server = await serversContract.getServer(serverId);
      server.ownerAddress.should.eq(serverOwner1.address);
      server.revokedAtBlock.should.eq(0);
      (await serversContract.activeServerId(server1.address)).should.eq(serverId);

      // The record is listed under the operator only, not the squatter.
      (await serversContract.ownerServers(serverOwner1.address)).length.should.eq(1);
      (await serversContract.ownerServers(spareSigner.address)).length.should.eq(0);
    });

    it("should not replay any eviction signature against the reclaimed record", async function () {
      const { serverId: squatId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const squatBlock = (await serversContract.getServer(squatId)).registeredAtBlock;
      // The operator signs two evictions (e.g. a retry); only one lands.
      const spare: ServerSelfDeregistration = {
        serverAddress: server1.address,
        serverId: squatId,
        registeredAtBlock: squatBlock,
        deadline: await futureDeadline(7200),
      };
      const spareSignature = await signSelfDeregistration(server1, spare);
      await deregisterServerByServer(server1, squatId);

      // The reclaimed record reuses squatId but has a later registeredAtBlock.
      await registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1);
      const reclaimedBlock = (await serversContract.getServer(squatId)).registeredAtBlock;
      reclaimedBlock.should.be.gt(squatBlock);

      await expect(
        serversContract
          .connect(spareSigner)
          .deregisterServerByServer(spare, spareSignature),
      )
        .to.be.revertedWithCustomError(serversContract, "StaleRegistration")
        .withArgs(reclaimedBlock, squatBlock);
      (await serversContract.activeServerId(server1.address)).should.eq(squatId);
    });

    it("should not let the owner-only path reuse a reclaimable tuple", async function () {
      const { serverId: squatId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServerByServer(server1, squatId);

      // The squatter tries to re-take the freed tuple without a proof.
      await expect(
        registerServer(spareSigner, server1.address, PUBLIC_KEY_1, SERVER_URL_1),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");
    });

    it("should keep a proven tuple burnt after the server revokes it (no replay)", async function () {
      const { serverId, registration } = await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServerByServer(server1, serverId);

      // Both signatures are public calldata; replaying them must fail.
      const ownerSignature = await signRegistration(serverOwner1, registration);
      const serverSignature = await signServerProof(server1, registration);
      await expect(
        serversContract
          .connect(spareSigner)
          .registerServerWithProof(registration, ownerSignature, serverSignature),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");
    });

    it("should reclaim a tuple only once", async function () {
      const { serverId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServerByServer(server1, serverId);
      await registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1);
      // Now proven: the next revocation burns it.
      await deregisterServerByServer(server1, serverId);
      await expect(
        registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");
    });

    it("should not let the same owner reclaim its own evicted tuple", async function () {
      // Its old deregistration signatures bind to the id, not the instance,
      // so a same-owner reuse would let them revoke the new record.
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const spare: ServerDeregistration = {
        ownerAddress: serverOwner1.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const spareSignature = await signDeregistration(serverOwner1, spare);
      await deregisterServerByServer(server1, serverId);

      await expect(
        registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");
      // A different tuple works.
      await registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_2);
      await expect(
        serversContract.connect(relayer).deregisterServerWithSignature(spare, spareSignature),
      ).to.be.revertedWithCustomError(serversContract, "StaleServerId");
    });

    it("should reject the squatter's old deregistration signature on the reclaimed record", async function () {
      const { serverId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const squatterDereg: ServerDeregistration = {
        ownerAddress: spareSigner.address,
        serverAddress: server1.address,
        serverId,
        deadline: await futureDeadline(),
      };
      const squatterSignature = await signDeregistration(spareSigner, squatterDereg);
      await deregisterServerByServer(server1, serverId);
      await registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1);

      await expect(
        serversContract
          .connect(spareSigner)
          .deregisterServerWithSignature(squatterDereg, squatterSignature),
      )
        .to.be.revertedWithCustomError(serversContract, "NotServerOwner")
        .withArgs(serverId, spareSigner.address, serverOwner1.address);
    });

    it("should keep an owner-revoked tuple burnt", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await deregisterServer(serverOwner1, server1.address, serverId);
      await expect(
        registerServerWithProof(serverOwner1, server1, PUBLIC_KEY_1, SERVER_URL_1),
      ).to.be.revertedWithCustomError(serversContract, "ServerAlreadyRegistered");
    });

    it("should reject a signature from any key other than serverAddress", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const deregistration: ServerSelfDeregistration = {
        serverAddress: server1.address,
        serverId,
        registeredAtBlock: (await serversContract.getServer(serverId)).registeredAtBlock,
        deadline: await futureDeadline(),
      };
      // Neither a stranger nor the record's owner can use this path.
      for (const signer of [spareSigner, serverOwner1]) {
        const signature = await signSelfDeregistration(signer, deregistration);
        await expect(
          serversContract
            .connect(relayer)
            .deregisterServerByServer(deregistration, signature),
        )
          .to.be.revertedWithCustomError(serversContract, "ServerMismatch")
          .withArgs(server1.address, signer.address);
      }
    });

    it("should revert with DeadlineExpired for an expired deadline", async function () {
      const { serverId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const deregistration: ServerSelfDeregistration = {
        serverAddress: server1.address,
        serverId,
        registeredAtBlock: (await serversContract.getServer(serverId)).registeredAtBlock,
        deadline: await futureDeadline(10),
      };
      const signature = await signSelfDeregistration(server1, deregistration);
      await time.increase(11);
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerByServer(deregistration, signature),
      ).to.be.revertedWithCustomError(serversContract, "DeadlineExpired");
    });

    it("should not replay against a later re-registration of the same address", async function () {
      const { serverId: firstId } = await registerServer(
        serverOwner1,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      const { deregistration, signature } = await deregisterServerByServer(
        server1,
        firstId,
      );

      // Replay with nothing active.
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerByServer(deregistration, signature),
      ).to.be.revertedWithCustomError(serversContract, "ServerNotFound");

      // Replay against a fresh registration.
      const { serverId: secondId } = await registerServerWithProof(
        serverOwner1,
        server1,
        PUBLIC_KEY_1,
        SERVER_URL_2,
      );
      await expect(
        serversContract
          .connect(relayer)
          .deregisterServerByServer(deregistration, signature),
      )
        .to.be.revertedWithCustomError(serversContract, "StaleServerId")
        .withArgs(secondId, firstId);
    });

    it("should work while paused (revoking only removes trust)", async function () {
      const { serverId } = await registerServer(
        spareSigner,
        server1.address,
        PUBLIC_KEY_1,
        SERVER_URL_1,
      );
      await serversContract.connect(maintainer).pause();
      await deregisterServerByServer(server1, serverId).should.be.fulfilled;
      (await serversContract.activeServerId(server1.address)).should.eq(
        ethers.ZeroHash,
      );
    });
  });

  describe("No ERC-2771 (Hashlock M-01)", () => {
    it("exposes no trusted-forwarder surface", async function () {
      (serversContract.interface.getFunction("trustedForwarder") === null).should.eq(true);
      (serversContract.interface.getFunction("updateTrustedForwarder") === null).should.eq(true);
      (serversContract.interface.getFunction("isTrustedForwarder") === null).should.eq(true);
    });

    it("a maintainer cannot become admin by appending an admin's address to calldata", async function () {
      // The audit's PoC minus the forwarder rotation, which no longer exists:
      // role checks read the direct msg.sender, so the suffix is ignored.
      const grantAdminCall = serversContract.interface.encodeFunctionData("grantRole", [
        DEFAULT_ADMIN_ROLE,
        maintainer.address,
      ]);
      await expect(
        maintainer.sendTransaction({
          to: await serversContract.getAddress(),
          data: ethers.concat([grantAdminCall, ethers.solidityPacked(["address"], [owner.address])]),
        }),
      )
        .to.be.revertedWithCustomError(serversContract, "AccessControlUnauthorizedAccount")
        .withArgs(maintainer.address, DEFAULT_ADMIN_ROLE);
      (await serversContract.hasRole(DEFAULT_ADMIN_ROLE, maintainer.address)).should.eq(false);
    });

    it("the same suffix cannot impersonate a maintainer either", async function () {
      await expect(
        relayer.sendTransaction({
          to: await serversContract.getAddress(),
          data: ethers.concat([serversContract.interface.encodeFunctionData("pause"), maintainer.address]),
        }),
      )
        .to.be.revertedWithCustomError(serversContract, "AccessControlUnauthorizedAccount")
        .withArgs(relayer.address, MAINTAINER_ROLE);
      (await serversContract.paused()).should.eq(false);
    });
  });

  describe("Pause / unpause", () => {
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
      (await serversContract.version()).should.eq(2);
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
      (await serversContract.version()).should.eq(2);
    });
  });
});
