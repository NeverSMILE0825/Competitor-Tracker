function asNumber(value) {
  if (value == null || value === "") return 0;
  return Number(value);
}

function inbound(tx, target, hashField) {
  const to = String(tx.to ?? "").toLowerCase();
  const from = String(tx.from ?? "").toLowerCase();
  let value = 0n;
  try {
    value = BigInt(tx.value || 0);
  } catch {
    return null;
  }
  if (to !== target || !from || from === target || value <= 0n) return null;
  if (String(tx.isError ?? "0") !== "0") return null;
  return {
    from,
    value: value.toString(),
    block: asNumber(tx.blockNumber),
    txIndex: asNumber(tx.transactionIndex),
    traceIndex: asNumber(tx.index ?? -1),
    hash: String(tx[hashField] ?? "").toLowerCase(),
    timestamp: asNumber(tx.timeStamp ?? tx.timestamp),
  };
}

export function pickFunder(address, normalTxs, internalTxs) {
  const target = String(address).toLowerCase();
  const candidates = [];
  for (const tx of normalTxs ?? []) {
    const row = inbound(tx, target, "hash");
    if (row?.hash) candidates.push({ ...row, traceIndex: -1 });
  }
  for (const tx of internalTxs ?? []) {
    const row = inbound(tx, target, tx.transactionHash ? "transactionHash" : "hash");
    if (row?.hash) candidates.push(row);
  }
  candidates.sort((left, right) => (
    left.block - right.block
    || left.txIndex - right.txIndex
    || left.traceIndex - right.traceIndex
    || left.timestamp - right.timestamp
  ));
  return candidates[0] ?? null;
}

export function matchCompetitor(competitors, identity) {
  const creator = identity.creator?.toLowerCase() ?? "";
  const funder = identity.funder?.toLowerCase() ?? "";
  const ranked = [...(competitors ?? [])].sort((left, right) => {
    if (left.watchKind === right.watchKind) return left.id - right.id;
    return left.watchKind === "creator" ? -1 : 1;
  });
  return ranked.find((row) => {
    const address = row.address.toLowerCase();
    if (row.watchKind === "creator") return address === creator;
    return Boolean(funder) && address === funder;
  }) ?? null;
}
