import "module-alias/register";
import { ethers } from "hardhat";
import { BigNumber, utils } from "ethers";
import {
  IERC20,
  IERC20__factory,
  SetToken,
  MorphoClaimV2Adapter,
  ClaimModuleV2,
} from "@typechain/index";
import DeployHelper from "@utils/deploys";
import {
  getAccounts,
  getWaffleExpect,
  addSnapshotBeforeRestoreAfterEach,
  getSystemFixture,
} from "@utils/test/index";
import { Account } from "@utils/test/types";
import { network } from "hardhat";
import { forkingConfig } from "../../hardhat.config";
import { SystemFixture } from "@utils/fixtures";
import { impersonateAccount } from "@utils/test/testingUtils";

const expect = getWaffleExpect();

const HYETH_ADDRESS = "0xc4506022fb8090774e8a628d5084eed61d9b99ee";

// https://rewards.morpho.org/v1/users/0xc4506022Fb8090774E8A628d5084EED61D9B99Ee/distributions
// block number: 21569105
const morphoData = {
  morphoDistributor: "0x330eefa8a787552DC5cAd3C3cA644844B1E61Ddb",
  rewardToken: "0x320623b8E4fF03373931769A31Fc52A4E78B5d70",
  claimableAmount: "111535278328373843310820",
  merkleProof: [
    "0xdad9f9dc4036e184ebd72ce9c0cf6efafdbf985b466ccf399e63f37165576ce1",
    "0xafeedbd0af95808db44610415ed6831231accb23a6748109794841247548d6f1",
    "0x1a6f7035ee5aeabfae017ea039059552b707b5073ad3cbc12c95bf4202891b57",
    "0x0613d3a3a38ffdc48f8a48025c99f2cd8dbadd158bb03bcfb6662161cc011452",
    "0xf04d1e49ac632b6f568b5a14142b45c37d426b40f8ce61d71266180b584d848a",
    "0x50e248467883b747186c4f03952773fe73e431e633c25428bcd0c787d9432690",
    "0xdcadef10c1d5b0e1eb8bc5fcef99fe92ff97189f10ec8f85fd7efa6c04584dad",
    "0xc9e14692017e9270bb3f64bbfa08b37855725dac5ba4cdf8aa3fa98cd36ecf85",
    "0x464ae9f49baacea78ee5f0deb7afcc3412e7b2cba300d148d6b490e1f24a861e",
    "0x30cc37ee96992598dde8ae569cc81d414f793c936f83c3feacf28675857e800a",
    "0x9e860255d7ba2866bbfd0dba3258830621924c2e232f005e38a8840976ee2ddc",
    "0x6eaa3eef372bbdadb1b9f70ff4ec308b7cbf401966d94306a1ffa2280dacd7dd",
    "0xb11fdb741bea16a89100a87d4b2d0bfaf89f7ecddf31eb1e82756c6ddc039bcc",
    "0xcd41187833b918b6e52f854ec364ee71dbe95653cdff2bd2e403ff75ff147ee8"
  ],
};

describe.only("MorphoClaimV2Adapter [ @forked-mainnet ]", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setToken: SetToken;
  let claimModule: ClaimModuleV2;
  let morphoClaimAdapter: MorphoClaimV2Adapter;
  let setV2Setup: SystemFixture;
  let rewardToken: IERC20;

  const morphoClaimAdapterName = "MorphoClaimV2Adapter";
  const blockNumber = 21569105;

  before(async () => {
    const forking = {
      jsonRpcUrl: forkingConfig.url,
      blockNumber,
    };
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking }],
    });
  });

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  before(async () => {
    [owner] = await getAccounts();
    deployer = new DeployHelper(owner.wallet);
    setV2Setup = getSystemFixture(owner.address);
    await setV2Setup.initialize();

    setToken = await ethers.getContractAt("SetToken", HYETH_ADDRESS) as SetToken;
    rewardToken = IERC20__factory.connect(morphoData.rewardToken, owner.wallet);

    const controllerAddress = await setToken.controller();
    const controller = await ethers.getContractAt("Controller", controllerAddress);

    const controllerOwnerAddress = await controller.owner();
    const controllerOwner = await impersonateAccount(controllerOwnerAddress);

    const integrationRegistryAddress = await controller.resources(0);
    const integrationRegistry = await ethers.getContractAt("IntegrationRegistry", integrationRegistryAddress);

    morphoClaimAdapter = await deployer.adapters.deployMorphoClaimV2Adapter(
      morphoData.morphoDistributor
    );
    claimModule = await deployer.modules.deployClaimModuleV2(controllerAddress);

    await controller.connect(controllerOwner).addModule(claimModule.address);
    await integrationRegistry.connect(controllerOwner).addIntegration(
      claimModule.address,
      morphoClaimAdapterName,
      morphoClaimAdapter.address
    );

    const managerAddress = await setToken.manager();
    const managerInterface = ["function setManager(address _manager)", "function operator() external view returns (address)"];
    const manager = new ethers.Contract(managerAddress, managerInterface, owner.wallet);

    const operator = await manager.operator();
    const operatorAccount = await impersonateAccount(operator);
    await manager.connect(operatorAccount).setManager(owner.address);
    await manager.connect(operatorAccount).setManager(owner.address);
    await setToken.addModule(claimModule.address);
    await claimModule.initialize(
      setToken.address,
      false,
      [morphoData.rewardToken],
      [morphoClaimAdapterName]
    );
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#claim", () => {
    let subjectSetToken: string;
    let subjectRewardPool: string;
    let subjectIntegrationName: string;
    let subjectClaimData: string;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectSetToken = setToken.address;
      subjectRewardPool = morphoData.rewardToken;
      subjectIntegrationName = morphoClaimAdapterName;
      subjectClaimData = utils.defaultAbiCoder.encode(
        ["uint256", "bytes32[]"],
        [morphoData.claimableAmount, morphoData.merkleProof]
      );
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return claimModule.connect(subjectCaller.wallet).claim(
        subjectSetToken,
        subjectRewardPool,
        subjectIntegrationName,
        subjectClaimData
      );
    }

    it("should claim the correct amount of rewards", async () => {
      const preClaimBalance = await rewardToken.balanceOf(setToken.address);
      const componentsBefore = await setToken.getComponents();

      await subject();

      const postClaimBalance = await rewardToken.balanceOf(setToken.address);
      const actualIncrease = postClaimBalance.sub(preClaimBalance);

      const componentsAfter = await setToken.getComponents();

      expect(actualIncrease).to.eq(BigNumber.from(morphoData.claimableAmount));
      expect(componentsAfter.length).to.eq(componentsBefore.length + 1);
      expect(componentsAfter[1]).to.eq(morphoData.rewardToken);
    });

    describe("when caller is not authorized", () => {
      beforeEach(async () => {
        const [, unauthorized] = await getAccounts();
        subjectCaller = unauthorized;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid caller");
      });
    });
  });
});