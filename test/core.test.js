import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { planAlerts } from "../src/core/alerts.js";
import { createdContractAddress, directCreates, initialCursor, blocksDue, tokensFromFactoryLog, POOL_MANAGER_V4, TOPIC_V4_INIT } from "../src/core/detect.js";
import { parseDexOrders, parseDexPairs, rankInList } from "../src/core/dex.js";
import { pickFunder, matchCompetitor } from "../src/core/funder.js";
import { decimalToUnits, formatUnits } from "../src/core/format.js";
import { computeQuoteIncome } from "../src/core/income.js";
import { extractionRug, quoteReserveDrop } from "../src/core/rug.js";
import { mergeBanStatus, parseGoPlus } from "../src/core/security.js";
import { openDatabase } from "../src/db.js";

const CREATOR = "0x4c1c3bf1bcbef60852bd1fcb6039135e05a2d74a";
const FUNDER = "0x037741ef196087b26abfb173b64d05df23fadc72";
const TOKEN = "0x0dc4bc369ff564543738ebb04f2f1e6f4343f3b7";

test("create address of the Dacity deployer nonce 0 is the token", () => {
  assert.equal(createdContractAddress(CREATOR, 0), TOKEN);
  assert.equal(createdContractAddress(CREATOR, "0x0"), TOKEN);
});

test("direct creates ignore calls and decode a hex nonce", () => {
  const creates = directCreates([
    { from: CREATOR, to: FUNDER, nonce: "0x1", hash: "0xabc" },
    { from: CREATOR, to: null, nonce: "0x0", hash: "0xdef" },
  ]);
  assert.deepEqual(creates, [{ creator: CREATOR, contract: TOKEN, hash: "0xdef", nonce: 0 }]);
});

test("funded-by picks the earliest inbound ETH, including an earlier internal transfer", () => {
  const chosen = pickFunder(CREATOR, [
    { from: FUNDER, to: CREATOR, value: "497600000000000000", blockNumber: "26341449", transactionIndex: "89", hash: "0xfund", timeStamp: "1793795291" },
  ], [
    { from: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", to: CREATOR, value: "250169320772283", blockNumber: "26341810", index: "17", transactionHash: "0xlater", isError: "0", timeStamp: "1793799659" },
    { from: "0x1111111111111111111111111111111111111111", to: CREATOR, value: "1", blockNumber: "10", index: "0", transactionHash: "0xearly", isError: "0", timeStamp: "1" },
    { from: "0x2222222222222222222222222222222222222222", to: CREATOR, value: "9", blockNumber: "9", index: "0", transactionHash: "0xfail", isError: "1", timeStamp: "1" },
  ]);
  assert.equal(chosen.hash, "0xearly");
  assert.equal(chosen.from, "0x1111111111111111111111111111111111111111");
});

test("funded-by ignores zero-value and self transfers", () => {
  const chosen = pickFunder(CREATOR, [
    { from: CREATOR, to: CREATOR, value: "5", blockNumber: "1", transactionIndex: "0", hash: "0xself" },
    { from: FUNDER, to: CREATOR, value: "0", blockNumber: "2", transactionIndex: "0", hash: "0xzero" },
    { from: FUNDER, to: CREATOR, value: "497600000000000000", blockNumber: "3", transactionIndex: "1", hash: "0xfund" },
  ], []);
  assert.equal(chosen.hash, "0xfund");
  assert.equal(chosen.value, "497600000000000000");
});

test("a creator watch wins over a shared funder watch", () => {
  const match = matchCompetitor([
    { id: 1, address: FUNDER, watchKind: "funder" },
    { id: 2, address: CREATOR, watchKind: "creator" },
  ], { creator: CREATOR, funder: FUNDER });
  assert.equal(match.id, 2);
});

test("income nets the router refund inside one transaction and excludes the funding transfer", () => {
  const launch = "0x79f1c1a4b0719d176859529428ea35c150fe572ea73009f82ba411f5a7bac65c";
  const result = computeQuoteIncome({
    cluster: [CREATOR],
    tokenAddress: TOKEN,
    quoteMode: "eth",
    normalTxs: [
      { hash: "0xfund", from: FUNDER, to: CREATOR, value: "497600000000000000" },
      { hash: launch, from: CREATOR, to: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", value: "250169320772283" },
      { hash: "0xsell", from: CREATOR, to: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", value: "0" },
    ],
    internalTxs: [
      { transactionHash: launch, from: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", to: CREATOR, value: "250169320772283", isError: "0" },
      { transactionHash: launch, from: CREATOR, to: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", value: "250169320772283", isError: "0" },
      { transactionHash: "0xsell", from: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", to: CREATOR, value: "1000000000000000000", isError: "0" },
    ],
    tokenTransfers: [
      { hash: launch, contractAddress: TOKEN, from: CREATOR, to: POOL_MANAGER_V4, value: "1" },
      { hash: "0xsell", contractAddress: TOKEN, from: CREATOR, to: POOL_MANAGER_V4, value: "1" },
    ],
    wethTransfers: [
      { hash: "0xsell", contractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", from: CREATOR, to: CREATOR, value: "0" },
    ],
  });
  assert.equal(result.net, "1000000000000000000");
  assert.equal(result.lines.find((line) => line.hash === launch).delta, "0");
  assert.equal(result.lines.some((line) => line.hash === "0xfund"), false);
});

test("wrapping ETH into WETH is not income", () => {
  const result = computeQuoteIncome({
    cluster: [CREATOR],
    tokenAddress: TOKEN,
    quoteMode: "eth",
    normalTxs: [{ hash: "0xwrap", from: CREATOR, to: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", value: "100" }],
    internalTxs: [],
    tokenTransfers: [{ hash: "0xwrap", contractAddress: TOKEN, from: CREATOR, to: POOL_MANAGER_V4, value: "1" }],
    wethTransfers: [{ hash: "0xwrap", contractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", from: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", to: CREATOR, value: "100" }],
  });
  assert.equal(result.net, "0");
});

test("an 80 percent quote-reserve drop is a rug and a sale without it is not", () => {
  assert.equal(quoteReserveDrop(100n, 20n).rugged, true);
  assert.equal(quoteReserveDrop(100n, 21n).rugged, false);
  assert.equal(quoteReserveDrop(100n, 100n).rugged, false);
  assert.equal(extractionRug("10000000000000000000", "8000000000000000000").rugged, true);
  assert.equal(extractionRug("10000000000000000000", "1000000000000000000").rugged, false);
});

test("DexScreener orders keep the approved payment timestamp and ignore a cancelled one", () => {
  const parsed = parseDexOrders({
    orders: [
      { type: "tokenProfile", status: "approved", paymentTimestamp: 1793835981993 },
      { type: "tokenProfile", status: "cancelled", paymentTimestamp: 1793832875547 },
    ],
    boosts: [],
  });
  assert.equal(parsed.paid, true);
  assert.equal(parsed.paymentTimestamp, 1793835981993);
  assert.equal(parsed.status, "approved");
  const pairs = parseDexPairs([{
    chainId: "ethereum",
    dexId: "uniswap",
    labels: ["v4"],
    pairAddress: "0x443788ef13a2108291a44c60537d62a107042e52e0440152053af7a54d52c9cb",
    baseToken: { name: "Dacity Coin", symbol: "DACITY" },
    quoteToken: { address: "0x0000000000000000000000000000000000000000", symbol: "ETH" },
    txns: { h24: { buys: 1381, sells: 1092 } },
    volume: { h24: 2124235.82 },
    liquidity: { usd: 172281.31, quote: 41.6472 },
    marketCap: 3763964,
  }]);
  assert.equal(pairs.txH24, 2473);
  assert.equal(pairs.quoteSymbol, "ETH");
  assert.equal(pairs.pooledQuote, 41.6472);
});

test("rank is null when the token is absent", () => {
  assert.equal(rankInList([{ token: "0xabc" }], TOKEN), null);
  assert.equal(rankInList([{ token: TOKEN }, { token: "0xabc" }], TOKEN), 1);
});

test("GoPlus clear does not become banned, and a DexTools ban overrides it", () => {
  const parsed = parseGoPlus({ result: { [TOKEN]: { is_honeypot: "0", is_blacklisted: "0", cannot_buy: "0" } } }, TOKEN);
  assert.equal(parsed.banStatus, "clear");
  assert.equal(mergeBanStatus("clear", "unknown"), "clear");
  assert.equal(mergeBanStatus("clear", "banned"), "banned");
  assert.equal(parseGoPlus({ result: {} }, TOKEN).banStatus, "unknown");
});

test("alerts fire on the transition and not on the first unknown ban reading", () => {
  const next = {
    chain: "ethereum",
    address: TOKEN,
    symbol: "DACITY",
    creator: CREATOR,
    funder: FUNDER,
    competitorId: 1,
    competitorLabel: "Binance 153",
    dexPaidAt: 1793835981993,
    dexPaidStatus: "approved",
    banStatus: "clear",
  };
  const first = planAlerts(null, next);
  assert.deepEqual(first.map((alert) => alert.kind), ["contract_started", "dexscreener_paid"]);
  assert.equal(planAlerts(next, next).length, 0);
  const banned = planAlerts({ ...next, banStatus: "clear" }, { ...next, banStatus: "banned" });
  assert.equal(banned[0].kind, "ban_changed");
  assert.equal(planAlerts(null, { ...next, competitorId: null, dexPaidAt: null }).length, 0);
});

test("v4 initialize log yields the non-quote token", () => {
  const iface = new ethers.Interface([
    "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  ]);
  const encoded = iface.encodeEventLog("Initialize", [
    `0x${"11".repeat(32)}`,
    "0x0000000000000000000000000000000000000000",
    TOKEN,
    3000,
    60,
    "0x0000000000000000000000000000000000000000",
    1,
    0,
  ]);
  const tokens = tokensFromFactoryLog({ address: POOL_MANAGER_V4, topics: encoded.topics, data: encoded.data });
  assert.deepEqual(tokens, [TOKEN]);
  assert.equal(encoded.topics[0], TOPIC_V4_INIT);
});

test("the watcher starts at the current head and then walks forward without skipping", () => {
  assert.equal(initialCursor(500, null), 500);
  assert.equal(initialCursor(500, 490), 490);
  assert.deepEqual(blocksDue(100, 10000, 3), [101, 102, 103]);
  assert.deepEqual(blocksDue(100, 100, 3), []);
});

test("unit formatting never uses a float", () => {
  assert.equal(formatUnits("497600000000000000", 18), "0.4976");
  assert.equal(formatUnits("-1000000000000000000", 18), "-1");
  assert.equal(decimalToUnits("41.6472", 18), "41647200000000000000");
});

test("competitor add and delete are unlimited and unlink tokens", () => {
  const db = openDatabase(":memory:");
  for (let index = 0; index < 30; index += 1) {
    db.insertCompetitor({
      label: `desk ${index}`,
      address: `0x${index.toString(16).padStart(40, "0")}`,
      watchKind: "funder",
    });
  }
  assert.equal(db.listCompetitors().length, 30);
  const competitor = db.insertCompetitor({ label: "Binance 153", address: FUNDER, watchKind: "funder" });
  db.saveToken({
    address: TOKEN, creator: CREATOR, funder: FUNDER, fundingTx: "0xfund", fundingValue: "1",
    competitorId: competitor.id, name: "Dacity Coin", symbol: "DACITY", decimals: 18,
    createdBlock: 1, createdTx: "0xcreate", pairAddress: null, dexId: null, quoteSymbol: "ETH",
    quoteAddress: null, marketCap: null, volumeH24: null, txH24: null, pooledQuote: null,
    swapCount: null, swapCountExact: false, incomeNet: "0", incomeReceived: "0", incomeSpent: "0",
    incomeExact: true, dexPaidAt: null, dexPaidStatus: null, boostAmount: null, boostAt: null,
    dextoolsInfoAt: null, dextoolsNitroAt: null, trendingRank: null, hotRank: null,
    rugged: false, rugTx: null, rugReason: null, banStatus: "clear",
  });
  assert.equal(db.deleteCompetitor(competitor.id), true);
  assert.equal(db.getToken(TOKEN).competitorId, null);
  assert.equal(db.deleteCompetitor(competitor.id), false);
  db.close();
});
