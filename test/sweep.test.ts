import { ethers } from "hardhat";
import { expect } from "chai";
import { OpenPFPExchange, OpenSweep, StrategyStandardSaleForFixedPrice, TestERC721, WETH } from "typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { TypedDataUtils } from "ethers-eip712";
import { TypedData } from "ethers-eip712/dist/typed-data";

async function SignatureWith712Data(makerOrder: any, pfp: string, signer: SignerWithAddress): Promise<string> {
  const typedData: TypedData = {
    types: {
      EIP712Domain: [
        {
          name: "name",
          type: "string",
        },
        {
          name: "version",
          type: "string",
        },
        {
          name: "chainId",
          type: "uint256",
        },
        {
          name: "verifyingContract",
          type: "address",
        },
      ],
      MakerOrder: [
        {
          name: "isOrderAsk",
          type: "bool",
        },
        {
          name: "signer",
          type: "address",
        },
        {
          name: "collection",
          type: "address",
        },
        {
          name: "price",
          type: "uint256",
        },
        {
          name: "tokenId",
          type: "uint256",
        },
        {
          name: "amount",
          type: "uint256",
        },
        {
          name: "strategy",
          type: "address",
        },
        {
          name: "currency",
          type: "address",
        },
        {
          name: "nonce",
          type: "uint256",
        },
        {
          name: "startTime",
          type: "uint256",
        },
        {
          name: "endTime",
          type: "uint256",
        },
        {
          name: "minPercentageToAsk",
          type: "uint256",
        },
        {
          name: "params",
          type: "bytes",
        },
      ],
    },
    primaryType: "MakerOrder",
    domain: {
      name: "OpenPFPExchange",
      version: "1",
      chainId: 31337,
      verifyingContract: pfp,
    },
    message: makerOrder,
  };
  const digest = TypedDataUtils.encodeDigest(typedData);
  const digestHex = ethers.utils.hexlify(digest);
  
  return signer.signMessage(digestHex);
}

describe("OpenSweep", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let pfp: OpenPFPExchange;
  let sweep: OpenSweep;
  let wETH: WETH;
  let testERC721: TestERC721;
  let sss: StrategyStandardSaleForFixedPrice;
  let nonce: number = 0;
  
  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    
    // deploy WETH
    const wethFactory = await ethers.getContractFactory("WETH");
    wETH = await wethFactory.deploy();
    
    // deploy TestERC721
    const t721Factory = await ethers.getContractFactory("TestERC721");
    testERC721 = await t721Factory.deploy();
    
    // ============= deploy OpenPFP =============
    // deploy CurrencyManager
    const cmFactory = await ethers.getContractFactory("CurrencyManager");
    let cm = await cmFactory.deploy();
    // deploy ExecutionManager
    const emFactory = await ethers.getContractFactory("ExecutionManager");
    let em = await emFactory.deploy();
    // deploy StrategyStandardSaleForFixedPrice
    const sssFactory = await ethers.getContractFactory("StrategyStandardSaleForFixedPrice");
    sss = await sssFactory.deploy(0);
    // deploy royalty
    const rfrFactory = await ethers.getContractFactory("RoyaltyFeeRegistry");
    let rfr = await rfrFactory.deploy(9500);
    // deploy RoyaltyFeeSetter
    const rfsFactory = await ethers.getContractFactory("RoyaltyFeeSetter");
    let rfs = await rfsFactory.deploy(rfr.address);
    // deploy RoyaltyFeeManager
    const rfmFactory = await ethers.getContractFactory("RoyaltyFeeManager");
    let rfm = await rfmFactory.deploy(rfr.address);
    // deploy OpenPFPExchange
    const pfpFactory = await ethers.getContractFactory("OpenPFPExchange");
    pfp = await pfpFactory.deploy(cm.address, em.address, rfm.address, wETH.address, owner.address);
    // deploy TransferManagerNonCompliantERC721
    const tm721Factory = await ethers.getContractFactory("TransferManagerNonCompliantERC721");
    let tm721 = await tm721Factory.deploy(pfp.address);
    // deploy TransferManagerERC1155
    const tm1155Factory = await ethers.getContractFactory("TransferManagerERC1155");
    let tm1155 = await tm1155Factory.deploy(pfp.address);
    // deploy TransferSelectorNFT
    const tsFactory = await ethers.getContractFactory("TransferSelectorNFT");
    let ts = await tsFactory.deploy(tm721.address, tm1155.address);
    // init openpfp
    await em.addStrategy(sss.address);
    expect(await em.isStrategyWhitelisted(sss.address)).to.eq(true);
    
    await rfr.transferOwnership(rfs.address);
    expect(await rfr.owner()).to.eq(rfs.address);
    
    await pfp.updateTransferSelectorNFT(ts.address);
    expect(await pfp.transferSelectorNFT()).to.eq(ts.address);
    
    // deploy sweep
    const factory = await ethers.getContractFactory("OpenSweep");
    sweep = await factory.deploy(pfp.address);
  });
  
  it("make erc721 order", async () => {
    const tokenId = ethers.utils.parseEther("1");
    const tokenPrice = ethers.utils.parseEther("1000");
    
    await testERC721.mint(owner.address, tokenId);
    
    const block = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(block);
    // const chainId = ethers.providers.getNetwork().chainId;
    // console.log(chainId)
    const timestamp = blockBefore.timestamp;
    
    const makerOrder = {
      isOrderAsk: true,
      signer: owner.address,
      collection: testERC721.address,
      price: tokenPrice,
      tokenId: tokenId,
      amount: 1,
      strategy: sss.address,
      currency: wETH.address,
      nonce: nonce,
      startTime: timestamp,
      endTime: timestamp + 3600,
      minPercentageToAsk: 9000,
      params: "0x",
      v: 0,
      s: "",
      r: "",
    };
    
    const makerSig = ethers.utils.splitSignature(await SignatureWith712Data(makerOrder, pfp.address, owner));
    makerOrder.v = makerSig.v;
    makerOrder.r = makerSig.r;
    makerOrder.s = makerSig.s;
    
    console.log(makerOrder);
    
    const takerOrder = {
      isOrderAsk: false,
      taker: alice.address,
      price: tokenPrice,
      tokenId: tokenId,
      minPercentageToAsk: 9000,
      params: "0x",
    };
    
    await pfp.connect(alice).matchAskWithTakerBidUsingETHAndWETH(takerOrder, makerOrder, { value: tokenPrice });
  });
  
});
