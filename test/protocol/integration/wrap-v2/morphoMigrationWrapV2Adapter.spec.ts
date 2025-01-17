import "module-alias/register";
import { BigNumber, utils } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO, ZERO_BYTES } from "@utils/constants";
import { MorphoMigrationWrapV2Adapter, StandardTokenMock } from "@utils/contracts";
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

describe("MorphoMigrationWrapV2Adapter", () => {
  let owner: Account;
  let deployer: DeployHelper;

  let setV2Setup: SystemFixture;

  let wrapAdapter: MorphoMigrationWrapV2Adapter;
  let morphoWrapper: Address;
  let legacyMorphoToken: StandardTokenMock;
  let newMorphoToken: StandardTokenMock;

  before(async () => {
    [owner] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setV2Setup = getSystemFixture(owner.address);
    await setV2Setup.initialize();

    legacyMorphoToken = setV2Setup.dai;
    newMorphoToken = setV2Setup.usdc;
    morphoWrapper = await getRandomAddress();

    wrapAdapter = await deployer.adapters.deployMorphoMigrationWrapV2Adapter(
      morphoWrapper,
      legacyMorphoToken.address,
      newMorphoToken.address
    );
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#getSpenderAddress", async () => {
    async function subject(): Promise<any> {
      return wrapAdapter.getSpenderAddress(legacyMorphoToken.address, newMorphoToken.address);
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();
      expect(spender).to.eq(morphoWrapper);
    });
  });

  describe("#getWrapCallData", async () => {
    let subjectUnderlyingToken: Address;
    let subjectWrappedToken: Address;
    let subjectUnderlyingUnits: BigNumber;
    let subjectTo: Address;
    let subjectWrapData: string;

    beforeEach(async () => {
      subjectUnderlyingToken = legacyMorphoToken.address;
      subjectWrappedToken = newMorphoToken.address;
      subjectUnderlyingUnits = ether(2);
      subjectTo = await getRandomAddress();
      subjectWrapData = ZERO_BYTES;
    });

    async function subject(): Promise<[string, BigNumber, string]> {
      return wrapAdapter.getWrapCallData(
        subjectUnderlyingToken,
        subjectWrappedToken,
        subjectUnderlyingUnits,
        subjectTo,
        subjectWrapData
      );
    }

    it("should return correct data for valid pair", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const expectedCallData = utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [subjectTo, subjectUnderlyingUnits]
      );

      expect(targetAddress).to.eq(morphoWrapper);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(
        utils.id("depositFor(address,uint256)").slice(0, 10) +
        expectedCallData.slice(2)
      );
    });

    describe("when invalid legacy token address", () => {
      beforeEach(async () => {
        subjectUnderlyingToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid legacy Morpho token");
      });
    });

    describe("when invalid new token address", () => {
      beforeEach(async () => {
        subjectWrappedToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid new Morpho token");
      });
    });
  });
});