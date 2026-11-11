export async function fetchJson(url, options = {}, attempt = 1) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchJson(url, options, attempt + 1);
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || body == null) {
    const error = new Error(`Request failed (${response.status})`);
    error.status = response.status;
    error.body = text.slice(0, 240);
    throw error;
  }
  return body;
}

export function hexQuantity(value) {
  return `0x${Number(value).toString(16)}`;
}
