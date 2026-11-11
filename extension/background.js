const BASE = "http://127.0.0.1:8787";

async function poll() {
  const response = await fetch(`${BASE}/api/alerts/pending`);
  if (!response.ok) return;
  const alerts = await response.json();
  if (!alerts.length) return;
  for (const alert of alerts) {
    chrome.notifications.create(alert.id, {
      type: "basic",
      iconUrl: "icon.png",
      title: alert.title,
      message: alert.body,
    });
  }
  await fetch(`${BASE}/api/alerts/delivered`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: alerts.map((alert) => alert.id) }),
  });
}

chrome.alarms.create("alerts", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  poll().catch(() => {});
});
poll().catch(() => {});
