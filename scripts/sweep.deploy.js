const { deployContract } = require('./deploy.js');

async function main() {
  const sweep = await deployContract("OpenSweep", ["0x3b11562DC5EDBF3889157e71C7AE6754d7aDEa79"])

  console.log("OpenSweep deployed to:", sweep.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
