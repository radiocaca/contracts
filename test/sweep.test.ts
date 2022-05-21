import { ethers } from "hardhat";
import { expect } from "chai";
import {
  OpenPFPExchange,
  OpenSweep,
  StrategyStandardSaleForFixedPrice,
  TestERC721,
  TransferSelectorNFT,
  WETH,
} from "typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { TypedDataUtils } from "ethers-eip712";
import { TypedData } from "ethers-eip712/dist/typed-data";
import { Signature } from "@ethersproject/bytes";
import { Signer } from "@ethersproject/abstract-signer";
import { BigNumber } from "ethers";

const bob = "0x9441e3a1b37B3F5280FC53Ee0FbB7C26a912126f";
const bobKey = "0xaa4ecb19f07913ad5b403f4b36038f39fd3f8153d2cdee113d06b7ef045beb9e";

function SignatureWith712Data(makerOrder: any, pfp: string): Signature {
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
  
  const signingKey = new ethers.utils.SigningKey(bobKey);
  return signingKey.signDigest(digestHex);
}

describe("OpenSweep", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let pfp: OpenPFPExchange;
  let ts: TransferSelectorNFT;
  let sweep: OpenSweep;
  let wETH: WETH;
  let testERC721: TestERC721;
  let sss: StrategyStandardSaleForFixedPrice;
  let nonce: number = 0;
  let bobWallet: Signer;
  
  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    
    await owner.sendTransaction({
      to: bob,
      value: ethers.utils.parseEther("100"),
    });
    
    bobWallet = new ethers.Wallet(bobKey, owner.provider);
    
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
    ts = await tsFactory.deploy(tm721.address, tm1155.address);
    // init openpfp
    await cm.addCurrency(wETH.address);
    expect(await cm.isCurrencyWhitelisted(wETH.address)).to.eq(true);
    
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
  
  async function makeOrder(tokenId: string, tokenPrice: BigNumber, taker: string) {
    await testERC721.mint(bob, tokenId);
    const transferManager = await ts.checkTransferManagerForToken(testERC721.address);
    await testERC721.connect(bobWallet).setApprovalForAll(transferManager, true);
    
    const block = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(block);
    const timestamp = blockBefore.timestamp;
    
    const makerOrder = {
      isOrderAsk: true,
      signer: bob,
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
      s: "0x",
      r: "0x",
    };
    
    const makerSig = SignatureWith712Data(makerOrder, pfp.address);
    makerOrder.v = makerSig.v;
    makerOrder.r = makerSig.r;
    makerOrder.s = makerSig.s;
    
    const takerOrder = {
      isOrderAsk: false,
      taker: taker,
      price: tokenPrice,
      tokenId: tokenId,
      minPercentageToAsk: 9000,
      params: "0x",
    };
    
    return {
      maker: makerOrder,
      taker: takerOrder,
    };
  }
  
  it("make erc721 order", async () => {
    const tokenPrice = ethers.utils.parseEther("1");
    const order = await makeOrder("1", tokenPrice, alice.address);
    await pfp.connect(alice).matchAskWithTakerBidUsingETHAndWETH(order.taker, order.maker, { value: tokenPrice });
    expect(await testERC721.ownerOf("1")).to.eq(alice.address);
  });
  
  it("sweep orders", async () => {
    const tokenPrice = ethers.utils.parseEther("1");
    
    let takers = [];
    let makers = [];
    for (let i = 0; i < 5; i++) {
      const order = await makeOrder(i.toString(), tokenPrice, sweep.address);
      takers.push(order.taker);
      makers.push(order.maker);
      nonce++;
    }
    
    // await sweep.updateTransferSelectorNFT(ts.address);
    // await sweep.setOneTimeApproval(wETH.address, pfp.address, tokenPrice.mul(5));
    
    await sweep.connect(alice).batchBuyWithETH(takers, makers, true, { value: tokenPrice.mul(5) });
    expect(await testERC721.ownerOf("0")).to.eq(alice.address);
  });
  
});
