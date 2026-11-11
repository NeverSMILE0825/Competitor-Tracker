import { WETH } from "./address.js";

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function hashOf(tx) {
  return lower(tx.hash ?? tx.transactionHash);
}

function pushTouched(target, transfers, token, cluster) {
  for (const transfer of transfers ?? []) {
    if (lower(transfer.contractAddress ?? token) !== token) continue;
    const from = lower(transfer.from);
    const to = lower(transfer.to);
    if (cluster.has(from) || cluster.has(to)) target.add(hashOf(transfer));
  }
}

function nativeDelta(hash, cluster, normalTxs, internalTxs) {
  let delta = 0n;
  for (const tx of normalTxs ?? []) {
    if (hashOf(tx) !== hash) continue;
    const value = BigInt(tx.value || 0);
    if (cluster.has(lower(tx.from))) delta -= value;
    if (cluster.has(lower(tx.to))) delta += value;
  }
  for (const tx of internalTxs ?? []) {
    if (hashOf(tx) !== hash) continue;
    if (String(tx.isError ?? "0") !== "0") continue;
    const value = BigInt(tx.value || 0);
    if (value === 0n) continue;
    if (cluster.has(lower(tx.to))) delta += value;
  }
  return delta;
}

function tokenDelta(hash, cluster, transfers, token) {
  let delta = 0n;
  for (const transfer of transfers ?? []) {
    if (hashOf(transfer) !== hash) continue;
    if (lower(transfer.contractAddress ?? token) !== token) continue;
    const value = BigInt(transfer.value || 0);
    if (cluster.has(lower(transfer.to))) delta += value;
    if (cluster.has(lower(transfer.from))) delta -= value;
  }
  return delta;
}

export function computeQuoteIncome({
  cluster,
  tokenAddress,
  normalTxs,
  internalTxs,
  tokenTransfers,
  wethTransfers,
  quoteTransfers,
  quoteToken,
  quoteMode,
}) {
  const members = new Set((cluster ?? []).map(lower));
  const token = lower(tokenAddress);
  const touched = new Set();
  pushTouched(touched, tokenTransfers, token, members);

  let received = 0n;
  let spent = 0n;
  const lines = [];
  for (const hash of touched) {
    if (!hash) continue;
    let delta = 0n;
    if (quoteMode === "eth") {
      delta += nativeDelta(hash, members, normalTxs, internalTxs);
      delta += tokenDelta(hash, members, wethTransfers, WETH);
    } else {
      delta += tokenDelta(hash, members, quoteTransfers, lower(quoteToken));
    }
    if (delta > 0n) received += delta;
    else if (delta < 0n) spent += -delta;
    lines.push({ hash, delta: delta.toString() });
  }
  lines.sort((left, right) => left.hash.localeCompare(right.hash));
  return {
    received: received.toString(),
    spent: spent.toString(),
    net: (received - spent).toString(),
    lines,
  };
}
