import dotenv from 'dotenv';
import { stringToPath } from '@cosmjs/crypto'

const envFile = '.env';
dotenv.config({ path: envFile });

export default {
    port: 3838, // http port
    db: {
        path: "./db/faucet.db" // save request states
    },
    project: {
        name: "Int3face",
        logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/int3face/images/int3.png",
        deployer: `<a href="#">Int3face</a>`
    },
    blockchain: {
        chain_id: process.env.CHAIN_ID || "",
        rpc_endpoint:process.env.RPC_ENDPOINT || "",
    },
    sender: {
        mnemonic: process.env.FAUCET_MNEMONIC || "",
        option: {
            hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
            prefix: "int3"
        }
    },
    tx: {
        amount: {
            denom: "uint3",
            amount: "1000000"
        },
        fee: {
            amount: [
                {
                    amount: "1000",
                    denom: "uint3"
                }
            ],
            gas: "200000"
        },
    },
    limit: {
        // how many times each wallet address is allowed in a window(24h)
        address: 5,
        // how many times each ip is allowed in a window(24h),
        // if you use proxy, double check if the req.ip is return client's ip.
        ip: 5
    }
}