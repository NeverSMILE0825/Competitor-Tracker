export async function telegramCall(token, method, payload, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!body || body.ok !== true) {
    return {
      ok: false,
      description: body?.description || `Telegram request failed (${response.status})`,
      retry: response.status === 429 || response.status >= 500 || body == null,
    };
  }
  return { ok: true, result: body.result, retry: false };
}
