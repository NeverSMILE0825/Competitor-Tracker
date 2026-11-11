export function formatUnits(value, decimals) {
  if (value == null || value === "") return "";
  const raw = BigInt(value);
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

export function decimalToUnits(value, decimals) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  const units = BigInt(`${whole}${padded}`);
  return (negative ? -units : units).toString();
}

export function paymentMillis(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 1e12 ? Math.round(parsed * 1000) : Math.round(parsed);
}
