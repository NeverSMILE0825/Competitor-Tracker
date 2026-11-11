import { fetchJson } from "./http.js";

const BASE = "https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api";
let tail = Promise.resolve();

function pacedJson(url) {
  const job = tail.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return fetchJson(url);
  });
  tail = job.catch(() => {});
  return job;
}

function rowsFrom(body) {
  if (Array.isArray(body?.result)) return body.result;
  const text = `${body?.message ?? ""} ${body?.result ?? ""}`;
  if (body?.status === "0" && /no (transactions|internal|token|records)/i.test(text)) return [];
  if (body?.status === "0") throw new Error(text.trim() || "Explorer request failed");
  throw new Error("Explorer returned an unexpected payload");
}

async function explorerList(params) {
  const query = new URLSearchParams(params);
  const body = await pacedJson(`${BASE}?${query}`);
  return rowsFrom(body);
}

async function everyPage(params, pageSize = 100, maxPages = 20) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await explorerList({ ...params, page: String(page), offset: String(pageSize), sort: "asc" });
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, complete: true };
  }
  return { rows, complete: false };
}

export function createBlockscout() {
  return {
    async contract(address) {
      const rows = await explorerList({
        module: "contract",
        action: "getcontractcreation",
        contractaddresses: address,
      });
      const row = rows[0];
      if (!row?.contractCreator) return null;
      return {
        address: address.toLowerCase(),
        creator: String(row.contractCreator).toLowerCase(),
        creationTx: String(row.txHash ?? row.hash).toLowerCase(),
        name: null,
        symbol: null,
        decimals: null,
      };
    },
    async firstPage(action, address) {
      return explorerList({
        module: "account",
        action,
        address,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "100",
        sort: "asc",
      });
    },
    async allTransactions(address) {
      return everyPage({
        module: "account",
        action: "txlist",
        address,
        startblock: "0",
        endblock: "99999999",
      });
    },
    async allInternal(address) {
      return everyPage({
        module: "account",
        action: "txlistinternal",
        address,
        startblock: "0",
        endblock: "99999999",
      });
    },
    async allTokenTransfers(address, contractAddress) {
      return everyPage({
        module: "account",
        action: "tokentx",
        address,
        contractaddress: contractAddress,
        startblock: "0",
        endblock: "99999999",
      });
    },
    async logs({ address, topic0, topic1, fromBlock, toBlock, page = 1, offset = 1000 }) {
      return explorerList({
        module: "logs",
        action: "getLogs",
        address,
        topic0,
        topic1,
        topic0_1_opr: "and",
        fromBlock: String(fromBlock),
        toBlock: String(toBlock),
        page: String(page),
        offset: String(offset),
      });
    },
  };
}
