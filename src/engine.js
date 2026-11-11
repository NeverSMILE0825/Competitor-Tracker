import { WETH, ZERO_ADDRESS, normalizeAddress } from "./core/address.js";
import { planAlerts } from "./core/alerts.js";
import { parseDexOrders, parseDexPairs, rankInList } from "./core/dex.js";
import {
  FACTORY_V2,
  FACTORY_V3,
  POOL_MANAGER_V4,
  TOPIC_V2_PAIR,
  TOPIC_V3_POOL,
  TOPIC_V4_INIT,
  TOPIC_V4_SWAP,
  blocksDue,
  directCreates,
  initialCursor,
  tokensFromFactoryLog,
} from "./core/detect.js";
import { pickFunder, matchCompetitor } from "./core/funder.js";
import { decimalToUnits } from "./core/format.js";
import { computeQuoteIncome } from "./core/income.js";
import { extractionRug, largestPositive } from "./core/rug.js";
import { mergeBanStatus, parseGoPlus } from "./core/security.js";
import { readDexTools, readGoPlus } from "./sources/security.js";
import { readTrendingRanks } from "./sources/dexscreener.js";

function quoteModeFor(address) {
  const normalized = String(address ?? "").toLowerCase();
  if (!normalized || normalized === ZERO_ADDRESS || normalized === WETH) return "eth";
  return "token";
}

export function createEngine(options) {
  const db = options.db;
  const rpc = options.rpc;
  const blockscout = options.blockscout;
  const dex = options.dex;
  const goplus = options.goplus ?? readGoPlus;
  const dextools = options.dextools ?? readDexTools;
  const trending = options.trending ?? readTrendingRanks;
  const onAlerts = options.onAlerts;
  const status = {
    head: null,
    lastBlock: null,
    behind: 0,
    lastError: null,
    lastTick: null,
    watching: false,
  };
  let timer = null;
  let ticking = false;

  function storeAlerts(alerts) {
    const created = db.insertAlerts(alerts);
    if (created.length && onAlerts) Promise.resolve(onAlerts(created)).catch(() => {});
    return created;
  }

  async function resolveFunder(creator) {
    const cached = db.getCreator(creator);
    if (cached?.funder) return cached;
    const [normal, internal] = await Promise.all([
      blockscout.firstPage("txlist", creator),
      blockscout.firstPage("txlistinternal", creator),
    ]);
    const funder = pickFunder(creator, normal, internal);
    if (!funder) throw new Error("No inbound ETH found for the contract creator");
    const row = {
      address: creator,
      funder: funder.from,
      fundingTx: funder.hash,
      fundingBlock: funder.block,
      fundingValue: funder.value,
    };
    db.saveCreator(row);
    return row;
  }

  async function countLogRange(pairAddress, fromBlock, toBlock, depth = 0) {
    try {
      let count = 0;
      let previousMarker = null;
      for (let page = 1; page <= 50; page += 1) {
        const rows = await blockscout.logs({
          address: POOL_MANAGER_V4,
          topic0: TOPIC_V4_SWAP,
          topic1: pairAddress.toLowerCase(),
          fromBlock,
          toBlock,
          page,
          offset: 1000,
        });
        const marker = rows[0]?.transactionHash ?? null;
        if (marker && marker === previousMarker) throw new Error("Swap log pages repeated");
        previousMarker = marker;
        count += rows.length;
        if (rows.length < 1000) return count;
      }
      throw new Error("Swap log pages did not end");
    } catch (error) {
      if (toBlock > fromBlock && depth < 12 && /large|timeout|limit|narrow|window/i.test(error.message)) {
        const mid = Math.floor((fromBlock + toBlock) / 2);
        const left = await countLogRange(pairAddress, fromBlock, mid, depth + 1);
        const right = await countLogRange(pairAddress, mid + 1, toBlock, depth + 1);
        return left + right;
      }
      throw error;
    }
  }

  async function countSwaps(pairAddress, fromBlock) {
    if (!pairAddress || !/^0x[0-9a-fA-F]{64}$/.test(pairAddress)) return { count: null, exact: false };
    const head = await rpc.blockNumber();
    let count = 0;
    for (let start = fromBlock; start <= head; start += 2000) {
      count += await countLogRange(pairAddress, start, Math.min(head, start + 1999));
    }
    return { count, exact: true };
  }

  async function classifyToken(input, settings = {}) {
    const address = normalizeAddress(input);
    const contract = await blockscout.contract(address);
    if (!contract?.creator || !contract.creationTx) throw new Error("Contract creator was not found");
    const funding = await resolveFunder(contract.creator);
    const competitor = matchCompetitor(db.listCompetitors(), {
      creator: contract.creator,
      funder: funding.funder,
    });
    const previous = db.getToken(address);

    let pairs = null;
    let orders = null;
    try { pairs = parseDexPairs(await dex.token(address)); } catch { pairs = null; }
    try { orders = parseDexOrders(await dex.orders(address)); } catch { orders = null; }

    const quoteAddress = pairs?.quoteAddress ? String(pairs.quoteAddress).toLowerCase() : null;
    const quoteMode = quoteModeFor(quoteAddress);
    let normal = null;
    let internal = null;
    let income = null;
    let incomeExact = false;
    let incomeError = null;
    try {
      const tokenTransfers = await blockscout.allTokenTransfers(contract.creator, address);
      [normal, internal] = await Promise.all([
        blockscout.allTransactions(contract.creator),
        blockscout.allInternal(contract.creator),
      ]);
      const wethTransfers = quoteMode === "eth"
        ? await blockscout.allTokenTransfers(contract.creator, WETH)
        : { rows: [], complete: true };
      const quoteTransfers = quoteMode === "token"
        ? await blockscout.allTokenTransfers(contract.creator, quoteAddress)
        : { rows: [], complete: true };
      incomeExact = normal.complete && internal.complete && tokenTransfers.complete && wethTransfers.complete && quoteTransfers.complete;
      income = computeQuoteIncome({
        cluster: [contract.creator],
        tokenAddress: address,
        normalTxs: normal.rows,
        internalTxs: internal.rows,
        tokenTransfers: tokenTransfers.rows,
        wethTransfers: wethTransfers.rows,
        quoteTransfers: quoteTransfers.rows,
        quoteToken: quoteAddress,
        quoteMode,
      });
    } catch (error) {
      income = null;
      incomeExact = false;
      incomeError = error.message;
    }
    if (!income && previous?.incomeNet != null) {
      income = {
        net: previous.incomeNet,
        received: previous.incomeReceived,
        spent: previous.incomeSpent,
        lines: db.incomeLines(address),
      };
      incomeExact = Boolean(previous.incomeExact);
    }

    const created = (normal?.rows ?? []).find((tx) => String(tx.hash ?? "").toLowerCase() === contract.creationTx);
    const createdBlock = created ? Number(created.blockNumber) : (previous?.createdBlock ?? null);

    let security = { banStatus: "unknown" };
    try { security = parseGoPlus(await goplus(address), address); } catch { security = { banStatus: "unknown" }; }
    let tools = { available: false };
    try { tools = await dextools(); } catch { tools = { available: false }; }
    const banStatus = mergeBanStatus(security.banStatus, tools.banStatus ?? "unknown");

    let swaps = { count: previous?.swapCount ?? null, exact: Boolean(previous?.swapCountExact) };
    let swapError = null;
    if (settings.countSwaps !== false && pairs?.labels?.includes("v4") && createdBlock && pairs.pairAddress) {
      try {
        swaps = await countSwaps(pairs.pairAddress, createdBlock);
      } catch (error) {
        swaps = { count: previous?.swapCount ?? null, exact: false };
        swapError = error.message;
      }
    }

    const pooledWei = pairs?.pooledQuote == null ? null : decimalToUnits(pairs.pooledQuote, quoteMode === "eth" ? 18 : 18);
    const extracted = largestPositive(income?.lines);
    const rug = extractionRug(pooledWei, extracted.wei);
    const rugged = Boolean(rug.rugged);
    const next = {
      chain: "ethereum",
      address,
      creator: contract.creator,
      funder: funding.funder,
      fundingTx: funding.fundingTx,
      fundingValue: funding.fundingValue,
      competitorId: competitor?.id ?? null,
      competitorLabel: competitor?.label ?? null,
      name: pairs?.name ?? contract.name ?? previous?.name ?? null,
      symbol: pairs?.symbol ?? contract.symbol ?? previous?.symbol ?? null,
      decimals: contract.decimals,
      createdBlock,
      createdTx: contract.creationTx,
      pairAddress: pairs?.pairAddress ?? previous?.pairAddress ?? null,
      dexId: pairs?.dexId ?? previous?.dexId ?? null,
      quoteSymbol: pairs?.quoteSymbol ?? previous?.quoteSymbol ?? null,
      quoteAddress,
      marketCap: pairs?.marketCap != null ? String(pairs.marketCap) : (previous?.marketCap ?? null),
      volumeH24: pairs?.volumeH24 != null ? String(pairs.volumeH24) : (previous?.volumeH24 ?? null),
      txH24: pairs?.txH24 ?? previous?.txH24 ?? null,
      pooledQuote: pairs?.pooledQuote != null ? String(pairs.pooledQuote) : (previous?.pooledQuote ?? null),
      swapCount: swaps.exact ? swaps.count : (previous?.swapCount ?? null),
      swapCountExact: swaps.exact,
      incomeNet: income?.net ?? null,
      incomeReceived: income?.received ?? null,
      incomeSpent: income?.spent ?? null,
      incomeExact,
      dexPaidAt: orders ? orders.paymentTimestamp : (previous?.dexPaidAt ?? null),
      dexPaidStatus: orders ? orders.status : (previous?.dexPaidStatus ?? null),
      boostAmount: orders?.boostAmount ?? previous?.boostAmount ?? null,
      boostAt: orders?.boostTimestamp ?? previous?.boostAt ?? null,
      dextoolsInfoAt: previous?.dextoolsInfoAt ?? null,
      dextoolsNitroAt: previous?.dextoolsNitroAt ?? null,
      trendingRank: previous?.trendingRank ?? null,
      hotRank: previous?.hotRank ?? null,
      rugged: rugged || Boolean(previous?.rugged),
      rugTx: rugged ? extracted.hash : (previous?.rugTx ?? null),
      rugReason: rugged ? rug.reason : (previous?.rugReason ?? null),
      banStatus,
    };
    const alerts = planAlerts(previous, next);
    db.saveToken(next);
    if (income?.lines) db.replaceIncomeLines(address, income.lines);
    const createdAlerts = storeAlerts(alerts);
    return {
      token: db.getToken(address),
      lines: db.incomeLines(address),
      alerts: createdAlerts,
      dextoolsAvailable: Boolean(tools.available),
      incomeError,
      swapError,
    };
  }

  async function inspectBlock(blockNumber) {
    const [block, logs] = await Promise.all([
      rpc.getBlock(blockNumber),
      rpc.getLogs({
        address: [FACTORY_V2, FACTORY_V3, POOL_MANAGER_V4],
        topics: [[TOPIC_V2_PAIR, TOPIC_V3_POOL, TOPIC_V4_INIT]],
        fromBlock: blockNumber,
        toBlock: blockNumber,
      }),
    ]);
    return {
      blockNumber,
      creates: directCreates(block?.transactions ?? []),
      tokens: (logs ?? []).flatMap((log) => tokensFromFactoryLog(log)),
    };
  }

  async function scanBlock(blockNumber) {
    const inspected = await inspectBlock(blockNumber);
    const candidates = new Map();
    for (const created of inspected.creates) candidates.set(created.contract, created.creator);
    for (const token of inspected.tokens) {
      if (!candidates.has(token)) candidates.set(token, null);
    }
    const matched = [];
    for (const [token, knownCreator] of candidates) {
      try {
        if (knownCreator) {
          const decimals = await rpc.decimals(token);
          if (decimals == null) continue;
        }
        let creator = knownCreator;
        if (!creator) creator = (await blockscout.contract(token))?.creator ?? null;
        if (!creator) continue;
        const funding = await resolveFunder(creator);
        const competitor = matchCompetitor(db.listCompetitors(), { creator, funder: funding.funder });
        if (!competitor) continue;
        const result = await classifyToken(token, { countSwaps: false });
        matched.push(result.token);
      } catch {
        /* one bad contract does not stop the block */
      }
    }
    return { ...inspected, matched };
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const head = await rpc.blockNumber();
      let saved = db.cursor();
      if (saved == null) {
        saved = initialCursor(head, null);
        db.setCursor(saved);
      }
      for (const blockNumber of blocksDue(saved, head, 2)) {
        await scanBlock(blockNumber);
        db.setCursor(blockNumber);
      }
      status.head = head;
      status.lastBlock = db.cursor();
      status.behind = head - status.lastBlock;
      status.lastError = null;
    } catch (error) {
      status.lastError = error.message;
    } finally {
      status.lastTick = Date.now();
      ticking = false;
    }
  }

  async function applyDexTools(input) {
    const address = normalizeAddress(input.address);
    const current = db.getToken(address);
    if (!current) throw new Error("Classify the token before attaching DexTools observations");
    const next = {
      ...current,
      dextoolsInfoAt: input.infoAt ?? current.dextoolsInfoAt,
      dextoolsNitroAt: input.nitroAt ?? current.dextoolsNitroAt,
      hotRank: input.hotRank ?? current.hotRank,
      banStatus: input.banned === true ? "banned" : current.banStatus,
    };
    const alerts = planAlerts(current, next);
    db.saveToken(next);
    return { token: db.getToken(address), alerts: storeAlerts(alerts) };
  }

  async function refreshTrending() {
    const feed = await trending();
    if (!feed.available) return { available: false, reason: feed.reason, updated: 0 };
    let updated = 0;
    for (const token of db.listTokens()) {
      const rank = rankInList(feed.pairs, token.address);
      if (rank === token.trendingRank) continue;
      db.saveToken({ ...token, trendingRank: rank });
      updated += 1;
    }
    return { available: true, updated, listed: feed.pairs.length };
  }

  return {
    status,
    resolveFunder,
    classifyToken,
    inspectBlock,
    scanBlock,
    applyDexTools,
    refreshTrending,
    start() {
      if (timer) return;
      status.watching = true;
      timer = setInterval(() => { tick().catch((error) => { status.lastError = error.message; }); }, 4000);
      tick().catch((error) => { status.lastError = error.message; });
    },
    stop() {
      status.watching = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
