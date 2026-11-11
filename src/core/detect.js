import { ethers } from "ethers";
import { isQuoteAsset } from "./address.js";

export const POOL_MANAGER_V4 = "0x000000000004444c5dc75cb358380d2e3de08a90";
export const FACTORY_V2 = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";
export const FACTORY_V3 = "0x1f98431c8ad98523631ae4a59f267346ea31f984";

export const TOPIC_V2_PAIR = ethers.id("PairCreated(address,address,address,uint256)");
export const TOPIC_V3_POOL = ethers.id("PoolCreated(address,address,uint24,int24,address)");
export const TOPIC_V4_INIT = ethers.id("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
export const TOPIC_V4_SWAP = ethers.id("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

export function parseQuantity(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const text = String(value ?? "");
  if (!text) return NaN;
  return Number(text.startsWith("0x") ? BigInt(text) : text);
}

export function createdContractAddress(from, nonce) {
  return ethers.getCreateAddress({ from, nonce: parseQuantity(nonce) }).toLowerCase();
}

export function directCreates(transactions) {
  const created = [];
  for (const tx of transactions ?? []) {
    if (tx.to) continue;
    if (!tx.from || tx.nonce == null) continue;
    created.push({
      creator: String(tx.from).toLowerCase(),
      contract: createdContractAddress(tx.from, tx.nonce),
      hash: String(tx.hash).toLowerCase(),
      nonce: parseQuantity(tx.nonce),
    });
  }
  return created;
}

function topicAddress(topic) {
  if (!topic || topic.length < 66) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

export function tokensFromFactoryLog(log) {
  const topic0 = String(log.topics?.[0] ?? "").toLowerCase();
  const address = String(log.address ?? "").toLowerCase();
  let raw = [];
  if (address === FACTORY_V2 && topic0 === TOPIC_V2_PAIR.toLowerCase()) {
    raw = [topicAddress(log.topics[1]), topicAddress(log.topics[2])];
  } else if (address === FACTORY_V3 && topic0 === TOPIC_V3_POOL.toLowerCase()) {
    raw = [topicAddress(log.topics[1]), topicAddress(log.topics[2])];
  } else if (address === POOL_MANAGER_V4 && topic0 === TOPIC_V4_INIT.toLowerCase()) {
    raw = [topicAddress(log.topics[2]), topicAddress(log.topics[3])];
  }
  return raw.filter((token) => token && !isQuoteAsset(token));
}

export function blocksDue(savedBlock, headBlock, limit) {
  if (headBlock <= savedBlock) return [];
  const start = savedBlock + 1;
  const count = Math.min(limit, headBlock - savedBlock);
  return Array.from({ length: count }, (_, index) => start + index);
}

export function initialCursor(headBlock, savedBlock) {
  return savedBlock == null ? headBlock : savedBlock;
}
