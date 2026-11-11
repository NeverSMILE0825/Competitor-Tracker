const statusNode = document.querySelector("#status");
const competitorList = document.querySelector("#competitors");
const tokenBody = document.querySelector("#tokens");
const alertList = document.querySelector("#alerts");
const detail = document.querySelector("#detail");
const note = document.querySelector("#classify-note");

function cell(text) {
  const node = document.createElement("td");
  node.textContent = text == null || text === "" ? "—" : String(text);
  return node;
}

function short(value) {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function when(millis) {
  if (!millis) return "—";
  return new Date(millis).toISOString().replace(".000Z", "Z");
}

function formatUnits(value, decimals) {
  const raw = BigInt(value);
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

function incomeText(row) {
  if (!row.incomeExact || row.incomeNet == null) return "—";
  if (row.quoteSymbol === "ETH" || row.quoteSymbol === "WETH") return `${formatUnits(row.incomeNet, 18)} ${row.quoteSymbol}`;
  return `${row.incomeNet} ${row.quoteSymbol || "base units"}`;
}

function money(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

async function refresh() {
  const [health, competitors, tokens, alerts] = await Promise.all([
    request("/api/health"),
    request("/api/competitors"),
    request("/api/tokens"),
    request("/api/alerts"),
  ]);
  const watcher = health.watching ? `watching ${health.lastBlock ?? "…"}` : "watcher off";
  const behind = health.behind ? `, ${health.behind} blocks behind` : "";
  const problem = health.lastError ? ` · ${health.lastError}` : "";
  const telegram = health.telegram?.enabled ? `Telegram on for chat ${health.telegram.chatId}` : "Telegram off";
  const telegramError = health.telegram?.lastError ? ` · ${health.telegram.lastError}` : "";
  statusNode.textContent = `${watcher}${behind}${problem}. ${telegram}${telegramError}. DexTools is blank until a browser observation arrives. Income is the creator's net quote, gas excluded.`;

  competitorList.replaceChildren();
  for (const row of competitors) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${row.label} · ${row.watchKind} · ${short(row.address)}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async () => {
      await request(`/api/competitors/${row.id}`, { method: "DELETE" });
      await refresh();
    });
    item.append(text, button);
    competitorList.append(item);
  }

  tokenBody.replaceChildren();
  for (const row of tokens) {
    const tr = document.createElement("tr");
    tr.dataset.address = row.address;
    const name = document.createElement("td");
    name.textContent = `${row.symbol || row.name || "Token"} ${short(row.address)}`;
    tr.append(
      name,
      cell(row.competitorLabel),
      cell(short(row.creator)),
      cell(short(row.funder)),
      cell(money(row.marketCap)),
      cell(row.pooledQuote == null ? null : `${row.pooledQuote} ${row.quoteSymbol || ""}`.trim()),
      cell(money(row.volumeH24)),
      cell(row.txH24),
      cell(row.swapCountExact ? row.swapCount : null),
      cell(incomeText(row) === "—" ? null : incomeText(row)),
      cell(row.dexPaidAt ? when(row.dexPaidAt) : null),
      cell(row.trendingRank),
      cell(row.hotRank),
      cell(row.rugged ? "rugged" : "no"),
      cell(row.banStatus),
    );
    tr.addEventListener("click", () => {
      detail.textContent = JSON.stringify(row, null, 2);
    });
    tokenBody.append(tr);
  }

  alertList.replaceChildren();
  for (const alert of alerts) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${when(alert.createdAt)} · ${alert.title} — ${alert.body}`;
    item.append(text);
    alertList.append(item);
  }
}

document.querySelector("#competitor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  note.textContent = "";
  try {
    await request("/api/competitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: data.get("label"),
        address: data.get("address"),
        watchKind: data.get("watchKind"),
      }),
    });
    form.reset();
    await refresh();
  } catch (error) {
    note.textContent = error.message;
  }
});

document.querySelector("#classify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  note.textContent = "Classifying from chain data…";
  try {
    const result = await request("/api/tokens/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: data.get("address") }),
    });
    const token = result.token;
    note.textContent = token.competitorLabel
      ? `${token.symbol || "Token"} matched ${token.competitorLabel}.`
      : "Classified. No saved competitor matches the creator or funder.";
    detail.textContent = JSON.stringify(result, null, 2);
    await refresh();
  } catch (error) {
    note.textContent = error.message;
  }
});

const telegramNote = document.querySelector("#telegram-note");

document.querySelector("#telegram-discover").addEventListener("click", async () => {
  telegramNote.textContent = "Looking up the chat that last messaged the bot…";
  try {
    const found = await request("/api/telegram/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: document.querySelector("#telegram-token").value }),
    });
    document.querySelector("#telegram-chat").value = found.chatId;
    telegramNote.textContent = `Chat id ${found.chatId}. Save it to send alerts there.`;
  } catch (error) {
    telegramNote.textContent = error.message;
  }
});

document.querySelector("#telegram-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  telegramNote.textContent = "Checking the bot token with Telegram…";
  try {
    const saved = await request("/api/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: data.get("token"), chatId: data.get("chatId") }),
    });
    document.querySelector("#telegram-token").value = "";
    telegramNote.textContent = `Saved. Alerts will go to chat ${saved.chatId}.`;
    await refresh();
  } catch (error) {
    telegramNote.textContent = error.message;
  }
});

document.querySelector("#telegram-test").addEventListener("click", async () => {
  telegramNote.textContent = "Sending the test message…";
  try {
    await request("/api/telegram/test", { method: "POST" });
    telegramNote.textContent = "Test message sent. It is not a token alert.";
  } catch (error) {
    telegramNote.textContent = error.message;
  }
});

document.querySelector("#telegram-off").addEventListener("click", async () => {
  try {
    await request("/api/telegram", { method: "DELETE" });
    document.querySelector("#telegram-chat").value = "";
    telegramNote.textContent = "Telegram alerts are off.";
    await refresh();
  } catch (error) {
    telegramNote.textContent = error.message;
  }
});

document.querySelector("#refresh-trending").addEventListener("click", async () => {
  note.textContent = "Reading DexScreener trending…";
  const result = await request("/api/trending/refresh", { method: "POST" });
  note.textContent = result.available
    ? `Trending feed listed ${result.listed} pairs. Updated ${result.updated} tracked tokens.`
    : `Trending rank unavailable: ${result.reason}`;
  await refresh();
});

refresh().catch((error) => {
  statusNode.textContent = error.message;
});
setInterval(() => refresh().catch(() => {}), 5000);
