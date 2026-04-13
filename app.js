(function () {
  "use strict";

  var API_PATH = "/api/submit";

  var form = document.getElementById("submit-form");
  var fileInput = document.getElementById("file-input");
  var fileDrop = document.getElementById("file-drop");
  var fileList = document.getElementById("file-list");
  var urlsInput = document.getElementById("urls-input");
  var submitBtn = document.getElementById("submit-btn");
  var resetBtn = document.getElementById("reset-btn");
  var statusEl = document.getElementById("status");

  function setStatus(message, kind) {
    statusEl.textContent = message || "";
    statusEl.className = "status";
    if (kind === "ok") statusEl.classList.add("status--ok");
    else if (kind === "err") statusEl.classList.add("status--err");
    else if (kind === "muted") statusEl.classList.add("status--muted");
  }

  function parseUrls(raw) {
    if (!raw || !String(raw).trim()) return [];
    return String(raw)
      .split(/[\n,]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function isLocalhostUrl(u) {
    try {
      var parsed = new URL(u);
      var h = parsed.hostname.toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
    } catch (_) {
      return false;
    }
  }

  function renderFileList(files) {
    fileList.innerHTML = "";
    if (!files || !files.length) {
      fileList.hidden = true;
      return;
    }
    fileList.hidden = false;
    for (var i = 0; i < files.length; i++) {
      var li = document.createElement("li");
      li.textContent = files[i].name + " (" + formatSize(files[i].size) + ")";
      fileList.appendChild(li);
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result);
        var comma = s.indexOf(",");
        var b64 = comma >= 0 ? s.slice(comma + 1) : s;
        resolve({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          data: b64,
        });
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read file"));
      };
      reader.readAsDataURL(file);
    });
  }

  fileInput.addEventListener("change", function () {
    renderFileList(fileInput.files);
  });

  ["dragenter", "dragover", "dragleave", "drop"].forEach(function (ev) {
    fileDrop.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    fileDrop.addEventListener(ev, function () {
      fileDrop.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    fileDrop.addEventListener(ev, function () {
      fileDrop.classList.remove("dragover");
    });
  });
  fileDrop.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return;
    fileInput.files = dt.files;
    renderFileList(fileInput.files);
  });

  resetBtn.addEventListener("click", function () {
    form.reset();
    urlsInput.value = "";
    renderFileList(fileInput.files);
    setStatus("", null);
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var files = fileInput.files ? Array.from(fileInput.files) : [];
    var urls = parseUrls(urlsInput.value);

    if (!files.length && !urls.length) {
      setStatus("Add at least one file or one URL.", "err");
      return;
    }

    for (var u = 0; u < urls.length; u++) {
      try {
        new URL(urls[u]);
      } catch (_) {
        setStatus('Invalid URL: "' + urls[u] + '"', "err");
        return;
      }
      if (isLocalhostUrl(urls[u])) {
        setStatus(
          "Link looks like localhost/private host: " + urls[u] + ". n8n cloud cannot reach that. Use a public URL.",
          "err"
        );
        return;
      }
    }

    var origin = "";
    try {
      origin = window.location.origin || "";
    } catch (_) {}

    submitBtn.disabled = true;
    setStatus(files.length ? "Encoding files…" : "Sending…", "muted");

    var fileEntries = [];
    try {
      for (var i = 0; i < files.length; i++) {
        fileEntries.push(await readFileAsBase64(files[i]));
      }
    } catch (readErr) {
      setStatus("Error reading files: " + (readErr && readErr.message ? readErr.message : readErr), "err");
      submitBtn.disabled = false;
      return;
    }

    var payload = {
      urls: urls,
      metadata: {
        submittedAt: new Date().toISOString(),
        pageOrigin: origin,
        fileCount: fileEntries.length,
        urlCount: urls.length,
      },
      files: fileEntries,
    };

    setStatus("Sending…", "muted");

    try {
      var res = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        var errText = await res.text().catch(function () {
          return "";
        });
        var detail = errText;
        try {
          var j = JSON.parse(errText);
          if (j && j.error) detail = j.error;
        } catch (_) {}
        throw new Error(res.status + " " + res.statusText + (detail ? ": " + String(detail).slice(0, 200) : ""));
      }
      setStatus("Sent successfully (" + res.status + ").", "ok");
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/Failed to fetch|NetworkError/i.test(msg)) {
        setStatus(
          "Request failed (network). Use Vercel (`vercel dev`) or deploy so /api/submit exists. Details: " + msg,
          "err"
        );
      } else {
        setStatus("Error: " + msg, "err");
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
