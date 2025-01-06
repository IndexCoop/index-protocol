import "module-alias/register";
import { BigNumber, utils } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO } from "@utils/constants";
import { MorphoClaimV2Adapter } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getRandomAddress,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("MorphoClaimV2Adapter", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setV2Setup: SystemFixture;

  let claimAdapter: MorphoClaimV2Adapter;
  let distributor: Address;

  before(async () => {
    [owner] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setV2Setup = getSystemFixture(owner.address);
    await setV2Setup.initialize();

    distributor = await getRandomAddress();

    claimAdapter = await deployer.adapters.deployMorphoClaimV2Adapter(distributor);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    it("should set the correct distributor address", async () => {
      const savedDistributor = await claimAdapter.distributor();
      expect(savedDistributor).to.eq(distributor);
    });
  });

  describe("#getClaimCallData", async () => {
    let subjectSetToken: Address;
    let subjectRewardPool: Address;
    let subjectClaimData: string;

    beforeEach(async () => {
      subjectSetToken = await getRandomAddress();
      subjectRewardPool = await getRandomAddress();

      const claimAmount = ether(1);
      const proof = [
        "0x" + "11".repeat(32),
        "0x" + "22".repeat(32),
        "0x" + "33".repeat(32)
      ];

      subjectClaimData = utils.defaultAbiCoder.encode(
        ["uint256", "bytes32[]"],
        [claimAmount, proof]
      );
    });

    async function subject(): Promise<[string, BigNumber, string]> {
      return claimAdapter.getClaimCallData(
        subjectSetToken,
        subjectRewardPool,
        subjectClaimData
      );
    }

    it("should return correct claim call data", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const [claimAmount, proof] = utils.defaultAbiCoder.decode(
        ["uint256", "bytes32[]"],
        subjectClaimData
      );

      const expectedCallData = utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "bytes32[]"],
        [subjectSetToken, subjectRewardPool, claimAmount, proof]
      );

      expect(targetAddress).to.eq(distributor);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(
        utils.id("claim(address,address,uint256,bytes32[])").slice(0, 10) +
        expectedCallData.slice(2)
      );
    });
  });

  describe("#getRewardsAmount", async () => {
    let subjectSetToken: Address;
    let subjectRewardPool: Address;

    beforeEach(async () => {
      subjectSetToken = await getRandomAddress();
      subjectRewardPool = await getRandomAddress();
    });

    async function subject(): Promise<BigNumber> {
      return claimAdapter.getRewardsAmount(
        subjectSetToken,
        subjectRewardPool
      );
    }

    it("should return zero (rewards must be fetched from API)", async () => {
      const rewardsAmount = await subject();
      expect(rewardsAmount).to.eq(ZERO);
    });
  });

  describe("#getTokenAddress", async () => {
    let subjectRewardPool: Address;

    beforeEach(async () => {
      subjectRewardPool = await getRandomAddress();
    });

    async function subject(): Promise<string> {
      return claimAdapter.getTokenAddress(subjectRewardPool);
    }

    it("should return the provided reward pool address", async () => {
      const tokenAddress = await subject();
      expect(tokenAddress).to.eq(subjectRewardPool);
    });
  });
});
