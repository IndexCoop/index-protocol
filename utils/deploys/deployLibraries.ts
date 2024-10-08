import { Signer } from "ethers";

import {
  AaveV2,
  Compound,
  PerpV2,
  PerpV2LibraryV2,
  PerpV2Positions,
  PositionV2
} from "../contracts";
import {
  AaveV3
} from "../../typechain";

import { Morpho } from "../../typechain/Morpho";
import { Compound__factory } from "../../typechain/factories/Compound__factory";
import { AaveV2__factory } from "../../typechain/factories/AaveV2__factory";
import { AaveV3__factory } from "../../typechain/factories/AaveV3__factory";
import { Morpho__factory } from "../../typechain/factories/Morpho__factory";
import { PerpV2__factory } from "../../typechain/factories/PerpV2__factory";
import { PerpV2LibraryV2__factory } from "../../typechain/factories/PerpV2LibraryV2__factory";
import { PerpV2Positions__factory } from "../../typechain/factories/PerpV2Positions__factory";
import { PositionV2__factory } from "../../typechain/factories/PositionV2__factory";

export default class DeployLibraries {
  private _deployerSigner: Signer;

  constructor(deployerSigner: Signer) {
    this._deployerSigner = deployerSigner;
  }

  public async deployCompound(): Promise<Compound> {
    return await new Compound__factory(this._deployerSigner).deploy();
  }

  public async deployAaveV2(): Promise<AaveV2> {
    return await new AaveV2__factory(this._deployerSigner).deploy();
  }

  public async deployAaveV3(): Promise<AaveV3> {
    return await new AaveV3__factory(this._deployerSigner).deploy();
  }

  public async deployMorpho(): Promise<Morpho> {
    return await new Morpho__factory(this._deployerSigner).deploy();
  }



  public async deployPerpV2(): Promise<PerpV2> {
    return await new PerpV2__factory(this._deployerSigner).deploy();
  }

  public async deployPositionV2(): Promise<PositionV2> {
    return await new PositionV2__factory(this._deployerSigner).deploy();
  }

  public async deployPerpV2LibraryV2(): Promise<PerpV2LibraryV2> {
    return await new PerpV2LibraryV2__factory(this._deployerSigner).deploy();
  }

  public async deployPerpV2Positions(): Promise<PerpV2Positions> {
    return await new PerpV2Positions__factory(this._deployerSigner).deploy();
  }
}
