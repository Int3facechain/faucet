import express from 'express';
import path from 'path';

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";
import { FrequencyChecker } from './checker.js';

import conf from './config.js';

// Load and display the configuration
console.log("Loaded config:", conf);

const app = express();

// Initialize the frequency checker with the configuration
const checker = new FrequencyChecker(conf);

// Serve static files (like index.html) from the current directory
app.use(express.static(path.resolve('./')));

/**
 * Endpoint to retrieve the configuration in JSON format.
 * It includes the faucet address and its current balance.
 */
app.get('/config.json', async (req, res) => {
  try {
    // Create a wallet from the mnemonic and options provided in the config
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        conf.sender.mnemonic,
        conf.sender.option
    );
    const [firstAccount] = await wallet.getAccounts();

    // Clone the project configuration to avoid mutating the original config
    const project = { ...conf.project };

    // Add the faucet address to the project config
    project.faucetAddress = firstAccount.address;

    // Connect to the blockchain RPC endpoint
    const rpcEndpoint = conf.blockchain.rpc_endpoint;
    const client = await SigningStargateClient.connect(rpcEndpoint);

    // Retrieve all balances for the faucet address
    const balance = await client.getAllBalances(firstAccount.address);

    // Use the denomination specified in the config or default to 'uint3'
    const denom = conf.tx.amount.denom || 'uint3';
    const faucetBalance = balance.find(b => b.denom === denom);

    // Add the faucet balance to the project config
    project.faucetBalance = faucetBalance
        ? `${faucetBalance.amount} ${denom.toUpperCase()}`
        : `0 ${denom.toUpperCase()}`;

    // Respond with the project configuration in JSON format
    res.json(project);
  } catch (error) {
    console.error("Error loading config.json:", error);
    res.status(500).json({ error: 'Failed to load configuration.' });
  }
});

/**
 * Endpoint to send tokens to a specified address.
 * Applies frequency checks to prevent abuse.
 */
app.get('/send/:address', async (req, res) => {
  const { address } = req.params;
  console.log('Request tokens to', address, 'from IP', req.ip);

  // Validate that the address parameter exists
  if (!address) {
    return res.status(400).json({ result: 'Address is required.' });
  }

  // Validate that the address has the correct prefix as per config
  if (!address.startsWith(conf.sender.option.prefix)) {
    return res.status(400).json({ result: `Address [${address}] is not supported.` });
  }

  try {
    // Check if the address and IP are allowed based on frequency limits
    const isAddressAllowed = await checker.checkAddress(address);
    const isIpAllowed = await checker.checkIp(req.ip);

    if (!isAddressAllowed || !isIpAllowed) {
      return res.status(429).json({ result: "You have requested tokens too often. Please try again later." });
    }

    // Update the frequency checker for the IP address
    checker.update(req.ip);

    // Attempt to send tokens to the specified address
    const result = await sendTx(address);
    console.log('Sent tokens to', address);

    // Update the frequency checker for the recipient address
    checker.update(address);

    // Respond with the result of the transaction
    res.send(safeJsonStringify({ result }));
  } catch (error) {
    console.error("Error in /send/:address:", error);

    // Handle specific error related to non-existent blockchain account
    if (error.message && error.message.includes("does not exist on chain")) {
      return res.status(400).json({ result: `Address [${address}] does not exist on the blockchain. Please create the account first.` });
    }

    // Handle all other errors
    res.status(500).json({ result: 'Failed to send tokens. Please contact the administrator.' });
  }
});

/**
 * Helper function to safely stringify JSON objects, handling BigInt types.
 * @param {Object} obj - The object to stringify.
 * @returns {string} - The JSON string representation of the object.
 */
function safeJsonStringify(obj) {
  return JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
  );
}

// Start the Express server on the configured port
app.listen(conf.port, () => {
  console.log(`Faucet app listening on port ${conf.port}`);
});

/**
 * Function to send tokens to a recipient address.
 * @param {string} recipient - The blockchain address to send tokens to.
 * @returns {Object} - The result of the transaction.
 */
async function sendTx(recipient) {
  try {
    // Create a wallet from the mnemonic and options provided in the config
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        conf.sender.mnemonic,
        conf.sender.option
    );
    const [firstAccount] = await wallet.getAccounts();

    // Connect to the blockchain RPC endpoint with the wallet as the signer
    const rpcEndpoint = conf.blockchain.rpc_endpoint;
    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);

    // Verify that the connected chain ID matches the expected chain ID in the config
    const chainId = await client.getChainId();
    if (chainId !== conf.blockchain.chain_id) {
      throw new Error(
          `Chain-id mismatch: expected ${conf.blockchain.chain_id}, got ${chainId}`
      );
    }

    // Retrieve account details to get accountNumber and sequence
    const account = await client.getAccount(firstAccount.address);
    if (!account) {
      throw new Error(
          `Account [${firstAccount.address}] does not exist on the blockchain.`
      );
    }

    const accountNumber = account.accountNumber;
    const sequence = account.sequence;

    // Validate the transaction amount format from the config
    const amount = conf.tx.amount; // Expected format: { amount: "1000000", denom: "uint3" }
    if (!amount || !amount.amount || !amount.denom) {
      throw new Error("Invalid transaction amount format in configuration.");
    }

    // Validate the transaction fee format from the config
    const fee = conf.tx.fee; // Expected format: { amount: [{ amount: "500", denom: "uint3" }], gas: "200000" }
    if (!fee || !fee.amount || !fee.gas) {
      throw new Error("Invalid transaction fee format in configuration.");
    }

    console.log(
        `Sending ${amount.amount} ${amount.denom} from ${firstAccount.address} to ${recipient}`
    );
    console.log(`Using account number: ${accountNumber}, sequence: ${sequence}`);

    // Send the tokens to the recipient address
    const result = await client.sendTokens(
        firstAccount.address,
        recipient,
        [amount],
        fee,
        {
          accountNumber: accountNumber,
          sequence: sequence,
        }
    );

    return result;
  } catch (error) {
    // Add context to the error and re-throw
    console.error(`Failed to send transaction to recipient ${recipient}:`, error);
    throw new Error(
        `Transaction failed for recipient ${recipient}: ${error.message}`
    );
  }
}
