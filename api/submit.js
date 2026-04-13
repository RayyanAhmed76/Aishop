/**
 * Proxies multipart POST to n8n. Set N8N_WEBHOOK_URL in Vercel project env (do not commit).
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

  var contentType = req.headers["content-type"];
  if (!contentType || !String(contentType).toLowerCase().includes("multipart/form-data")) {
    return res.status(400).json({ error: "Expected multipart/form-data" });
  }

  var body = await readBody(req);
  if (!body.length) {
    return res.status(400).json({ error: "Empty body" });
  }

  try {
    var n8nRes = await fetch(webhook.trim(), {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body,
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
