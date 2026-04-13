/**
 * Accepts JSON (files as base64), uploads each file to Vercel Blob, then POSTs JSON to n8n
 * with files as { name, mimeType, size, url } (no base64). Set N8N_WEBHOOK_URL and BLOB_READ_WRITE_TOKEN.
 */
var crypto = require("crypto");

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

  var blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  var files = payload.files || [];
  var needsBlob = false;
  for (var i = 0; i < files.length; i++) {
    if (files[i] && typeof files[i].data === "string" && files[i].data.length) {
      needsBlob = true;
      break;
    }
  }

  if (needsBlob && (!blobToken || !String(blobToken).trim())) {
    return res.status(500).json({
      error: "BLOB_READ_WRITE_TOKEN is not set. Create a Blob store in Vercel and add the token to env.",
    });
  }

  if (needsBlob) {
    var putFn;
    try {
      var blobMod = await import("@vercel/blob");
      putFn = blobMod.put;
    } catch (e) {
      return res.status(500).json({ error: "Blob client failed to load: " + (e && e.message ? e.message : e) });
    }

    var outFiles = [];
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      if (!f || typeof f !== "object") {
        outFiles.push(f);
        continue;
      }
      if (typeof f.url === "string" && f.url.trim() && !f.data) {
        outFiles.push({
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          url: f.url.trim(),
        });
        continue;
      }
      if (typeof f.data !== "string" || !f.data.length) {
        return res.status(400).json({ error: "Each file must have data (base64) or url" });
      }

      var raw;
      try {
        raw = Buffer.from(f.data, "base64");
      } catch (_) {
        return res.status(400).json({ error: "Invalid base64 for file: " + (f.name || "unknown") });
      }
      if (!raw.length) {
        return res.status(400).json({ error: "Empty file after decode: " + (f.name || "unknown") });
      }

      var safeName = String(f.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 180);
      var pathname = "uploads/" + Date.now() + "-" + crypto.randomBytes(6).toString("hex") + "-" + safeName;
      var mime = typeof f.mimeType === "string" && f.mimeType ? f.mimeType : "application/octet-stream";

      var uploaded;
      try {
        uploaded = await putFn(pathname, raw, {
          access: "public",
          token: blobToken.trim(),
          contentType: mime,
        });
      } catch (upErr) {
        var um = upErr && upErr.message ? upErr.message : String(upErr);
        return res.status(502).json({ error: "Blob upload failed: " + um });
      }

      outFiles.push({
        name: f.name || safeName,
        mimeType: mime,
        size: typeof f.size === "number" ? f.size : raw.length,
        url: uploaded.url,
      });
    }
    payload.files = outFiles;
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
