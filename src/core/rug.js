export function quoteReserveDrop(previous, next, thresholdBps = 8000) {
  if (previous == null || next == null) return { rugged: false, reason: "missing" };
  const before = BigInt(previous);
  const after = BigInt(next);
  if (before <= 0n) return { rugged: false, reason: "empty", dropBps: 0 };
  if (after >= before) return { rugged: false, reason: "no drop", dropBps: 0 };
  const dropBps = Number(((before - after) * 10000n) / before);
  return {
    rugged: dropBps >= thresholdBps,
    reason: dropBps >= thresholdBps ? "quote reserve drop" : "price move",
    dropBps,
  };
}

export function extractionRug(pooledQuoteWei, extractedWei, thresholdBps = 8000) {
  if (pooledQuoteWei == null || extractedWei == null) return { rugged: false, reason: "missing" };
  const pooled = BigInt(pooledQuoteWei);
  const extracted = BigInt(extractedWei);
  if (pooled <= 0n || extracted <= 0n) return { rugged: false, reason: "none", dropBps: 0 };
  const dropBps = Number((extracted * 10000n) / pooled);
  return {
    rugged: dropBps >= thresholdBps,
    reason: dropBps >= thresholdBps ? "quote extracted in one tx" : "partial sell",
    dropBps,
  };
}

export function largestPositive(lines) {
  let max = 0n;
  let hash = null;
  for (const line of lines ?? []) {
    const delta = BigInt(line.delta || 0);
    if (delta > max) {
      max = delta;
      hash = line.hash;
    }
  }
  return { wei: max.toString(), hash };
}
