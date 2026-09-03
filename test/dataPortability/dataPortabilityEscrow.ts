import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DataPortabilityEscrowImplementation,
  DataPortabilityPermissionsV2Implementation,
  DataPortabilityServersV2Implementation,
  DataRegistryV2Implementation,
  ERC20FeeOnTransferMock,
  ERC20Mock,
  ERC3009Mock,
  NativeRejecterMock,
  OpTargetMock,
} from "../../typechain-types";

chai.use(chaiAsPromised);
should();

describe("DataPortabilityEscrow", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let facilitator: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let payee: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let serverSigner: HardhatEthersSigner;

  let escrow: DataPortabilityEscrowImplementation;
  let token: ERC20Mock;
  let token3009: ERC3009Mock;
  let feeToken: ERC20FeeOnTransferMock;
  let rejecter: NativeRejecterMock;
  let opTarget: OpTargetMock;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const FACILITATOR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("FACILITATOR_ROLE"),
  );
  const NATIVE = ethers.ZeroAddress;
  const ZERO_REF = ethers.ZeroHash;

  // OpKind enum mirror
  const OpKind = {
    Unspecified: 0n,
    DataRegistration: 1n,
    ServerRegistration: 2n,
    BuilderRegistration: 3n,
    GrantRegistration: 4n,
    DataAccess: 5n,
  };

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const parseEther = ethers.parseEther;

  const deploy = async () => {
    [deployer, owner, facilitator, user1, user2, payee, relayer, serverSigner] =
      await ethers.getSigners();

    const EscrowFactory = await ethers.getContractFactory(
      "DataPortabilityEscrowImplementation",
    );
    const escrowDeploy = await upgrades.deployProxy(
      EscrowFactory,
      [owner.address, facilitator.address],
      { kind: "uups" },
    );
    escrow = await ethers.getContractAt(
      "DataPortabilityEscrowImplementation",
      escrowDeploy.target,
    );

    const ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    token = await ERC20MockFactory.deploy("Test Token", "TT");
    await token.waitForDeployment();

    const ERC3009MockFactory = await ethers.getContractFactory("ERC3009Mock");
    token3009 = await ERC3009MockFactory.deploy();
    await token3009.waitForDeployment();

    const FeeTokenFactory = await ethers.getContractFactory(
      "ERC20FeeOnTransferMock",
    );
    feeToken = await FeeTokenFactory.deploy(1000); // 10% fee
    await feeToken.waitForDeployment();

    const RejecterFactory =
      await ethers.getContractFactory("NativeRejecterMock");
    rejecter = await RejecterFactory.deploy();
    await rejecter.waitForDeployment();

    const OpTargetFactory = await ethers.getContractFactory("OpTargetMock");
    opTarget = await OpTargetFactory.deploy();
    await opTarget.waitForDeployment();

    // distribute tokens
    await token.connect(deployer).transfer(user1.address, parseEther("1000"));
    await token.connect(deployer).transfer(user2.address, parseEther("1000"));
    await token3009.mint(user1.address, parseEther("1000"));
    await feeToken.mint(user1.address, parseEther("1000"));
  };

  beforeEach(async () => {
    await loadFixture(deploy);
  });

  const whitelist = async (tokenAddress: string) => {
    await escrow.connect(owner).setTokenWhitelisted(tokenAddress, true);
  };

  const depositNativeFor = async (
    account: HardhatEthersSigner,
    amount: bigint,
  ) => {
    await escrow
      .connect(account)
      .depositNative(account.address, { value: amount });
  };

  const depositTokenFor = async (
    account: HardhatEthersSigner,
    amount: bigint,
  ) => {
    await whitelist(await token.getAddress());
    await token.connect(account).approve(await escrow.getAddress(), amount);
    await escrow
      .connect(account)
      .depositToken(account.address, await token.getAddress(), amount);
  };

  // ---- EIP-3009 signing helper ----
  const sign3009 = async (
    from: HardhatEthersSigner,
    params: {
      account: string;
      value: bigint;
      validAfter?: bigint;
      validBefore?: bigint;
      salt?: string;
    },
  ) => {
    const validAfter = params.validAfter ?? 0n;
    const validBefore =
      params.validBefore ?? BigInt((await time.latest()) + 3600);
    const salt = params.salt ?? ethers.id("default-salt");
    const nonce = ethers.keccak256(
      abiCoder.encode(["address", "bytes32"], [params.account, salt]),
    );

    const domain = {
      name: "Mock USDC",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token3009.getAddress(),
    };
    const types = {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const message = {
      from: from.address,
      to: await escrow.getAddress(),
      value: params.value,
      validAfter,
      validBefore,
      nonce,
    };
    const signature = await from.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);
    return { validAfter, validBefore, salt, nonce, v, r, s };
  };

  describe("Setup", () => {
    it("should set roles and version correctly", async function () {
      (await escrow.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(true);
      (await escrow.hasRole(FACILITATOR_ROLE, facilitator.address)).should.eq(
        true,
      );
      (await escrow.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).should.eq(
        false,
      );
      (await escrow.hasRole(FACILITATOR_ROLE, owner.address)).should.eq(false);
      (await escrow.version()).should.eq(1);
    });

    it("should reject re-initialization", async function () {
      await escrow
        .initialize(owner.address, facilitator.address)
        .should.be.rejectedWith("InvalidInitialization()");
    });

    it("should reject zero addresses in initialize", async function () {
      const EscrowFactory = await ethers.getContractFactory(
        "DataPortabilityEscrowImplementation",
      );
      const impl = await EscrowFactory.deploy();
      await impl.waitForDeployment();
      const ProxyFactory = await ethers.getContractFactory(
        "DataPortabilityEscrowProxy",
      );

      await expect(
        ProxyFactory.deploy(
          await impl.getAddress(),
          EscrowFactory.interface.encodeFunctionData("initialize", [
            ethers.ZeroAddress,
            facilitator.address,
          ]),
        ),
      ).to.be.revertedWithCustomError(EscrowFactory, "ZeroAddress");

      await expect(
        ProxyFactory.deploy(
          await impl.getAddress(),
          EscrowFactory.interface.encodeFunctionData("initialize", [
            owner.address,
            ethers.ZeroAddress,
          ]),
        ),
      ).to.be.revertedWithCustomError(EscrowFactory, "ZeroAddress");
    });

    it("should only allow admin to authorize upgrades", async function () {
      const EscrowFactory = await ethers.getContractFactory(
        "DataPortabilityEscrowImplementation",
      );
      const newImpl = await EscrowFactory.deploy();
      await newImpl.waitForDeployment();

      await expect(
        escrow
          .connect(user1)
          .upgradeToAndCall(await newImpl.getAddress(), "0x"),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );

      await escrow
        .connect(owner)
        .upgradeToAndCall(await newImpl.getAddress(), "0x").should.be.fulfilled;
    });

    it("should only allow admin to pause and unpause", async function () {
      await expect(
        escrow.connect(user1).pause(),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await escrow.connect(owner).pause();
      (await escrow.paused()).should.eq(true);
      await expect(
        escrow.connect(facilitator).unpause(),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await escrow.connect(owner).unpause();
      (await escrow.paused()).should.eq(false);
    });
  });

  describe("Native deposits", () => {
    it("should credit the target account and emit Deposited", async function () {
      const amount = parseEther("5");
      await expect(
        escrow.connect(user1).depositNative(user1.address, { value: amount }),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user1.address, NATIVE, amount);

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(amount);
      (
        await ethers.provider.getBalance(await escrow.getAddress())
      ).should.eq(amount);
    });

    it("should allow depositing on behalf of another account", async function () {
      const amount = parseEther("2");
      await expect(
        escrow.connect(user2).depositNative(user1.address, { value: amount }),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user2.address, user1.address, NATIVE, amount);

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(amount);
      (await escrow.balanceOf(user2.address, NATIVE)).should.eq(0);
    });

    it("should accumulate multiple deposits", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await depositNativeFor(user1, parseEther("2"));
      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("3"),
      );
    });

    it("should reject zero amount", async function () {
      await expect(
        escrow.connect(user1).depositNative(user1.address, { value: 0 }),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("should reject zero account", async function () {
      await expect(
        escrow
          .connect(user1)
          .depositNative(ethers.ZeroAddress, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should reject deposits when paused", async function () {
      await escrow.connect(owner).pause();
      await expect(
        escrow
          .connect(user1)
          .depositNative(user1.address, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("should reject bare native transfers via receive()", async function () {
      await expect(
        user1.sendTransaction({
          to: await escrow.getAddress(),
          value: parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(escrow, "UnexpectedNativeValue");
    });
  });

  describe("Token whitelist", () => {
    it("should only allow admin to update the whitelist", async function () {
      await expect(
        escrow
          .connect(user1)
          .setTokenWhitelisted(await token.getAddress(), true),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should whitelist and un-whitelist with events", async function () {
      const tokenAddress = await token.getAddress();
      await expect(escrow.connect(owner).setTokenWhitelisted(tokenAddress, true))
        .to.emit(escrow, "TokenWhitelistUpdated")
        .withArgs(tokenAddress, true);
      (await escrow.isWhitelistedToken(tokenAddress)).should.eq(true);

      await expect(
        escrow.connect(owner).setTokenWhitelisted(tokenAddress, false),
      )
        .to.emit(escrow, "TokenWhitelistUpdated")
        .withArgs(tokenAddress, false);
      (await escrow.isWhitelistedToken(tokenAddress)).should.eq(false);
    });

    it("should never whitelist the native placeholder address(0)", async function () {
      await expect(
        escrow.connect(owner).setTokenWhitelisted(ethers.ZeroAddress, true),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });
  });

  describe("Token deposits", () => {
    it("should reject non-whitelisted tokens", async function () {
      const tokenAddress = await token.getAddress();
      await token
        .connect(user1)
        .approve(await escrow.getAddress(), parseEther("1"));
      await expect(
        escrow
          .connect(user1)
          .depositToken(user1.address, tokenAddress, parseEther("1")),
      )
        .to.be.revertedWithCustomError(escrow, "AssetNotSupported")
        .withArgs(tokenAddress);
    });

    it("should credit the account and emit Deposited", async function () {
      const tokenAddress = await token.getAddress();
      const amount = parseEther("10");
      await whitelist(tokenAddress);
      await token.connect(user1).approve(await escrow.getAddress(), amount);

      await expect(
        escrow.connect(user1).depositToken(user2.address, tokenAddress, amount),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user2.address, tokenAddress, amount);

      (await escrow.balanceOf(user2.address, tokenAddress)).should.eq(amount);
      (await token.balanceOf(await escrow.getAddress())).should.eq(amount);
    });

    it("should reject zero amount and zero account", async function () {
      const tokenAddress = await token.getAddress();
      await whitelist(tokenAddress);
      await expect(
        escrow.connect(user1).depositToken(user1.address, tokenAddress, 0),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(
        escrow
          .connect(user1)
          .depositToken(ethers.ZeroAddress, tokenAddress, parseEther("1")),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should credit only the received amount for fee-on-transfer tokens", async function () {
      const feeTokenAddress = await feeToken.getAddress();
      const amount = parseEther("100");
      await whitelist(feeTokenAddress);
      await feeToken.connect(user1).approve(await escrow.getAddress(), amount);

      const expected = (amount * 9000n) / 10000n; // 10% fee burned
      await expect(
        escrow
          .connect(user1)
          .depositToken(user1.address, feeTokenAddress, amount),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user1.address, feeTokenAddress, expected);

      (await escrow.balanceOf(user1.address, feeTokenAddress)).should.eq(
        expected,
      );
    });

    it("should reject when nothing is actually received (100% fee)", async function () {
      const feeTokenAddress = await feeToken.getAddress();
      await feeToken.setFeeBps(10000);
      await whitelist(feeTokenAddress);
      await feeToken
        .connect(user1)
        .approve(await escrow.getAddress(), parseEther("1"));
      await expect(
        escrow
          .connect(user1)
          .depositToken(user1.address, feeTokenAddress, parseEther("1")),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("should reject deposits when paused", async function () {
      const tokenAddress = await token.getAddress();
      await whitelist(tokenAddress);
      await token
        .connect(user1)
        .approve(await escrow.getAddress(), parseEther("1"));
      await escrow.connect(owner).pause();
      await expect(
        escrow
          .connect(user1)
          .depositToken(user1.address, tokenAddress, parseEther("1")),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("should keep de-whitelisted funds movable (settle + withdraw) but block new deposits", async function () {
      const tokenAddress = await token.getAddress();
      await depositTokenFor(user1, parseEther("10"));

      await escrow.connect(owner).setTokenWhitelisted(tokenAddress, false);

      // new deposit blocked
      await token
        .connect(user1)
        .approve(await escrow.getAddress(), parseEther("1"));
      await expect(
        escrow
          .connect(user1)
          .depositToken(user1.address, tokenAddress, parseEther("1")),
      ).to.be.revertedWithCustomError(escrow, "AssetNotSupported");

      // settle of already-escrowed funds still works
      await escrow
        .connect(facilitator)
        .settle(
          user1.address,
          payee.address,
          tokenAddress,
          parseEther("4"),
          OpKind.Unspecified,
          ZERO_REF,
        );
      (await token.balanceOf(payee.address)).should.eq(parseEther("4"));

      // withdraw still works
      await escrow
        .connect(facilitator)
        .withdraw(user1.address, tokenAddress, parseEther("6"), ZERO_REF);
      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(0);
    });
  });

  describe("EIP-3009 deposits (depositTokenWithAuthorization)", () => {
    const value = parseEther("50");
    let tokenAddress: string;

    beforeEach(async () => {
      tokenAddress = await token3009.getAddress();
      await whitelist(tokenAddress);
    });

    it("should deposit with a valid authorization submitted by a relayer", async function () {
      const { validAfter, validBefore, salt, nonce, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );

      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user1.address, tokenAddress, value);

      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(value);
      (await token3009.balanceOf(await escrow.getAddress())).should.eq(value);
      (await token3009.authorizationState(user1.address, nonce)).should.eq(
        true,
      );
    });

    it("should support crediting a beneficiary different from the token owner", async function () {
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user2.address, value },
      );

      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user2.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user2.address, tokenAddress, value);

      (await escrow.balanceOf(user2.address, tokenAddress)).should.eq(value);
      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(0);
    });

    it("should reject a relayer that substitutes the beneficiary account", async function () {
      // user1 signs for beneficiary user1, relayer tries to redirect to user2:
      // the recomputed nonce differs from the signed one → token signature check fails.
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );

      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user2.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(
        token3009,
        "InvalidAuthorizationSignature",
      );
    });

    it("should reject replay of a consumed authorization", async function () {
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );
      await escrow
        .connect(relayer)
        .depositTokenWithAuthorization(
          user1.address,
          user1.address,
          tokenAddress,
          value,
          validAfter,
          validBefore,
          salt,
          v,
          r,
          s,
        );

      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(token3009, "AuthorizationAlreadyUsed");
    });

    it("should reject non-whitelisted tokens", async function () {
      await escrow.connect(owner).setTokenWhitelisted(tokenAddress, false);
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "AssetNotSupported");
    });

    it("should reject zero value / zero account / zero from", async function () {
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            0,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            ethers.ZeroAddress,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            ethers.ZeroAddress,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should respect the validity window", async function () {
      const now = BigInt(await time.latest());

      // expired
      let sig = await sign3009(user1, {
        account: user1.address,
        value,
        validBefore: now - 1n,
      });
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            sig.validAfter,
            sig.validBefore,
            sig.salt,
            sig.v,
            sig.r,
            sig.s,
          ),
      ).to.be.revertedWithCustomError(token3009, "AuthorizationExpired");

      // not yet valid
      sig = await sign3009(user1, {
        account: user1.address,
        value,
        validAfter: now + 3600n,
        validBefore: now + 7200n,
      });
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            sig.validAfter,
            sig.validBefore,
            sig.salt,
            sig.v,
            sig.r,
            sig.s,
          ),
      ).to.be.revertedWithCustomError(token3009, "AuthorizationNotYetValid");
    });

    it("should credit only the balance diff when less than value arrives", async function () {
      // The token skims 10% after transfer — natspec: "Balance-diff
      // accounting credits only what actually arrived."
      await token3009.setSkimBps(1000);
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );

      const expected = (value * 9000n) / 10000n;
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(user1.address, user1.address, tokenAddress, expected);

      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(
        expected,
      );
    });

    it("should reject when nothing actually arrives (100% skim)", async function () {
      await token3009.setSkimBps(10000);
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("should reject when paused", async function () {
      const { validAfter, validBefore, salt, v, r, s } = await sign3009(
        user1,
        { account: user1.address, value },
      );
      await escrow.connect(owner).pause();
      await expect(
        escrow
          .connect(relayer)
          .depositTokenWithAuthorization(
            user1.address,
            user1.address,
            tokenAddress,
            value,
            validAfter,
            validBefore,
            salt,
            v,
            r,
            s,
          ),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("Settle", () => {
    it("should only be callable by the facilitator", async function () {
      await depositNativeFor(user1, parseEther("5"));
      await expect(
        escrow
          .connect(user1)
          .settle(
            user1.address,
            payee.address,
            NATIVE,
            parseEther("1"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should debit the account and pay the external recipient (native)", async function () {
      await depositNativeFor(user1, parseEther("5"));
      const ref = ethers.id("grant-1");

      const tx = escrow
        .connect(facilitator)
        .settle(
          user1.address,
          payee.address,
          NATIVE,
          parseEther("2"),
          OpKind.GrantRegistration,
          ref,
        );

      await expect(tx)
        .to.emit(escrow, "Settled")
        .withArgs(
          user1.address,
          payee.address,
          ref,
          NATIVE,
          parseEther("2"),
          OpKind.GrantRegistration,
        );
      await expect(tx).to.changeEtherBalances(
        [payee, escrow],
        [parseEther("2"), -parseEther("2")],
      );

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("3"),
      );
    });

    it("should debit the account and pay the external recipient (ERC20)", async function () {
      await depositTokenFor(user1, parseEther("10"));
      const tokenAddress = await token.getAddress();

      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            payee.address,
            tokenAddress,
            parseEther("4"),
            OpKind.DataAccess,
            ZERO_REF,
          ),
      )
        .to.emit(escrow, "Settled")
        .withArgs(
          user1.address,
          payee.address,
          ZERO_REF,
          tokenAddress,
          parseEther("4"),
          OpKind.DataAccess,
        );

      (await token.balanceOf(payee.address)).should.eq(parseEther("4"));
      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(
        parseEther("6"),
      );
    });

    it("should reject on insufficient balance with details", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            payee.address,
            NATIVE,
            parseEther("2"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      )
        .to.be.revertedWithCustomError(escrow, "InsufficientBalance")
        .withArgs(user1.address, NATIVE, parseEther("2"), parseEther("1"));
    });

    it("should reject zero amount and zero addresses", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            payee.address,
            NATIVE,
            0,
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            ethers.ZeroAddress,
            payee.address,
            NATIVE,
            parseEther("1"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            ethers.ZeroAddress,
            NATIVE,
            parseEther("1"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should surface NativeTransferFailed for rejecting recipients", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            await rejecter.getAddress(),
            NATIVE,
            parseEther("1"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(escrow, "NativeTransferFailed");
    });

    it("should reject when paused", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await escrow.connect(owner).pause();
      await expect(
        escrow
          .connect(facilitator)
          .settle(
            user1.address,
            payee.address,
            NATIVE,
            parseEther("1"),
            OpKind.Unspecified,
            ZERO_REF,
          ),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("SettleBatch", () => {
    it("should execute multiple ops across assets and emit one Settled each", async function () {
      await depositNativeFor(user1, parseEther("5"));
      await depositTokenFor(user2, parseEther("10"));
      const tokenAddress = await token.getAddress();

      const refA = ethers.id("ref-a");
      const refB = ethers.id("ref-b");
      const tx = escrow.connect(facilitator).settleBatch([
        {
          from: user1.address,
          to: payee.address,
          asset: NATIVE,
          amount: parseEther("1"),
          opKind: OpKind.GrantRegistration,
          ref: refA,
        },
        {
          from: user2.address,
          to: payee.address,
          asset: tokenAddress,
          amount: parseEther("3"),
          opKind: OpKind.DataAccess,
          ref: refB,
        },
      ]);

      await expect(tx)
        .to.emit(escrow, "Settled")
        .withArgs(
          user1.address,
          payee.address,
          refA,
          NATIVE,
          parseEther("1"),
          OpKind.GrantRegistration,
        );
      await expect(tx)
        .to.emit(escrow, "Settled")
        .withArgs(
          user2.address,
          payee.address,
          refB,
          tokenAddress,
          parseEther("3"),
          OpKind.DataAccess,
        );

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("4"),
      );
      (await escrow.balanceOf(user2.address, tokenAddress)).should.eq(
        parseEther("7"),
      );
    });

    it("should be atomic — a failing op reverts the whole batch", async function () {
      await depositNativeFor(user1, parseEther("5"));

      await expect(
        escrow.connect(facilitator).settleBatch([
          {
            from: user1.address,
            to: payee.address,
            asset: NATIVE,
            amount: parseEther("1"),
            opKind: OpKind.Unspecified,
            ref: ZERO_REF,
          },
          {
            from: user2.address, // nothing deposited
            to: payee.address,
            asset: NATIVE,
            amount: parseEther("1"),
            opKind: OpKind.Unspecified,
            ref: ZERO_REF,
          },
        ]),
      ).to.be.revertedWithCustomError(escrow, "InsufficientBalance");

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("5"),
      );
    });

    it("should accept an empty batch as a no-op", async function () {
      await escrow.connect(facilitator).settleBatch([]).should.be.fulfilled;
    });

    it("should only be callable by the facilitator", async function () {
      await expect(
        escrow.connect(user1).settleBatch([]),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should reject when paused", async function () {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(facilitator).settleBatch([]),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("Withdraw", () => {
    it("should return funds to the account holder (native)", async function () {
      await depositNativeFor(user1, parseEther("3"));
      const ref = ethers.id("refund-1");

      const tx = escrow
        .connect(facilitator)
        .withdraw(user1.address, NATIVE, parseEther("3"), ref);

      await expect(tx)
        .to.emit(escrow, "Withdrawn")
        .withArgs(user1.address, NATIVE, parseEther("3"), ref);
      await expect(tx).to.changeEtherBalances(
        [user1, escrow],
        [parseEther("3"), -parseEther("3")],
      );
      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(0);
    });

    it("should return funds to the account holder (ERC20)", async function () {
      await depositTokenFor(user1, parseEther("10"));
      const tokenAddress = await token.getAddress();
      const before = await token.balanceOf(user1.address);

      await escrow
        .connect(facilitator)
        .withdraw(user1.address, tokenAddress, parseEther("10"), ZERO_REF);

      (await token.balanceOf(user1.address)).should.eq(
        before + parseEther("10"),
      );
      (await escrow.balanceOf(user1.address, tokenAddress)).should.eq(0);
    });

    it("should reject on insufficient balance", async function () {
      await expect(
        escrow
          .connect(facilitator)
          .withdraw(user1.address, NATIVE, parseEther("1"), ZERO_REF),
      ).to.be.revertedWithCustomError(escrow, "InsufficientBalance");
    });

    it("should only be callable by the facilitator", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await expect(
        escrow
          .connect(user1)
          .withdraw(user1.address, NATIVE, parseEther("1"), ZERO_REF),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should reject when paused", async function () {
      await depositNativeFor(user1, parseEther("1"));
      await escrow.connect(owner).pause();
      await expect(
        escrow
          .connect(facilitator)
          .withdraw(user1.address, NATIVE, parseEther("1"), ZERO_REF),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("Cross-contract wiring (setPermissions / setDataRegistry)", () => {
    it("should be admin-only and reject zero addresses", async function () {
      await expect(
        escrow.connect(user1).setPermissions(user2.address),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await expect(
        escrow.connect(owner).setPermissions(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
      await expect(
        escrow.connect(user1).setDataRegistry(user2.address),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await expect(
        escrow.connect(owner).setDataRegistry(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should emit update events with previous and current values", async function () {
      await expect(escrow.connect(owner).setPermissions(user2.address))
        .to.emit(escrow, "PermissionsUpdated")
        .withArgs(ethers.ZeroAddress, user2.address);
      await expect(escrow.connect(owner).setPermissions(user1.address))
        .to.emit(escrow, "PermissionsUpdated")
        .withArgs(user2.address, user1.address);
      (await escrow.permissions()).should.eq(user1.address);

      await expect(escrow.connect(owner).setDataRegistry(user2.address))
        .to.emit(escrow, "DataRegistryUpdated")
        .withArgs(ethers.ZeroAddress, user2.address);
      (await escrow.dataRegistry()).should.eq(user2.address);
    });
  });

  describe("Op allowlist (setOpAllowed)", () => {
    let target: string;
    let pokeSelector: string;
    let failSelector: string;

    beforeEach(async () => {
      target = await opTarget.getAddress();
      pokeSelector = opTarget.interface.getFunction("poke").selector;
      failSelector = opTarget.interface.getFunction("fail").selector;
    });

    it("should be admin-only and reject a zero target", async function () {
      await expect(
        escrow.connect(user1).setOpAllowed(target, pokeSelector, true),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
      await expect(
        escrow
          .connect(owner)
          .setOpAllowed(ethers.ZeroAddress, pokeSelector, true),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should manage the selector and target sets", async function () {
      await expect(escrow.connect(owner).setOpAllowed(target, pokeSelector, true))
        .to.emit(escrow, "OpAllowed")
        .withArgs(target, pokeSelector);

      (await escrow.isAllowedOp(target, pokeSelector)).should.eq(true);
      [...(await escrow.getAllowedTargets())].should.deep.eq([target]);
      [...(await escrow.getAllowedSelectors(target))].should.deep.eq([
        pokeSelector,
      ]);

      // second selector, same target — target list unchanged
      await escrow.connect(owner).setOpAllowed(target, failSelector, true);
      [...(await escrow.getAllowedTargets())].should.deep.eq([target]);
      [...(await escrow.getAllowedSelectors(target))].should.have.members([
        pokeSelector,
        failSelector,
      ]);

      // removing one selector keeps the target
      await expect(
        escrow.connect(owner).setOpAllowed(target, pokeSelector, false),
      )
        .to.emit(escrow, "OpDisallowed")
        .withArgs(target, pokeSelector);
      [...(await escrow.getAllowedTargets())].should.deep.eq([target]);

      // removing the last selector drops the target
      await escrow.connect(owner).setOpAllowed(target, failSelector, false);
      [...(await escrow.getAllowedTargets())].should.deep.eq([]);
      [...(await escrow.getAllowedSelectors(target))].should.deep.eq([]);
    });

    it("should be idempotent without spurious events", async function () {
      await escrow.connect(owner).setOpAllowed(target, pokeSelector, true);
      await expect(
        escrow.connect(owner).setOpAllowed(target, pokeSelector, true),
      ).to.not.emit(escrow, "OpAllowed");

      await expect(
        escrow.connect(owner).setOpAllowed(target, failSelector, false),
      ).to.not.emit(escrow, "OpDisallowed");
    });
  });

  describe("runOpAndSettle", () => {
    let target: string;
    let pokeSelector: string;

    beforeEach(async () => {
      target = await opTarget.getAddress();
      pokeSelector = opTarget.interface.getFunction("poke").selector;
      await escrow.connect(owner).setOpAllowed(target, pokeSelector, true);
      await depositNativeFor(user1, parseEther("5"));
    });

    it("should only be callable by the facilitator", async function () {
      const callData = opTarget.interface.encodeFunctionData("poke", [41]);
      await expect(
        escrow.connect(user1).runOpAndSettle(target, callData, []),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should reject calldata shorter than a selector", async function () {
      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, "0x112233", []),
      ).to.be.revertedWithCustomError(escrow, "CallDataTooShort");
    });

    it("should accept exactly-4-byte calldata past the length check (boundary)", async function () {
      // A bare non-allowed selector: 4 bytes must clear CallDataTooShort and
      // fail on the ALLOWLIST instead — proving the boundary is `< 4`.
      const failSelector = opTarget.interface.getFunction("fail").selector;
      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, failSelector, []),
      )
        .to.be.revertedWithCustomError(escrow, "OpNotAllowed")
        .withArgs(target, failSelector);
    });

    it("should return the target's raw return data", async function () {
      const callData = opTarget.interface.encodeFunctionData("poke", [41]);
      const returnData = await escrow
        .connect(facilitator)
        .runOpAndSettle.staticCall(target, callData, []);
      returnData.should.eq(abiCoder.encode(["uint256"], [42]));
    });

    it("should reject non-allowlisted (target, selector) pairs", async function () {
      const callData = opTarget.interface.encodeFunctionData("fail", [1]);
      const failSelector = opTarget.interface.getFunction("fail").selector;
      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, callData, []),
      )
        .to.be.revertedWithCustomError(escrow, "OpNotAllowed")
        .withArgs(target, failSelector);
    });

    it("should scope the allowlist by target, not just selector", async function () {
      // `poke` is allowed on `target` — the same selector on a different
      // target must be rejected.
      const OpTargetFactory = await ethers.getContractFactory("OpTargetMock");
      const otherTarget = await OpTargetFactory.deploy();
      await otherTarget.waitForDeployment();
      const otherAddress = await otherTarget.getAddress();

      (await escrow.isAllowedOp(otherAddress, pokeSelector)).should.eq(false);

      const callData = opTarget.interface.encodeFunctionData("poke", [1]);
      await expect(
        escrow.connect(facilitator).runOpAndSettle(otherAddress, callData, []),
      )
        .to.be.revertedWithCustomError(escrow, "OpNotAllowed")
        .withArgs(otherAddress, pokeSelector);
    });

    it("should dispatch the call, emit OpExecuted, and run the settles", async function () {
      const callData = opTarget.interface.encodeFunctionData("poke", [41]);
      const ref = ethers.id("op-ref");
      const expectedReturn = abiCoder.encode(["uint256"], [42]);

      const tx = escrow.connect(facilitator).runOpAndSettle(target, callData, [
        {
          from: user1.address,
          to: payee.address,
          asset: NATIVE,
          amount: parseEther("1"),
          opKind: OpKind.DataRegistration,
          ref,
        },
      ]);

      await expect(tx)
        .to.emit(escrow, "OpExecuted")
        .withArgs(target, pokeSelector, expectedReturn);
      await expect(tx)
        .to.emit(opTarget, "Poked")
        .withArgs(await escrow.getAddress(), 0, 41);
      await expect(tx)
        .to.emit(escrow, "Settled")
        .withArgs(
          user1.address,
          payee.address,
          ref,
          NATIVE,
          parseEther("1"),
          OpKind.DataRegistration,
        );

      (await opTarget.lastX()).should.eq(41);
      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("4"),
      );
    });

    it("should bubble the target's typed revert", async function () {
      const failSelector = opTarget.interface.getFunction("fail").selector;
      await escrow.connect(owner).setOpAllowed(target, failSelector, true);
      const callData = opTarget.interface.encodeFunctionData("fail", [7]);

      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, callData, []),
      )
        .to.be.revertedWithCustomError(opTarget, "TypedFailure")
        .withArgs(7);
    });

    it("should revert the op when a settle fails (atomicity)", async function () {
      const callData = opTarget.interface.encodeFunctionData("poke", [99]);
      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, callData, [
          {
            from: user1.address,
            to: payee.address,
            asset: NATIVE,
            amount: parseEther("100"), // more than deposited
            opKind: OpKind.Unspecified,
            ref: ZERO_REF,
          },
        ]),
      ).to.be.revertedWithCustomError(escrow, "InsufficientBalance");

      // target state rolled back too
      (await opTarget.lastX()).should.eq(0);
    });

    it("should reject when paused", async function () {
      const callData = opTarget.interface.encodeFunctionData("poke", [1]);
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(facilitator).runOpAndSettle(target, callData, []),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("registerAndSettle (integration with PermissionsV2)", () => {
    let permissions: DataPortabilityPermissionsV2Implementation;
    const granteeId = ethers.id("grantee-1");
    const scopes = ["scope.read", "scope.write"];

    const signGrant = async (
      grantor: HardhatEthersSigner,
      grantVersion: bigint,
      expiresAt: bigint,
      signer: HardhatEthersSigner = grantor,
    ) => {
      const domain = {
        name: "Vana Data Portability",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await permissions.getAddress(),
      };
      const types = {
        GrantRegistration: [
          { name: "grantorAddress", type: "address" },
          { name: "granteeId", type: "bytes32" },
          { name: "scopes", type: "string[]" },
          { name: "grantVersion", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
        ],
      };
      const input = {
        grantorAddress: grantor.address,
        granteeId,
        scopes,
        grantVersion,
        expiresAt,
      };
      const signature = await signer.signTypedData(domain, types, input);
      return { input, signature };
    };

    beforeEach(async () => {
      const PermissionsFactory = await ethers.getContractFactory(
        "DataPortabilityPermissionsV2Implementation",
      );
      const permissionsDeploy = await upgrades.deployProxy(
        PermissionsFactory,
        [owner.address],
        { kind: "uups" },
      );
      permissions = await ethers.getContractAt(
        "DataPortabilityPermissionsV2Implementation",
        permissionsDeploy.target,
      );
      await depositNativeFor(user1, parseEther("5"));
    });

    it("should revert when the permissions contract is unset", async function () {
      const { input, signature } = await signGrant(user1, 1n, 0n);
      await expect(
        escrow.connect(facilitator).registerAndSettle(input, signature, []),
      ).to.be.revertedWithCustomError(escrow, "PermissionsNotSet");
    });

    it("should register the permission and run payouts atomically", async function () {
      await escrow
        .connect(owner)
        .setPermissions(await permissions.getAddress());
      const { input, signature } = await signGrant(user1, 1n, 0n);

      const expectedGrantId = await permissions.grantId(
        user1.address,
        granteeId,
      );
      const returnedGrantId = await escrow
        .connect(facilitator)
        .registerAndSettle.staticCall(input, signature, []);
      returnedGrantId.should.eq(expectedGrantId);

      const tx = escrow.connect(facilitator).registerAndSettle(input, signature, [
        {
          from: user1.address,
          to: payee.address,
          asset: NATIVE,
          amount: parseEther("1"),
          opKind: OpKind.GrantRegistration,
          ref: expectedGrantId,
        },
      ]);

      await expect(tx)
        .to.emit(permissions, "PermissionSet")
        .withArgs(expectedGrantId, user1.address, granteeId, scopes, 1n, 0n);
      await expect(tx)
        .to.emit(escrow, "Settled")
        .withArgs(
          user1.address,
          payee.address,
          expectedGrantId,
          NATIVE,
          parseEther("1"),
          OpKind.GrantRegistration,
        );
      await expect(tx).to.changeEtherBalances([payee], [parseEther("1")]);

      const stored = await permissions.permissions(expectedGrantId);
      stored.grantorAddress.should.eq(user1.address);
      stored.granteeId.should.eq(granteeId);
      (await permissions.isActive(expectedGrantId)).should.eq(true);
      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("4"),
      );
    });

    it("should revert the whole bundle on a bad grant signature", async function () {
      await escrow
        .connect(owner)
        .setPermissions(await permissions.getAddress());
      // user2 signs user1's exact payload — recovers to user2, not the
      // claimed grantor → GrantorMismatch inside permissions.
      const { input, signature: wrongSignature } = await signGrant(
        user1,
        1n,
        0n,
        user2,
      );

      await expect(
        escrow.connect(facilitator).registerAndSettle(input, wrongSignature, [
          {
            from: user1.address,
            to: payee.address,
            asset: NATIVE,
            amount: parseEther("1"),
            opKind: OpKind.GrantRegistration,
            ref: ZERO_REF,
          },
        ]),
      )
        .to.be.revertedWithCustomError(permissions, "GrantorMismatch")
        .withArgs(user1.address, user2.address);

      (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
        parseEther("5"),
      );
    });

    it("should not register the permission when a payout fails", async function () {
      await escrow
        .connect(owner)
        .setPermissions(await permissions.getAddress());
      const { input, signature } = await signGrant(user1, 1n, 0n);
      const id = await permissions.grantId(user1.address, granteeId);

      await expect(
        escrow.connect(facilitator).registerAndSettle(input, signature, [
          {
            from: user1.address,
            to: payee.address,
            asset: NATIVE,
            amount: parseEther("100"), // more than escrowed
            opKind: OpKind.GrantRegistration,
            ref: id,
          },
        ]),
      ).to.be.revertedWithCustomError(escrow, "InsufficientBalance");

      (await permissions.isActive(id)).should.eq(false);
      (await permissions.permissions(id)).grantorAddress.should.eq(
        ethers.ZeroAddress,
      );
    });

    it("should only be callable by the facilitator and respect pause", async function () {
      await escrow
        .connect(owner)
        .setPermissions(await permissions.getAddress());
      const { input, signature } = await signGrant(user1, 1n, 0n);

      await expect(
        escrow.connect(user1).registerAndSettle(input, signature, []),
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount",
      );

      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(facilitator).registerAndSettle(input, signature, []),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });
  });

  describe("recordAccessAndSettle (integration with DataRegistryV2)", () => {
    let servers: DataPortabilityServersV2Implementation;
    let registry: DataRegistryV2Implementation;
    const scope = "vana.profile";
    const dataHash = ethers.id("data-1");
    const metadataHash = ethers.id("meta-1");

    const signRecordAccess = async (
      signer: HardhatEthersSigner,
      params: {
        ownerAddress: string;
        version: bigint;
        accessor: string;
        recordId: string;
      },
    ) => {
      const domain = {
        name: "Vana Data Portability",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await registry.getAddress(),
      };
      const types = {
        RecordDataAccess: [
          { name: "ownerAddress", type: "address" },
          { name: "scope", type: "string" },
          { name: "version", type: "uint256" },
          { name: "accessor", type: "address" },
          { name: "recordId", type: "bytes32" },
        ],
      };
      return signer.signTypedData(domain, types, {
        ownerAddress: params.ownerAddress,
        scope,
        version: params.version,
        accessor: params.accessor,
        recordId: params.recordId,
      });
    };

    beforeEach(async () => {
      // Deploy servers registry and data registry, wire everything together.
      const ServersFactory = await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      );
      const serversDeploy = await upgrades.deployProxy(
        ServersFactory,
        [ethers.ZeroAddress, owner.address],
        { kind: "uups" },
      );
      servers = await ethers.getContractAt(
        "DataPortabilityServersV2Implementation",
        serversDeploy.target,
      );

      const RegistryFactory = await ethers.getContractFactory(
        "DataRegistryV2Implementation",
      );
      const registryDeploy = await upgrades.deployProxy(
        RegistryFactory,
        [owner.address],
        { kind: "uups" },
      );
      registry = await ethers.getContractAt(
        "DataRegistryV2Implementation",
        registryDeploy.target,
      );

      await registry
        .connect(owner)
        .setDataPortabilityServers(await servers.getAddress());
      await registry
        .connect(owner)
        .grantRole(
          await registry.ACCESS_RECORDER_ROLE(),
          await escrow.getAddress(),
        );

      // user1 registers serverSigner as their trusted personal server.
      const domain = {
        name: "Vana Data Portability",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await servers.getAddress(),
      };
      const registration = {
        ownerAddress: user1.address,
        serverAddress: serverSigner.address,
        publicKey: "pubkey-1",
        serverUrl: "https://server.example",
      };
      const regSignature = await user1.signTypedData(
        domain,
        {
          ServerRegistration: [
            { name: "ownerAddress", type: "address" },
            { name: "serverAddress", type: "address" },
            { name: "publicKey", type: "string" },
            { name: "serverUrl", type: "string" },
          ],
        },
        registration,
      );
      await servers
        .connect(relayer)
        .registerServerWithSignature(registration, regSignature);

      // user1 creates the data point (version 1).
      await registry.connect(user1).addData(scope, dataHash, metadataHash);

      // escrow funding for payouts
      await depositNativeFor(user1, parseEther("5"));
    });

    it("should revert when the data registry is unset", async function () {
      const recordId = ethers.id("record-0");
      const signature = await signRecordAccess(serverSigner, {
        ownerAddress: user1.address,
        version: 1n,
        accessor: user2.address,
        recordId,
      });
      await expect(
        escrow
          .connect(facilitator)
          .recordAccessAndSettle(
            user1.address,
            scope,
            1n,
            user2.address,
            recordId,
            signature,
            [],
          ),
      ).to.be.revertedWithCustomError(escrow, "DataRegistryNotSet");
    });

    describe("with registry wired", () => {
      beforeEach(async () => {
        await escrow
          .connect(owner)
          .setDataRegistry(await registry.getAddress());
      });

      it("should record the access and run payouts atomically", async function () {
        const recordId = ethers.id("record-1");
        const grantRef = ethers.id("grant-ref");
        const signature = await signRecordAccess(serverSigner, {
          ownerAddress: user1.address,
          version: 1n,
          accessor: user2.address,
          recordId,
        });

        const id = await registry.dataPointId(user1.address, scope);
        const tx = escrow
          .connect(facilitator)
          .recordAccessAndSettle(
            user1.address,
            scope,
            1n,
            user2.address,
            recordId,
            signature,
            [
              {
                from: user1.address,
                to: payee.address,
                asset: NATIVE,
                amount: parseEther("1"),
                opKind: OpKind.DataAccess,
                ref: grantRef,
              },
            ],
          );

        await expect(tx)
          .to.emit(registry, "DataAccessRecorded")
          .withArgs(
            id,
            1n,
            user2.address,
            serverSigner.address,
            recordId,
            1n,
            1n,
          );
        await expect(tx)
          .to.emit(escrow, "Settled")
          .withArgs(
            user1.address,
            payee.address,
            grantRef,
            NATIVE,
            parseEther("1"),
            OpKind.DataAccess,
          );

        (await registry.totalAccesses(user1.address, scope)).should.eq(1);
        (await registry.accessCount(user1.address, scope, 1)).should.eq(1);
        (await registry.isRecordIdUsed(recordId)).should.eq(true);
        (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
          parseEther("4"),
        );
      });

      it("should reject a duplicate recordId and roll back the payouts", async function () {
        const recordId = ethers.id("record-2");
        const signature = await signRecordAccess(serverSigner, {
          ownerAddress: user1.address,
          version: 1n,
          accessor: user2.address,
          recordId,
        });

        await escrow
          .connect(facilitator)
          .recordAccessAndSettle(
            user1.address,
            scope,
            1n,
            user2.address,
            recordId,
            signature,
            [],
          );

        await expect(
          escrow
            .connect(facilitator)
            .recordAccessAndSettle(
              user1.address,
              scope,
              1n,
              user2.address,
              recordId,
              signature,
              [
                {
                  from: user1.address,
                  to: payee.address,
                  asset: NATIVE,
                  amount: parseEther("1"),
                  opKind: OpKind.DataAccess,
                  ref: ZERO_REF,
                },
              ],
            ),
        ).to.be.revertedWithCustomError(registry, "RecordIdAlreadyUsed");

        (await escrow.balanceOf(user1.address, NATIVE)).should.eq(
          parseEther("5"),
        );
        (await registry.totalAccesses(user1.address, scope)).should.eq(1);
      });

      it("should not record the access when a payout fails", async function () {
        const recordId = ethers.id("record-3");
        const signature = await signRecordAccess(serverSigner, {
          ownerAddress: user1.address,
          version: 1n,
          accessor: user2.address,
          recordId,
        });

        await expect(
          escrow
            .connect(facilitator)
            .recordAccessAndSettle(
              user1.address,
              scope,
              1n,
              user2.address,
              recordId,
              signature,
              [
                {
                  from: user1.address,
                  to: payee.address,
                  asset: NATIVE,
                  amount: parseEther("100"),
                  opKind: OpKind.DataAccess,
                  ref: ZERO_REF,
                },
              ],
            ),
        ).to.be.revertedWithCustomError(escrow, "InsufficientBalance");

        (await registry.isRecordIdUsed(recordId)).should.eq(false);
        (await registry.totalAccesses(user1.address, scope)).should.eq(0);
      });

      it("should bubble UntrustedServer for signatures from unregistered keys", async function () {
        const recordId = ethers.id("record-4");
        const signature = await signRecordAccess(user2, {
          ownerAddress: user1.address,
          version: 1n,
          accessor: user2.address,
          recordId,
        });

        await expect(
          escrow
            .connect(facilitator)
            .recordAccessAndSettle(
              user1.address,
              scope,
              1n,
              user2.address,
              recordId,
              signature,
              [],
            ),
        ).to.be.revertedWithCustomError(registry, "UntrustedServer");
      });

      it("should only be callable by the facilitator and respect pause", async function () {
        const recordId = ethers.id("record-5");
        const signature = await signRecordAccess(serverSigner, {
          ownerAddress: user1.address,
          version: 1n,
          accessor: user2.address,
          recordId,
        });

        await expect(
          escrow
            .connect(user1)
            .recordAccessAndSettle(
              user1.address,
              scope,
              1n,
              user2.address,
              recordId,
              signature,
              [],
            ),
        ).to.be.revertedWithCustomError(
          escrow,
          "AccessControlUnauthorizedAccount",
        );

        await escrow.connect(owner).pause();
        await expect(
          escrow
            .connect(facilitator)
            .recordAccessAndSettle(
              user1.address,
              scope,
              1n,
              user2.address,
              recordId,
              signature,
              [],
            ),
        ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
      });
    });
  });
});
