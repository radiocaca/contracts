const { deployContract } = require('./deploy.js');

async function main() {
  const sweep = await deployContract("OpenSweep", ["0xfCf25150873E65F626aAC31f459d2f5b11306D81"])

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
