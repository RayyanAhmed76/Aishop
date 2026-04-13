/**
 * Accepts JSON (files as base64), forwards to n8n. Set N8N_WEBHOOK_URL in env.
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook || typeof webhook !== "string" || !webhook.trim()) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  var contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return res.status(400).json({ error: "Expected application/json" });
  }

  var buf = await readBody(req);
  if (!buf.length) {
    return res.status(400).json({ error: "Empty body" });
  }

  var payload;
  try {
    payload = JSON.parse(buf.toString("utf8"));
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  if (payload.files !== undefined && !Array.isArray(payload.files)) {
    return res.status(400).json({ error: "files must be an array" });
  }

  var out = JSON.stringify(payload);

  try {
    var n8nRes = await fetch(webhook.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: out,
    });
    var text = await n8nRes.text();
    res.status(n8nRes.status);
    res.setHeader("Content-Type", n8nRes.headers.get("content-type") || "text/plain; charset=utf-8");
    return res.send(text);
  } catch (err) {
    var msg = err && err.message ? err.message : "Upstream error";
    return res.status(502).json({ error: msg });
  }
};

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}
