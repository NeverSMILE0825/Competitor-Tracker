import { paymentMillis } from "./format.js";

function asList(body) {
  if (Array.isArray(body)) return { orders: body, boosts: [] };
  return {
    orders: Array.isArray(body?.orders) ? body.orders : [],
    boosts: Array.isArray(body?.boosts) ? body.boosts : [],
  };
}

export function parseDexOrders(body) {
  const { orders, boosts } = asList(body);
  const profiles = orders.filter((order) => order.type === "tokenProfile");
  const approved = profiles
    .filter((order) => order.status === "approved" && order.paymentTimestamp)
    .sort((left, right) => Number(right.paymentTimestamp) - Number(left.paymentTimestamp));
  const chosen = approved[0] ?? null;
  const boostAmounts = boosts.map((boost) => Number(boost.totalAmount ?? boost.amount ?? 0)).filter((amount) => amount > 0);
  const boostTimestamp = boosts.map((boost) => paymentMillis(boost.paymentTimestamp)).find(Boolean) ?? null;
  return {
    paid: Boolean(chosen),
    paymentTimestamp: chosen ? paymentMillis(chosen.paymentTimestamp) : null,
    status: chosen?.status ?? (profiles[0]?.status ?? null),
    orderType: chosen?.type ?? null,
    boostAmount: boostAmounts.length ? Math.max(...boostAmounts) : null,
    boostTimestamp,
  };
}

export function parseDexPairs(body) {
  const pairs = Array.isArray(body) ? body : (body?.pairs ?? []);
  if (!pairs.length) return null;
  const ranked = [...pairs].sort((left, right) => Number(right.liquidity?.usd ?? 0) - Number(left.liquidity?.usd ?? 0));
  const pair = ranked[0];
  const buys = Number(pair.txns?.h24?.buys ?? 0);
  const sells = Number(pair.txns?.h24?.sells ?? 0);
  return {
    chainId: pair.chainId ?? null,
    dexId: pair.dexId ?? null,
    labels: pair.labels ?? [],
    pairAddress: pair.pairAddress ?? null,
    name: pair.baseToken?.name ?? null,
    symbol: pair.baseToken?.symbol ?? null,
    quoteSymbol: pair.quoteToken?.symbol ?? null,
    quoteAddress: pair.quoteToken?.address ?? null,
    marketCap: pair.marketCap ?? pair.fdv ?? null,
    volumeH24: pair.volume?.h24 ?? null,
    txH24: buys + sells,
    pooledQuote: pair.liquidity?.quote ?? null,
    pairCreatedAt: pair.pairCreatedAt ?? null,
  };
}

export function rankInList(entries, tokenAddress) {
  if (!Array.isArray(entries) || !tokenAddress) return null;
  const target = tokenAddress.toLowerCase();
  const index = entries.findIndex((entry) => String(entry.token ?? "").toLowerCase() === target);
  return index === -1 ? null : index + 1;
}
