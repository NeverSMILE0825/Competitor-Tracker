function tokenLabel(row) {
  return row.symbol || row.address;
}

export function planAlerts(previous, next) {
  const chain = next.chain || "ethereum";
  const token = next.address;
  const alerts = [];
  if (next.competitorId && !previous?.competitorId) {
    alerts.push({
      id: `contract_started:${chain}:${token}`,
      kind: "contract_started",
      title: `Contract started · ${tokenLabel(next)}`,
      body: `${next.creator} funded by ${next.funder} (${next.competitorLabel})`,
    });
  }
  if (next.dexPaidAt && next.dexPaidAt !== previous?.dexPaidAt) {
    alerts.push({
      id: `dexscreener_paid:${chain}:${token}:${next.dexPaidAt}`,
      kind: "dexscreener_paid",
      title: `DexScreener paid · ${tokenLabel(next)}`,
      body: `${next.dexPaidStatus} token info · ${new Date(next.dexPaidAt).toISOString()} · ban ${next.banStatus}`,
    });
  }
  if (next.boostAt && next.boostAt !== previous?.boostAt) {
    alerts.push({
      id: `dexscreener_boost:${chain}:${token}:${next.boostAt}`,
      kind: "dexscreener_paid",
      title: `DexScreener boost · ${tokenLabel(next)}`,
      body: `Amount ${next.boostAmount ?? "unknown"} · ban ${next.banStatus}`,
    });
  }
  if (next.dextoolsInfoAt && next.dextoolsInfoAt !== previous?.dextoolsInfoAt) {
    alerts.push({
      id: `dextools_info:${chain}:${token}:${next.dextoolsInfoAt}`,
      kind: "dextools_paid",
      title: `DexTools paid · ${tokenLabel(next)}`,
      body: `Token info updated · ban ${next.banStatus}`,
    });
  }
  if (next.dextoolsNitroAt && next.dextoolsNitroAt !== previous?.dextoolsNitroAt) {
    alerts.push({
      id: `dextools_nitro:${chain}:${token}:${next.dextoolsNitroAt}`,
      kind: "dextools_paid",
      title: `DexTools Nitro · ${tokenLabel(next)}`,
      body: `Nitro added · ban ${next.banStatus}`,
    });
  }
  if (next.rugged && next.rugTx && next.rugTx !== previous?.rugTx) {
    alerts.push({
      id: `rugged:${chain}:${token}:${next.rugTx}`,
      kind: "rugged",
      title: `Rugged · ${tokenLabel(next)}`,
      body: `${next.rugReason} · ${next.rugTx}`,
    });
  }
  if (
    previous?.banStatus
    && previous.banStatus !== "unknown"
    && next.banStatus
    && next.banStatus !== "unknown"
    && next.banStatus !== previous.banStatus
  ) {
    alerts.push({
      id: `ban:${chain}:${token}:${previous.banStatus}:${next.banStatus}`,
      kind: "ban_changed",
      title: `Ban status · ${tokenLabel(next)}`,
      body: `${previous.banStatus} → ${next.banStatus}`,
    });
  }
  return alerts.map((alert) => ({ ...alert, chain, tokenAddress: token, competitorId: next.competitorId ?? null }));
}
