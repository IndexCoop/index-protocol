import "module-alias/register";

import { network } from "hardhat";
import { forkingConfig } from "../../hardhat.config";
import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { SetToken, AaveV3IsolatedCollateralModule } from "@utils/contracts";
import { SetToken__factory } from "@typechain/index";
import DeployHelper from "@utils/deploys";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

const contractAddresses = {
  GOLD3x: "0x1d86FBAd389068E19fa665Eba12A0Ebd4c68BB08",
  aEthXAUt: "0x8A2b6f94Ff3A89a03E8c02Ee92b55aF90c9454A2",
  aaveV3Pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
};

describe.skip("GOLD3x Aave V3 Isolated Collateral Module integration [ @forked-mainnet ]", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let aaveV3IsolatedCollateralModule: AaveV3IsolatedCollateralModule;

  let setToken: SetToken;

  const blockNumber = 23447955;
  before(async () => {
    const forking = {
      jsonRpcUrl: forkingConfig.url,
      blockNumber,
    };
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking,
        },
      ],
    });
  });
  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    aaveV3IsolatedCollateralModule = await deployer.modules.deployAaveV3IsolatedCollateralModule(
      setup.controller.address,
      contractAddresses.aaveV3Pool,
    );
    await setup.controller.addModule(aaveV3IsolatedCollateralModule.address);

    setToken = SetToken__factory.connect(contractAddresses.GOLD3x, owner.wallet);
    await setToken.connect(owner.wallet).setManager(owner.address);
    await setToken.connect(owner.wallet).setManager(owner.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a SetToken has the module enabled", async () => {
    before(async () => {
      await setToken.connect(owner.wallet).addModule(aaveV3IsolatedCollateralModule.address);
      await aaveV3IsolatedCollateralModule.connect(owner.wallet).initialize(setToken.address);
    });

    describe("#setUserUseReserveAsCollateral", async () => {
      let subjectSetToken: Address;
      let subjectAsset: Address;
      let subjectUseAsCollateral: boolean;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectAsset = contractAddresses.aEthXAUt;
        subjectUseAsCollateral = true;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return aaveV3IsolatedCollateralModule.connect(subjectCaller.wallet).setUserUseReserveAsCollateral(
          subjectSetToken,
          subjectAsset,
          subjectUseAsCollateral
        );
      }

      it("should be able to enable the collateral", async () => {
        await expect(subject()).to.not.be.reverted;
      });
    });
  });
});
