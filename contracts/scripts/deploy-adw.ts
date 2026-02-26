import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log(`Deploying ADW contracts on chain ${network.chainId} with: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Allow resuming partial deploys via env vars
  let docAddr = process.env.DOCUMENT_REGISTRY_ADDRESS || "";
  let repAddr = process.env.REPUTATION_REGISTRY_ADDRESS || "";
  let valAddr = "";

  // Explicit nonce tracking to avoid "replacement transaction underpriced"
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "pending");

  // 1. Deploy Document Registry
  if (!docAddr) {
    console.log("\n--- Deploying ADWDocumentRegistry ---");
    const DocFactory = await ethers.getContractFactory("ADWDocumentRegistry");
    const docRegistry = await DocFactory.deploy(
      "ADW Document Registry",
      "ADW-DOC",
      deployer.address,
      { nonce: nonce++ }
    );
    await docRegistry.waitForDeployment();
    docAddr = await docRegistry.getAddress();
  }
  console.log(`ADWDocumentRegistry: ${docAddr}`);

  // 2. Deploy Reputation Registry
  if (!repAddr) {
    console.log("\n--- Deploying ADWReputationRegistry ---");
    const RepFactory = await ethers.getContractFactory("ADWReputationRegistry");
    const repRegistry = await RepFactory.deploy(docAddr, { nonce: nonce++ });
    await repRegistry.waitForDeployment();
    repAddr = await repRegistry.getAddress();
  }
  console.log(`ADWReputationRegistry: ${repAddr}`);

  // 3. Deploy Validation Registry
  console.log("\n--- Deploying ADWValidationRegistry ---");
  const ValFactory = await ethers.getContractFactory("ADWValidationRegistry");
  const valRegistry = await ValFactory.deploy(docAddr, { nonce: nonce++ });
  await valRegistry.waitForDeployment();
  valAddr = await valRegistry.getAddress();
  console.log(`ADWValidationRegistry: ${valAddr}`);

  // 4. Write deployment artifact
  const deployment = {
    network: network.chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      documentRegistry: docAddr,
      reputationRegistry: repAddr,
      validationRegistry: valAddr,
    },
    constructorArgs: {
      documentRegistry: ["ADW Document Registry", "ADW-DOC", deployer.address],
      reputationRegistry: [docAddr],
      validationRegistry: [docAddr],
    },
  };

  const outPath = path.resolve(__dirname, "../src/adw/deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${outPath}`);

  // 5. Print verification commands
  console.log("\n--- Verification commands ---");
  console.log(`npx hardhat verify --network ${network.chainId === 8453n ? "base" : "baseSepolia"} ${docAddr} "ADW Document Registry" "ADW-DOC" "${deployer.address}"`);
  console.log(`npx hardhat verify --network ${network.chainId === 8453n ? "base" : "baseSepolia"} ${repAddr} "${docAddr}"`);
  console.log(`npx hardhat verify --network ${network.chainId === 8453n ? "base" : "baseSepolia"} ${valAddr} "${docAddr}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
