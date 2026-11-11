import { fetchJson } from "./http.js";

const BASE = "https://api.dexscreener.com";

export function createDexScreener() {
  return {
    async token(address) {
      return fetchJson(`${BASE}/tokens/v1/ethereum/${address}`);
    },
    async orders(address) {
      return fetchJson(`${BASE}/orders/v1/ethereum/${address}`);
    },
    async latestProfiles() {
      return fetchJson(`${BASE}/token-profiles/latest/v1`);
    },
    async profileUpdates() {
      return fetchJson(`${BASE}/token-profiles/recent-updates/v1`);
    },
    async latestBoosts() {
      return fetchJson(`${BASE}/token-boosts/latest/v1`);
    },
  };
}

export async function readTrendingRanks(timeoutMs = 8000) {
  if (typeof WebSocket === "undefined") return { available: false, reason: "no websocket" };
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish({ available: false, reason: "timeout" }), timeoutMs);
    try {
      socket = new WebSocket("wss://io.dexscreener.com/dex/screener/pairs/h24/1?rankBy[key]=trendingScoreH24&rankBy[order]=desc");
    } catch (error) {
      finish({ available: false, reason: error.message });
      return;
    }
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        const pairs = message.pairs || message.data;
        if (!Array.isArray(pairs) || !pairs.length || !pairs[0]?.baseToken) return;
        finish({
          available: true,
          pairs: pairs.map((pair, index) => ({
            rank: index + 1,
            chainId: pair.chainId,
            token: pair.baseToken?.address ?? null,
            pair: pair.pairAddress ?? null,
          })),
        });
      } catch {
        /* wait for a pairs payload */
      }
    });
    socket.addEventListener("error", () => finish({ available: false, reason: "socket error" }));
  });
}
