import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
    QueryEngineImplementation,
    ComputeEngineImplementation,
    DataAccessTreasuryImplementation,
    DataAccessTreasuryProxyFactory,
    DataRefinerRegistryImplementation,
    ComputeInstructionRegistryImplementation,
    ComputeEngineTeePoolFactoryImplementation,
    ComputeEngineTeePoolProxyFactory,
    DLPRootCoreMock
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { keccak256, ZeroAddress } from "ethers";

chai.use(chaiAsPromised);
should();

describe("QueryEngine", () => {
    const dlpPaymentPercentage = parseEther(80);
    const ephemeralTimeout = 5 * 60; // 5 minutes
    const persistentTimeout = 2 * 60 * 60; // 2 hours

    const VanaToken = ethers.ZeroAddress;

    const TeePoolType = {
        None: 0,
        Ephemeral: 1,
        Persistent: 2,
        Dedicated: 3,
    };

    const HardwareType = {
        None: 0,
        Standard: 1, // CPU only
        GPU: 2,
    };

    const TeeStatus = {
        None: 0,
        Active: 1,
        Removed: 2,
    };

    let owner: HardhatEthersSigner;
    let maintainer: HardhatEthersSigner;
    let queryEngineTEE: HardhatEthersSigner;
    let computeEngineTEE: HardhatEthersSigner;
    let vanaTreasury: HardhatEthersSigner;
    let dlp1Owner: HardhatEthersSigner;
    let dlp2Owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    let queryEngine: QueryEngineImplementation;
    let computeEngine: ComputeEngineImplementation;
    let dataAccessTreasuryImpl: DataAccessTreasuryImplementation;
    let dataAccessTreasuryFactory: DataAccessTreasuryProxyFactory;
    let queryEngineTreasury: DataAccessTreasuryImplementation;
    let computeEngineTreasury: DataAccessTreasuryImplementation;
    let dataRefinerRegistry: DataRefinerRegistryImplementation;
    let computeInstructionRegistry: ComputeInstructionRegistryImplementation;
    let dlpRootCoreMock: DLPRootCoreMock;
    let teePoolFactory: ComputeEngineTeePoolFactoryImplementation;
    let teePoolProxyFactory: ComputeEngineTeePoolProxyFactory;

    const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const MAINTAINER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("MAINTAINER_ROLE"),
    );
    const QUERY_ENGINE_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("QUERY_ENGINE_ROLE"),
    );
    const CUSTODIAN_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("CUSTODIAN_ROLE"),
    );

    const deploy = async () => {
        [
            owner,
            maintainer,
            queryEngineTEE,
            computeEngineTEE,
            vanaTreasury,
            dlp1Owner,
            dlp2Owner,
            user1,
            user2,
        ] = await ethers.getSigners();

        const dlpRootCoreMockFactory = await ethers.getContractFactory("DLPRootCoreMock");
        dlpRootCoreMock = await dlpRootCoreMockFactory.deploy();

        await dlpRootCoreMock.connect(dlp1Owner).registerDlp();

        await dlpRootCoreMock.connect(dlp1Owner).updateDlpTreasuryAddress(1, dlp1Owner.address);

        await dlpRootCoreMock.connect(dlp2Owner).registerDlp();

        // Deploy DataRefinerRegistry
        const dataRefinerRegistryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("DataRefinerRegistryImplementation"),
            [owner.address, dlpRootCoreMock.target],
            {
                kind: "uups",
            },
        );

        dataRefinerRegistry = await ethers.getContractAt(
            "DataRefinerRegistryImplementation",
            dataRefinerRegistryDeploy.target,
        );

        // Deploy ComputeInstructionRegistryImplementation
        const computeInstructionRegistryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeInstructionRegistryImplementation"),
            [owner.address, dlpRootCoreMock.target],
            {
                kind: "uups",
            },
        );

        computeInstructionRegistry = await ethers.getContractAt(
            "ComputeInstructionRegistryImplementation",
            computeInstructionRegistryDeploy.target,
        );

        // Deploy DataAccessTreasuryProxyFactory
        dataAccessTreasuryImpl = await ethers.deployContract(
            "DataAccessTreasuryImplementation",
        );

        dataAccessTreasuryFactory = await ethers.deployContract(
            "DataAccessTreasuryProxyFactory",
            [dataAccessTreasuryImpl.target, owner.address],
        );

        // Deploy QueryEngine
        const queryEngineDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("QueryEngineImplementation"),
            [owner.address, dataRefinerRegistry.target, dataAccessTreasuryFactory.target],
            {
                kind: "uups",
            },
        );

        queryEngine = await ethers.getContractAt(
            "QueryEngineImplementation",
            queryEngineDeploy.target,
        );

        queryEngineTreasury = await ethers.getContractAt(
            "DataAccessTreasuryImplementation",
            await queryEngine.queryEngineTreasury(),
        );

        // Deploy ComputeEngineTeePoolProxyFactory
        const teePoolImpl = await ethers.deployContract(
            "ComputeEngineTeePoolImplementation",
        );

        teePoolProxyFactory = await ethers.deployContract(
            "ComputeEngineTeePoolProxyFactory",
            [teePoolImpl.target, owner.address],
        );

        // Deploy ComputeEngineTeePoolFactory
        const teePoolFactoryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeEngineTeePoolFactoryImplementation"),
            [owner.address, teePoolProxyFactory.target, ephemeralTimeout, persistentTimeout],
            {
                kind: "uups",
            },
        );

        teePoolFactory = await ethers.getContractAt(
            "ComputeEngineTeePoolFactoryImplementation",
            teePoolFactoryDeploy.target,
        );

        await teePoolFactory
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);

        // Deploy ComputeEngine
        const computeEngineDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeEngineImplementation"),
            [owner.address, queryEngine.target, teePoolFactory.target, dataAccessTreasuryFactory.target],
            {
                kind: "uups",
            },
        );

        computeEngine = await ethers.getContractAt(
            "ComputeEngineImplementation",
            computeEngineDeploy.target,
        );

        await teePoolFactory
            .connect(maintainer)
            .updateComputeEngine(computeEngine.target);

        await computeEngine
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);

        computeEngineTreasury = await ethers.getContractAt(
            "DataAccessTreasuryImplementation",
            await computeEngine.computeEngineTreasury(),
        );

        await computeEngine
            .connect(maintainer)
            .updateInstructionRegistry(computeInstructionRegistry.target);

        // Set up QueryEngine
        await queryEngine
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);

        await queryEngine.connect(owner).grantRole(QUERY_ENGINE_ROLE, queryEngineTEE.address);

        await queryEngine.connect(owner).updateDlpPaymentPercentage(dlpPaymentPercentage);

        await queryEngine.connect(owner).updateVanaTreasury(vanaTreasury.address);

        await queryEngine.connect(owner).updateComputeEngine(computeEngine.target);
    };

    describe("Setup", () => {
        beforeEach(async () => {
            await deploy();
        });

        it("should have correct params after deploy", async function () {
            (await queryEngine.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
            (await queryEngine.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
            (await queryEngine.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(true);
            (await queryEngine.hasRole(QUERY_ENGINE_ROLE, queryEngineTEE)).should.eq(true);
            (await queryEngine.version()).should.eq(1);
            (await queryEngine.refinerRegistry()).should.eq(dataRefinerRegistry);
            (await queryEngine.dlpPaymentPercentage()).should.eq(dlpPaymentPercentage);
            (await queryEngine.vanaTreasury()).should.eq(vanaTreasury.address);
            (await queryEngine.computeEngine()).should.eq(computeEngine.target);
            (await queryEngineTreasury.custodian()).should.eq(queryEngine.target);
        });

        it("should have correct treasury addresses after deploy", async function () {
            // initialize function of DataAccessTreasuryImplementation
            const dataAccessTreasuryAbi = [
                "function initialize(address ownerAddress, address custodian)",
            ];
            const dataAccessTreasuryIface = new ethers.Interface(dataAccessTreasuryAbi);
            const beaconProxyFactory = await ethers.getContractFactory("BeaconProxy");

            const queryEngineTreasuryInitializeData = dataAccessTreasuryIface.encodeFunctionData("initialize", [
                owner.address,
                queryEngine.target,
            ]);
            const queryEngineTreasuryProxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [dataAccessTreasuryFactory.target, queryEngineTreasuryInitializeData]);
            const queryEngineTreasuryProxyInitCode = ethers.solidityPacked(["bytes", "bytes"], [beaconProxyFactory.bytecode, queryEngineTreasuryProxyArgs]);
            const queryEngineTreasuryProxyAddress = ethers.getCreate2Address(
                dataAccessTreasuryFactory.target.toString(), // beaconProxy's deployer
                ethers.keccak256(ethers.solidityPacked(["address"], [queryEngine.target])),
                ethers.keccak256(queryEngineTreasuryProxyInitCode),
            );
            queryEngineTreasury.should.eq(queryEngineTreasuryProxyAddress);
            queryEngineTreasuryProxyAddress.should.eq(await dataAccessTreasuryFactory.getProxyAddress(queryEngineTreasuryInitializeData, queryEngine.target));

            const computeEngineTreasuryInitializeData = dataAccessTreasuryIface.encodeFunctionData("initialize", [
                owner.address,
                computeEngine.target,
            ]);
            const computeEngineTreasuryProxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [dataAccessTreasuryFactory.target, computeEngineTreasuryInitializeData]);
            const computeEngineTreasuryProxyInitCode = ethers.solidityPacked(["bytes", "bytes"], [beaconProxyFactory.bytecode, computeEngineTreasuryProxyArgs]);
            const computeEngineTreasuryProxyAddress = ethers.getCreate2Address(
                dataAccessTreasuryFactory.target.toString(), // beaconProxy's deployer
                ethers.keccak256(ethers.solidityPacked(["address"], [computeEngine.target])),
                ethers.keccak256(computeEngineTreasuryProxyInitCode),
            );
            computeEngineTreasury.should.eq(computeEngineTreasuryProxyAddress);
            computeEngineTreasuryProxyAddress.should.eq(await dataAccessTreasuryFactory.getProxyAddress(computeEngineTreasuryInitializeData, computeEngine.target));
        });

        it("should grant or revoke roles when admin", async function () {
            await queryEngine
                .connect(owner)
                .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;
            (await queryEngine.hasRole(MAINTAINER_ROLE, user1)).should.eq(true);
            (await queryEngine.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(false);
            (await queryEngine.hasRole(MAINTAINER_ROLE, user2)).should.eq(false);

            await queryEngine
                .connect(user1)
                .grantRole(DEFAULT_ADMIN_ROLE, user1.address)
                .should.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}`,
                );

            await queryEngine
                .connect(owner)
                .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;
            (await queryEngine.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(true);

            await queryEngine
                .connect(user1)
                .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);
            (await queryEngine.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(false);

            await queryEngine
                .connect(owner)
                .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
                .should.rejectedWith(
                    `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
                );

            await queryEngine
                .connect(user1)
                .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
            (await queryEngine.hasRole(DEFAULT_ADMIN_ROLE, user2)).should.eq(true);
        });

        it("should upgradeTo when owner", async function () {
            await upgrades.upgradeProxy(
                queryEngine,
                await ethers.getContractFactory(
                    "QueryEngineImplementationV0Mock",
                    owner,
                ),
            );

            const newImpl = await ethers.getContractAt(
                "QueryEngineImplementationV0Mock",
                queryEngine,
            );
            (await newImpl.version()).should.eq(0);

            (await newImpl.test()).should.eq("test");
        });

        it("should not upgradeTo when non-owner", async function () {
            const newImpl = await ethers.deployContract(
                "QueryEngineImplementationV0Mock",
            );

            await queryEngine
                .connect(user1)
                .upgradeToAndCall(newImpl, "0x")
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                );
        });

        it("should upgradeTo when owner and emit event", async function () {
            const newImpl = await ethers.deployContract(
                "QueryEngineImplementationV0Mock",
            );

            await queryEngine
                .connect(owner)
                .upgradeToAndCall(newImpl, "0x")
                .should.emit(queryEngine, "Upgraded")
                .withArgs(newImpl);

            const newRoot = await ethers.getContractAt(
                "QueryEngineImplementationV0Mock",
                queryEngine,
            );

            (await newRoot.version()).should.eq(0);

            (await newRoot.test()).should.eq("test");
        });

        it("should reject upgradeTo when storage layout is incompatible", async function () {
            await upgrades
                .upgradeProxy(
                    queryEngine,
                    await ethers.getContractFactory(
                        "QueryEngineImplementationIncompatibleMock",
                        owner,
                    ),
                )
                .should.be.rejectedWith("New storage layout is incompatible");
        });

        it("should not initialize in implementation contract", async function () {
            const impl = await ethers.deployContract(
                "QueryEngineImplementation",
            );

            await impl.initialize(owner.address, dataRefinerRegistry.target, dataAccessTreasuryImpl.target).should.be.rejectedWith(
                "InvalidInitialization()",
            );
        });

        it("should pause and unpause only when maintainer", async function () {
            await queryEngine
                .connect(maintainer)
                .pause().should.be.fulfilled;
            (await queryEngine.paused()).should.eq(true);

            await queryEngine
                .connect(maintainer)
                .unpause().should.be.fulfilled;
            (await queryEngine.paused()).should.eq(false);

            await queryEngine
                .connect(user1)
                .pause()
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            await queryEngine
                .connect(user1)
                .unpause()
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateRefinerRegistry only when maintainer", async function () {
            const newImpl = await ethers.deployContract(
                "DataRefinerRegistryImplementation",
            );

            await queryEngine
                .connect(maintainer)
                .updateRefinerRegistry(newImpl.target)
                .should.be.fulfilled;
            (await queryEngine.refinerRegistry()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "DataRefinerRegistryImplementation",
            );
            newImpl1.should.not.eq(newImpl);

            await queryEngine
                .connect(owner)
                .updateRefinerRegistry(newImpl1.target)
                .should.be.fulfilled;
            (await queryEngine.refinerRegistry()).should.eq(newImpl1.target);

            await queryEngine
                .connect(user1)
                .updateRefinerRegistry(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateComputeEngine only when maintainer", async function () {
            const newImpl = await ethers.deployContract(
                "ComputeEngineImplementation",
            );

            await queryEngine
                .connect(maintainer)
                .updateComputeEngine(newImpl.target)
                .should.be.fulfilled;
            (await queryEngine.computeEngine()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "ComputeEngineImplementation",
            );
            newImpl1.should.not.eq(newImpl);

            await queryEngine
                .connect(owner)
                .updateComputeEngine(newImpl1.target)
                .should.be.fulfilled;
            (await queryEngine.computeEngine()).should.eq(newImpl1.target);

            await queryEngine
                .connect(user1)
                .updateComputeEngine(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateQueryEngineTreasury only when maintainer", async function () {
            const newImpl = await ethers.deployContract(
                "DataAccessTreasuryImplementation",
            );

            await queryEngine
                .connect(maintainer)
                .updateQueryEngineTreasury(newImpl.target)
                .should.be.fulfilled;
            (await queryEngine.queryEngineTreasury()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "DataAccessTreasuryImplementation",
            );
            newImpl1.should.not.eq(newImpl);

            await queryEngine
                .connect(owner)
                .updateQueryEngineTreasury(newImpl1.target)
                .should.be.fulfilled;
            (await queryEngine.queryEngineTreasury()).should.eq(newImpl1.target);

            await queryEngine
                .connect(user1)
                .updateQueryEngineTreasury(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateVanaTreasury only when maintainer", async function () {
            let newVanaTreasury = await ethers.Wallet.createRandom();

            await queryEngine
                .connect(maintainer)
                .updateVanaTreasury(newVanaTreasury)
                .should.be.fulfilled;
            (await queryEngine.vanaTreasury()).should.eq(newVanaTreasury);

            await queryEngine
                .connect(user1)
                .updateVanaTreasury(newVanaTreasury)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });
    });

    describe("Permissions", () => {
        beforeEach(async () => {
            await deploy();

            await dataRefinerRegistry
                .connect(dlp1Owner)
                .addRefiner(1, "refiner1", "schema1", "instruction1", "publicKey1");

            await dataRefinerRegistry
                .connect(dlp2Owner)
                .addRefiner(2, "refiner2", "schema2", "instruction2", "publicKey2");
        });

        it("should addPermission only when DLP owner", async function () {
            // refinerId 1 is registered by dlp1Owner
            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user1.address, 1, "table1a", "column1a", parseEther(1))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(1, user1.address, 1, "table1a", "column1a", parseEther(1));

            await queryEngine
                .connect(dlp1Owner)
                .addGenericPermission(1, "table1b", "", parseEther(10))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(2, ethers.ZeroAddress, 1, "table1b", "", parseEther(10));

            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user2.address, 1, "", "", parseEther(1))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(3, user2.address, 1, "", "", parseEther(1));

            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user1.address, 3, "table1c", "column1c", parseEther(1))
                .should.be.rejectedWith("NotRefinerOwner()");

            await queryEngine
                .connect(dlp2Owner)
                .addPermission(user1.address, 1, "table1b", "column1b", parseEther(1))
                .should.be.rejectedWith("NotRefinerOwner()");

            await queryEngine
                .connect(dlp2Owner)
                .addPermission(user1.address, 2, "table2a", "", parseEther(2))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(4, user1.address, 2, "table2a", "", parseEther(2));

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);
        });

        it("should updatePermissionApproval only when DLP owner", async function () {
            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user1.address, 1, "table1a", "column1a", parseEther(1))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(1, user1.address, 1, "table1a", "column1a", parseEther(1));

            await queryEngine
                .connect(dlp1Owner)
                .addGenericPermission(1, "table1b", "", parseEther(10))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(2, ethers.ZeroAddress, 1, "table1b", "", parseEther(10));

            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user2.address, 1, "", "", parseEther(1))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(3, user2.address, 1, "", "", parseEther(1));

            await queryEngine
                .connect(dlp2Owner)
                .addPermission(user1.address, 2, "table2a", "", parseEther(2))
                .should.emit(queryEngine, "PermissionAdded")
                .withArgs(4, user1.address, 2, "table2a", "", parseEther(2));

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(1, false)
                .should.emit(queryEngine, "PermissionApprovalUpdated")
                .withArgs(1, false);

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                // [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(2, false)
                .should.emit(queryEngine, "PermissionApprovalUpdated")
                .withArgs(2, false);

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                // [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                // [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                // [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            await queryEngine
                .connect(dlp2Owner)
                .updatePermissionApproval(2, true)
                .should.be.rejectedWith("NotRefinerOwner()");

            await queryEngine
                .connect(dlp2Owner)
                .updatePermissionApproval(4, false)
                .should.emit(queryEngine, "PermissionApprovalUpdated")
                .withArgs(4, false);

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                // [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                // [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                // [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                // [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(2, true)
                .should.emit(queryEngine, "PermissionApprovalUpdated")
                .withArgs(2, true);

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                // [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                // [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(1, false)
                .should.be.fulfilled;

            (await queryEngine.getPermissions(1, user1.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                // [1, user1.address, true, 1, "table1a", "column1a", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(1, user2.address)).should.deep.eq([
                [2, ethers.ZeroAddress, true, 1, "table1b", "", parseEther(10)],
                [3, user2.address, true, 1, "", "", parseEther(1)],
            ]);

            (await queryEngine.getPermissions(2, user1.address)).should.deep.eq([
                // [4, user1.address, true, 2, "table2a", "", parseEther(2)],
            ]);

            (await queryEngine.permissionsCount()).should.eq(4);

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(0, false)
                .should.be.rejectedWith("PermissionNotFound()");

            await queryEngine
                .connect(dlp1Owner)
                .updatePermissionApproval(5, false)
                .should.be.rejectedWith("PermissionNotFound()");
        });

        it("should not allow non-empty columnName when tableName is empty", async function () {
            await queryEngine
                .connect(dlp1Owner)
                .addPermission(user1.address, 1, "", "column1a", parseEther(1))
                .should.be.rejectedWith("ColumnNameUnexpected()");
        });
    });

    describe("Payments", () => {
        const dlpPaymentPercentage = parseEther(80);
        const ONE_HUNDRED_PERCENT = parseEther(100);
        const maxUint80 = (1n << 80n) - 1n;

        const dlpId1 = 1;
        const refinerId1 = 1;
        const jobId1 = 1;
        const instructionId1 = 1;

        const depositAmount = parseEther(100);

        const getTeePoolAddress = async function (teePoolType: number, hardwareType: number, maxTimeout: number | bigint, deployer: string) {
            const salt = ethers.keccak256(ethers.solidityPacked(["address"], [deployer]));

            const abi = [
                "function initialize(address ownerAddress, address computeEngineAddress, address teePoolFactoryAddress, uint8 teePoolType, uint8 hardwareType, uint80 maxTimeout)",
            ];
            const iface = new ethers.Interface(abi);
            const beaconProxyFactory = await ethers.getContractFactory("BeaconProxy");
            const initializeData = iface.encodeFunctionData("initialize", [
                maintainer.address,
                computeEngine.target,
                teePoolFactory.target,
                teePoolType,
                hardwareType,
                maxTimeout,
            ]);
            const proxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [teePoolProxyFactory.target, initializeData]);
            const proxyInitCode = ethers.solidityPacked(["bytes", "bytes"], [beaconProxyFactory.bytecode, proxyArgs]);
            const proxyAddress = ethers.getCreate2Address(
                teePoolProxyFactory.target.toString(), // beaconProxy's deployer
                salt,
                ethers.keccak256(proxyInitCode),
            );
            return proxyAddress;
        };

        beforeEach(async () => {
            await deploy();

            (await queryEngine.hasRole(QUERY_ENGINE_ROLE, queryEngineTEE)).should.eq(true);
            (await queryEngine.hasRole(QUERY_ENGINE_ROLE, owner)).should.eq(false);

            // DLP adds a refiner -> refinerId
            await dataRefinerRegistry
                .connect(dlp1Owner)
                .addRefiner(dlpId1, "refiner1", "schema1", "instruction1", "publicKey1");

            // Maintainer creates a dedicated TEE pool
            const teePoolProxyAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.GPU, maxUint80, await teePoolFactory.getAddress());

            await teePoolFactory
                .connect(maintainer)
                .createTeePool(TeePoolType.Dedicated, HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(teePoolProxyAddress, TeePoolType.Dedicated, HardwareType.GPU, maxUint80);

            (await teePoolFactory.teePools(TeePoolType.Dedicated, HardwareType.GPU)).should.eq(teePoolProxyAddress);

            // User adds a TEE to the dedicated TEE pool
            const teePool = await ethers.getContractAt("ComputeEngineTeePoolImplementation", teePoolProxyAddress);
            await teePool.connect(maintainer).addTee(computeEngineTEE.address, ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["teeUrl1", "teePublicKey1"]));
            (await teePool.isTee(computeEngineTEE.address)).should.eq(true);
            (await teePool.tees(computeEngineTEE.address)).should.deep.eq([
                computeEngineTEE.address,
                "teeUrl1",
                TeeStatus.Active,
                0,
                "teePublicKey1",
            ]);

            // User add a compute instruction -> instructionId
            const instructionHash1 = keccak256(ethers.toUtf8Bytes("instruction1"));
            await computeInstructionRegistry
                .connect(user1)
                .addComputeInstruction(
                    instructionHash1,
                    "instructionUrl1",
                )
                .should.emit(computeInstructionRegistry, "ComputeInstructionAdded")
                .withArgs(instructionId1, user1, "instructionUrl1", instructionHash1);

            // User submits a job with the dedicated TEE -> jobId
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    2 * persistentTimeout,
                    true,
                    instructionId1,
                    computeEngineTEE.address,
                    { value: depositAmount },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1);
        });

        it("should requestPaymentInVana when queryEngineTEE", async function () {
            (await computeEngine.balanceOf(user1, VanaToken)).should.eq(depositAmount);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(depositAmount);
            (await ethers.provider.getBalance(computeEngine.target)).should.eq(0);
            (await ethers.provider.getBalance(queryEngineTreasury.target)).should.eq(0);
            (await ethers.provider.getBalance(queryEngine.target)).should.eq(0);

            // Offchain: 
            // - Compute engine verifies compute instruction and runs it in the assigned TEE
            // - When the compute instruction queries data from query engine, query engine
            // verifies permissions and runs the queries.
            // - When the queries finish, query engine computes the data access cost.

            // Query engine sends requestPaymentInVana
            const dataAccessCost = parseEther(10);
            const vanaTreasuryBalanceBefore = await ethers.provider.getBalance(vanaTreasury);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.emit(queryEngine, "PaymentReceived")
                .withArgs(
                    VanaToken,
                    dataAccessCost,
                    jobId1,
                    refinerId1);

            (await computeEngine.balanceOf(user1, VanaToken)).should.eq(depositAmount - dataAccessCost);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(depositAmount - dataAccessCost);

            const dlp1Payment = dataAccessCost * dlpPaymentPercentage / ONE_HUNDRED_PERCENT;
            const vanaPayment = dataAccessCost - dlp1Payment;

            (await ethers.provider.getBalance(vanaTreasury)).should.eq(vanaTreasuryBalanceBefore + vanaPayment);
            (await ethers.provider.getBalance(queryEngineTreasury.target)).should.eq(dlp1Payment);
            (await queryEngine.balanceOf(dlpId1, VanaToken)).should.eq(dlp1Payment);

            const dlp1OwnerBalanceBefore = await ethers.provider.getBalance(dlp1Owner);

            const tx = await queryEngine
                .connect(dlp1Owner)
                .claimDlpPayment(dlpId1, VanaToken);
            tx.should.emit(queryEngine, "DlpPaymentClaimed")
                .withArgs(dlpId1, dlp1Owner, VanaToken, dlp1Payment);

            const txReceipt = await getReceipt(tx);

            (await ethers.provider.getBalance(queryEngineTreasury.target)).should.eq(0);
            (await queryEngine.balanceOf(dlpId1, VanaToken)).should.eq(0);
            (await ethers.provider.getBalance(dlp1Owner)).should.eq(dlp1OwnerBalanceBefore + dlp1Payment - txReceipt.fee);
        });

        it("should revert when not QUERY_ENGINE_ROLE", async function () {
            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(owner)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${owner.address}", "${QUERY_ENGINE_ROLE}")`,
                );

            const metadata = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [jobId1, refinerId1]);

            await queryEngine
                .connect(owner)
                .requestPayment(VanaToken, dataAccessCost, metadata)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${owner.address}", "${QUERY_ENGINE_ROLE}")`,
                );
        });

        it("should revert when jobId is not found", async function () {
            const dataAccessCost = parseEther(10);

            const jobId0 = 0;
            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId0, refinerId1)
                .should.be.rejectedWith(`JobNotFound(${jobId0})`);

            const jobId2 = 2;
            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId2, refinerId1)
                .should.be.rejectedWith(`JobNotFound(${jobId2})`);
        });

        it("should revert when refinerId is not found", async function () {
            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, 0)
                .should.be.rejectedWith("RefinerNotFound()");

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, 2)
                .should.be.rejectedWith("RefinerNotFound()");
        });

        it("should revert when token is not VanaToken or ERC20", async function () {
            const dataAccessCost = parseEther(10);

            const metadata = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [jobId1, refinerId1]);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPayment(user1.address, dataAccessCost, metadata)
                .should.be.reverted;
        });

        it("should revert when user balance is insufficient", async function () {
            // Query engine sends requestPaymentInVana
            const dataAccessCost = parseEther(101);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.be.rejectedWith("InsufficientBalance()");
        });

        it("should revert when the payment is not received", async function () {
            const dataAccessCost = parseEther(10);

            const maliciousComputeEngine = await (await ethers.getContractFactory("ComputeEngineMaliciousMock")).deploy();

            await queryEngine
                .connect(maintainer)
                .updateComputeEngine(maliciousComputeEngine.target)
                .should.be.fulfilled;

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.be.rejectedWith("PaymentNotReceived()");
        });

        it("should revert when reentrancy", async function () {
            const dataAccessCost = parseEther(10);

            const maliciousComputeEngine = await (await ethers.getContractFactory("ComputeEngineMaliciousMock2")).deploy();

            await queryEngine
                .connect(maintainer)
                .updateComputeEngine(maliciousComputeEngine.target)
                .should.be.fulfilled;

            // It should be rejected by ReentrancyGuard
            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.be.rejectedWith("ReentrancyGuardReentrantCall()");
        });

        it("should revert when non-DlpOwner claimDlpPayment", async function () {
            // Query engine sends requestPaymentInVana
            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.emit(queryEngine, "PaymentReceived")
                .withArgs(
                    VanaToken,
                    dataAccessCost,
                    jobId1,
                    refinerId1);

            await queryEngine
                .connect(dlp2Owner)
                .claimDlpPayment(dlpId1, VanaToken)
                .should.be.rejectedWith("NotDlpOwner()");
        });

        it("should revert when dlpTreasuryAddress is not set", async function () {
            const dataAccessCost = parseEther(10);

            const dlpId2 = 2;
            const refinerId3 = 3;
            const jobId4 = 4;

            await dataRefinerRegistry
                .connect(dlp1Owner)
                .addRefiner(dlpId1, "refiner2", "schema2", "instruction2", "publicKey2")
                .should.be.fulfilled;

            await dataRefinerRegistry
                .connect(dlp2Owner)
                .addRefiner(dlpId2, "refiner3", "schema3", "instruction3", "publicKey3")
                .should.be.fulfilled;

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    3 * persistentTimeout,
                    true,
                    instructionId1,
                    computeEngineTEE.address,
                    { value: 2n * depositAmount },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(2, user1);

            await computeEngine
                .connect(user2)
                .submitJobWithTee(
                    3 * persistentTimeout,
                    true,
                    instructionId1,
                    computeEngineTEE.address,
                    { value: 2n * depositAmount },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(3, user2);

            await computeEngine
                .connect(user2)
                .submitJobWithTee(
                    3 * persistentTimeout,
                    true,
                    instructionId1,
                    computeEngineTEE.address,
                    { value: 2n * depositAmount },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId4, user2);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId4, refinerId3)
                .should.emit(queryEngine, "PaymentReceived")
                .withArgs(
                    VanaToken,
                    dataAccessCost,
                    jobId4,
                    refinerId3);

            await queryEngine
                .connect(dlp2Owner)
                .claimDlpPayment(dlpId2, VanaToken)
                .should.be.rejectedWith("InvalidDlpTreasuryAddress()");

            let dlp2Treasury = await ethers.Wallet.createRandom();
            await dlpRootCoreMock.connect(dlp2Owner).updateDlpTreasuryAddress(dlpId2, dlp2Treasury);

            const dlp2TreasuryBalanceBefore = await ethers.provider.getBalance(dlp2Treasury);

            const dlp2Payment = dataAccessCost * dlpPaymentPercentage / ONE_HUNDRED_PERCENT;
            await queryEngine
                .connect(dlp2Owner)
                .claimDlpPayment(dlpId2, VanaToken)
                .should.emit(queryEngine, "DlpPaymentClaimed")
                .withArgs(dlpId2, dlp2Treasury, VanaToken, dlp2Payment);

            (await ethers.provider.getBalance(dlp2Treasury)).should.eq(dlp2TreasuryBalanceBefore + dlp2Payment);
        });

        it("should not claimDlpPayment when paused", async function () {
            // Query engine sends requestPaymentInVana
            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.emit(queryEngine, "PaymentReceived")
                .withArgs(
                    VanaToken,
                    dataAccessCost,
                    jobId1,
                    refinerId1);

            await queryEngine
                .connect(maintainer)
                .pause()
                .should.be.fulfilled;

            await queryEngine
                .connect(dlp1Owner)
                .claimDlpPayment(dlpId1, VanaToken)
                .should.be.rejectedWith("EnforcedPause()");
        });

        it("should not claimDlpPayment when queryEngineTreasury paused", async function () {
            // Query engine sends requestPaymentInVana
            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.emit(queryEngine, "PaymentReceived")
                .withArgs(
                    VanaToken,
                    dataAccessCost,
                    jobId1,
                    refinerId1);

            await queryEngineTreasury
                .connect(owner)
                .pause();

            await queryEngine
                .connect(dlp1Owner)
                .claimDlpPayment(dlpId1, VanaToken)
                .should.be.rejectedWith("EnforcedPause()");
        });

        it("should not requestPaymentInVana when computeEngineTreasury paused", async function () {
            await computeEngineTreasury
                .connect(owner)
                .pause();

            const dataAccessCost = parseEther(10);

            await queryEngine
                .connect(queryEngineTEE)
                .requestPaymentInVana(dataAccessCost, jobId1, refinerId1)
                .should.be.rejectedWith("EnforcedPause()");
        });
    });

    describe("Treasury", () => {
        beforeEach(async () => {
            await deploy();
        });

        it("should have correct roles", async function () {
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, owner)).should.eq(true);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, queryEngine.target)).should.eq(true);
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, queryEngine.target)).should.eq(false);
        });

        it("should updateCustodian only when admin", async function () {
            let newCustodian = await ethers.Wallet.createRandom();

            newCustodian.address.should.not.eq(owner.address);
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, newCustodian)).should.eq(false);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, newCustodian)).should.eq(false);

            await queryEngineTreasury
                .connect(owner)
                .updateCustodian(newCustodian)
                .should.be.fulfilled;
            (await queryEngineTreasury.custodian()).should.eq(newCustodian);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, newCustodian)).should.eq(true);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, owner)).should.eq(true);
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, queryEngine.target)).should.eq(false);
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, newCustodian)).should.eq(false);

            await queryEngineTreasury
                .connect(user1)
                .updateCustodian(newCustodian)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                );
        });

        it("should grant or revoke CUSTODIAN_ROLE only when admin", async function () {
            let newCustodian = await ethers.Wallet.createRandom();

            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, newCustodian)).should.eq(false);
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, newCustodian)).should.eq(false);

            await queryEngineTreasury
                .connect(owner)
                .grantRole(CUSTODIAN_ROLE, newCustodian)
                .should.be.fulfilled;
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, newCustodian)).should.eq(true);
            // (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, newCustodian)).should.eq(false);

            await queryEngineTreasury
                .connect(owner)
                .revokeRole(CUSTODIAN_ROLE, newCustodian)
                .should.be.fulfilled;
            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, newCustodian)).should.eq(false);
            (await queryEngineTreasury.hasRole(DEFAULT_ADMIN_ROLE, newCustodian)).should.eq(false);

            await queryEngineTreasury
                .connect(user1)
                .grantRole(CUSTODIAN_ROLE, newCustodian)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                );
            await queryEngineTreasury
                .connect(user1)
                .revokeRole(CUSTODIAN_ROLE, newCustodian)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                );
        });

        it("should transfer only when CUSTODIAN_ROLE", async function () {
            let recoveryAddress = await ethers.Wallet.createRandom();

            (await ethers.provider.getBalance(queryEngineTreasury.target)).should.eq(0);

            await owner.sendTransaction({
                to: queryEngineTreasury.target,
                value: parseEther(1),
            });

            (await queryEngineTreasury.hasRole(CUSTODIAN_ROLE, owner)).should.eq(true);
            await queryEngineTreasury
                .connect(owner)
                .transfer(recoveryAddress, VanaToken, 0n)
                .should.be.rejectedWith("ZeroAmount()");

            await queryEngineTreasury
                .connect(owner)
                .transfer(ethers.ZeroAddress, VanaToken, parseEther(1))
                .should.be.rejectedWith("ZeroAddress()");

            await queryEngineTreasury
                .connect(owner)
                .transfer(recoveryAddress, VanaToken, parseEther(2))
                .should.not.be.fulfilled;

            await queryEngineTreasury
                .connect(owner)
                .transfer(recoveryAddress, VanaToken, parseEther(1))
                .should.be.fulfilled;
            (await ethers.provider.getBalance(queryEngineTreasury.target)).should.eq(0);
            (await ethers.provider.getBalance(recoveryAddress)).should.eq(parseEther(1));

            await queryEngineTreasury
                .connect(user1)
                .transfer(recoveryAddress, VanaToken, 1n)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${CUSTODIAN_ROLE}")`,
                );
        });
    });
});