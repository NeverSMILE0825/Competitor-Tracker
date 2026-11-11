import { fetchJson, hexQuantity } from "./http.js";

const DEFAULTS = [
  "https://eth.drpc.org",
  "https://ethereum.publicnode.com",
  "https://1rpc.io/eth",
];

export function createRpc(urls = DEFAULTS) {
  async function call(method, params) {
    let lastError = null;
    for (const url of urls) {
      try {
        const body = await fetchJson(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (body.error) {
          lastError = new Error(body.error.message || "RPC error");
          continue;
        }
        if (body.result == null && method !== "eth_getCode") {
          lastError = new Error(`${method} returned null`);
          continue;
        }
        return body.result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No RPC endpoint answered");
  }

  return {
    async blockNumber() {
      return Number(BigInt(await call("eth_blockNumber", [])));
    },
    async getBlock(blockNumber) {
      return call("eth_getBlockByNumber", [hexQuantity(blockNumber), true]);
    },
    async getLogs({ address, topics, fromBlock, toBlock }) {
      return call("eth_getLogs", [{
        address,
        topics,
        fromBlock: hexQuantity(fromBlock),
        toBlock: hexQuantity(toBlock),
      }]);
    },
    async getReceipt(hash) {
      return call("eth_getTransactionReceipt", [hash]);
    },
    async decimals(token) {
      const result = await call("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]);
      if (!result || result === "0x") return null;
      return Number(BigInt(result));
    },
  };
}
