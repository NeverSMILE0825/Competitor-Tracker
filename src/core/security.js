export function parseGoPlus(body, address) {
  const key = String(address ?? "").toLowerCase();
  const row = body?.result?.[key];
  if (!row || typeof row !== "object") return { available: false, banStatus: "unknown" };
  const honeypot = row.is_honeypot === "1";
  const blacklisted = row.is_blacklisted === "1";
  const cannotBuy = row.cannot_buy === "1";
  const flagged = honeypot || blacklisted || cannotBuy;
  return {
    available: true,
    honeypot,
    blacklisted,
    cannotBuy,
    banStatus: flagged ? "flagged" : "clear",
  };
}

export function mergeBanStatus(goplusStatus, dextoolsStatus) {
  if (dextoolsStatus === "banned") return "banned";
  if (goplusStatus === "flagged") return "flagged";
  if (goplusStatus === "clear" && (!dextoolsStatus || dextoolsStatus === "unknown")) return "clear";
  if (dextoolsStatus && dextoolsStatus !== "unknown") return dextoolsStatus;
  return goplusStatus ?? "unknown";
}
