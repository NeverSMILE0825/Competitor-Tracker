import { fetchJson } from "./http.js";

export async function readGoPlus(token) {
  return fetchJson(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${token}`);
}

export async function readDexTools() {
  try {
    const response = await fetch("https://www.dextools.io/shared/data/pair?chain=ether", {
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok || !text.trim().startsWith("{") && !text.trim().startsWith("[")) {
      return { available: false, reason: `DexTools HTTP ${response.status}` };
    }
    return { available: true, body: JSON.parse(text) };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}
