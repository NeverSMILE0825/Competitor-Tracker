import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'ethereum',
  watch_kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chain, address, watch_kind)
);
CREATE TABLE IF NOT EXISTS creators (
  address TEXT PRIMARY KEY,
  funder TEXT,
  funding_tx TEXT,
  funding_block INTEGER,
  funding_value TEXT,
  resolved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  creator TEXT,
  funder TEXT,
  funding_tx TEXT,
  funding_value TEXT,
  competitor_id INTEGER,
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  created_block INTEGER,
  created_tx TEXT,
  pair_address TEXT,
  dex_id TEXT,
  quote_symbol TEXT,
  quote_address TEXT,
  market_cap TEXT,
  volume_h24 TEXT,
  tx_h24 INTEGER,
  pooled_quote TEXT,
  swap_count INTEGER,
  swap_count_exact INTEGER,
  income_net TEXT,
  income_received TEXT,
  income_spent TEXT,
  income_exact INTEGER,
  dex_paid_at INTEGER,
  dex_paid_status TEXT,
  boost_amount INTEGER,
  boost_at INTEGER,
  dextools_info_at INTEGER,
  dextools_nitro_at INTEGER,
  trending_rank INTEGER,
  hot_rank INTEGER,
  rugged INTEGER NOT NULL DEFAULT 0,
  rug_tx TEXT,
  rug_reason TEXT,
  ban_status TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS income_lines (
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  hash TEXT NOT NULL,
  delta TEXT NOT NULL,
  PRIMARY KEY (chain, token_address, hash)
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  chain TEXT NOT NULL,
  token_address TEXT,
  competitor_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cursors (
  chain TEXT PRIMARY KEY,
  last_block INTEGER
);
`;

function mapToken(row) {
  if (!row) return null;
  return {
    chain: row.chain,
    address: row.address,
    creator: row.creator,
    funder: row.funder,
    fundingTx: row.funding_tx,
    fundingValue: row.funding_value,
    competitorId: row.competitor_id,
    competitorLabel: row.competitor_label ?? null,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    createdBlock: row.created_block,
    createdTx: row.created_tx,
    pairAddress: row.pair_address,
    dexId: row.dex_id,
    quoteSymbol: row.quote_symbol,
    quoteAddress: row.quote_address,
    marketCap: row.market_cap,
    volumeH24: row.volume_h24,
    txH24: row.tx_h24,
    pooledQuote: row.pooled_quote,
    swapCount: row.swap_count,
    swapCountExact: Boolean(row.swap_count_exact),
    incomeNet: row.income_net,
    incomeReceived: row.income_received,
    incomeSpent: row.income_spent,
    incomeExact: row.income_exact == null ? null : Boolean(row.income_exact),
    dexPaidAt: row.dex_paid_at,
    dexPaidStatus: row.dex_paid_status,
    boostAmount: row.boost_amount,
    boostAt: row.boost_at,
    dextoolsInfoAt: row.dextools_info_at,
    dextoolsNitroAt: row.dextools_nitro_at,
    trendingRank: row.trending_rank,
    hotRank: row.hot_rank,
    rugged: Boolean(row.rugged),
    rugTx: row.rug_tx,
    rugReason: row.rug_reason,
    banStatus: row.ban_status,
    updatedAt: row.updated_at,
  };
}

export function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return {
    db,
    close() {
      db.close();
    },
    listCompetitors() {
      return db.prepare("SELECT id, label, address, chain, watch_kind AS watchKind, created_at AS createdAt FROM competitors ORDER BY id").all();
    },
    insertCompetitor({ label, address, watchKind }) {
      const result = db.prepare(
        "INSERT INTO competitors(label, address, chain, watch_kind, created_at) VALUES (?, ?, 'ethereum', ?, ?)",
      ).run(label, address, watchKind, Date.now());
      return this.listCompetitors().find((row) => row.id === Number(result.lastInsertRowid));
    },
    deleteCompetitor(id) {
      const result = db.prepare("DELETE FROM competitors WHERE id = ?").run(id);
      db.prepare("UPDATE tokens SET competitor_id = NULL WHERE competitor_id = ?").run(id);
      return result.changes > 0;
    },
    getCreator(address) {
      return db.prepare("SELECT address, funder, funding_tx AS fundingTx, funding_block AS fundingBlock, funding_value AS fundingValue FROM creators WHERE address = ?").get(address) ?? null;
    },
    saveCreator(row) {
      db.prepare(`
        INSERT INTO creators(address, funder, funding_tx, funding_block, funding_value, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
          funder = excluded.funder,
          funding_tx = excluded.funding_tx,
          funding_block = excluded.funding_block,
          funding_value = excluded.funding_value,
          resolved_at = excluded.resolved_at
      `).run(row.address, row.funder, row.fundingTx, row.fundingBlock, row.fundingValue, Date.now());
    },
    getToken(address) {
      return mapToken(db.prepare(`
        SELECT tokens.*, competitors.label AS competitor_label
        FROM tokens LEFT JOIN competitors ON competitors.id = tokens.competitor_id
        WHERE tokens.chain = 'ethereum' AND tokens.address = ?
      `).get(address));
    },
    listTokens() {
      return db.prepare(`
        SELECT tokens.*, competitors.label AS competitor_label
        FROM tokens LEFT JOIN competitors ON competitors.id = tokens.competitor_id
        WHERE tokens.chain = 'ethereum'
        ORDER BY tokens.updated_at DESC
      `).all().map(mapToken);
    },
    saveToken(row) {
      db.prepare(`
        INSERT INTO tokens (
          chain, address, creator, funder, funding_tx, funding_value, competitor_id, name, symbol, decimals,
          created_block, created_tx, pair_address, dex_id, quote_symbol, quote_address, market_cap, volume_h24,
          tx_h24, pooled_quote, swap_count, swap_count_exact, income_net, income_received, income_spent, income_exact,
          dex_paid_at, dex_paid_status, boost_amount, boost_at, dextools_info_at, dextools_nitro_at, trending_rank,
          hot_rank, rugged, rug_tx, rug_reason, ban_status, updated_at
        ) VALUES (
          'ethereum', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(chain, address) DO UPDATE SET
          creator = excluded.creator,
          funder = excluded.funder,
          funding_tx = excluded.funding_tx,
          funding_value = excluded.funding_value,
          competitor_id = excluded.competitor_id,
          name = excluded.name,
          symbol = excluded.symbol,
          decimals = excluded.decimals,
          created_block = excluded.created_block,
          created_tx = excluded.created_tx,
          pair_address = excluded.pair_address,
          dex_id = excluded.dex_id,
          quote_symbol = excluded.quote_symbol,
          quote_address = excluded.quote_address,
          market_cap = excluded.market_cap,
          volume_h24 = excluded.volume_h24,
          tx_h24 = excluded.tx_h24,
          pooled_quote = excluded.pooled_quote,
          swap_count = excluded.swap_count,
          swap_count_exact = excluded.swap_count_exact,
          income_net = excluded.income_net,
          income_received = excluded.income_received,
          income_spent = excluded.income_spent,
          income_exact = excluded.income_exact,
          dex_paid_at = excluded.dex_paid_at,
          dex_paid_status = excluded.dex_paid_status,
          boost_amount = excluded.boost_amount,
          boost_at = excluded.boost_at,
          dextools_info_at = excluded.dextools_info_at,
          dextools_nitro_at = excluded.dextools_nitro_at,
          trending_rank = excluded.trending_rank,
          hot_rank = excluded.hot_rank,
          rugged = excluded.rugged,
          rug_tx = excluded.rug_tx,
          rug_reason = excluded.rug_reason,
          ban_status = excluded.ban_status,
          updated_at = excluded.updated_at
      `).run(
        row.address, row.creator, row.funder, row.fundingTx, row.fundingValue, row.competitorId,
        row.name, row.symbol, row.decimals, row.createdBlock, row.createdTx, row.pairAddress, row.dexId,
        row.quoteSymbol, row.quoteAddress, row.marketCap, row.volumeH24, row.txH24, row.pooledQuote,
        row.swapCount, row.swapCountExact ? 1 : 0, row.incomeNet, row.incomeReceived, row.incomeSpent,
        row.incomeExact ? 1 : 0, row.dexPaidAt, row.dexPaidStatus, row.boostAmount, row.boostAt,
        row.dextoolsInfoAt, row.dextoolsNitroAt, row.trendingRank, row.hotRank, row.rugged ? 1 : 0,
        row.rugTx, row.rugReason, row.banStatus, Date.now(),
      );
    },
    replaceIncomeLines(address, lines) {
      db.prepare("DELETE FROM income_lines WHERE chain = 'ethereum' AND token_address = ?").run(address);
      const insert = db.prepare("INSERT INTO income_lines(chain, token_address, hash, delta) VALUES ('ethereum', ?, ?, ?)");
      for (const line of lines) insert.run(address, line.hash, line.delta);
    },
    incomeLines(address) {
      return db.prepare("SELECT hash, delta FROM income_lines WHERE chain = 'ethereum' AND token_address = ? ORDER BY hash").all(address);
    },
    insertAlerts(alerts) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO alerts(id, kind, chain, token_address, competitor_id, title, body, created_at, delivered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);
      const created = [];
      for (const alert of alerts) {
        const result = insert.run(alert.id, alert.kind, alert.chain, alert.tokenAddress, alert.competitorId, alert.title, alert.body, Date.now());
        if (result.changes > 0) created.push(alert);
      }
      return created;
    },
    listAlerts() {
      return db.prepare("SELECT id, kind, chain, token_address AS tokenAddress, competitor_id AS competitorId, title, body, created_at AS createdAt, delivered FROM alerts ORDER BY created_at DESC").all()
        .map((row) => ({ ...row, delivered: Boolean(row.delivered) }));
    },
    pendingAlerts() {
      return this.listAlerts().filter((alert) => !alert.delivered).reverse();
    },
    markDelivered(ids) {
      const update = db.prepare("UPDATE alerts SET delivered = 1 WHERE id = ?");
      for (const id of ids) update.run(id);
    },
    cursor() {
      return db.prepare("SELECT last_block AS lastBlock FROM cursors WHERE chain = 'ethereum'").get()?.lastBlock ?? null;
    },
    setCursor(block) {
      db.prepare(`
        INSERT INTO cursors(chain, last_block) VALUES ('ethereum', ?)
        ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block
      `).run(block);
    },
  };
}
