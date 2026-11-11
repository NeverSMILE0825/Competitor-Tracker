const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value) {
  return ADDRESS.test(String(value ?? "").trim());
}

export function normalizeAddress(value) {
  const trimmed = String(value ?? "").trim();
  if (!ADDRESS.test(trimmed)) {
    throw new Error("Expected a 20-byte hex address");
  }
  return trimmed.toLowerCase();
}

export function sameAddress(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const QUOTE_ASSETS = new Set([
  ZERO_ADDRESS,
  WETH,
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0x6b175474e89094c44da98b954eedeac495271d0f",
]);

export function isQuoteAsset(address) {
  return QUOTE_ASSETS.has(String(address ?? "").toLowerCase());
}
