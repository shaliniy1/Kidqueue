const ui = {
  startBtn: document.getElementById("startScrapeBtn"),
  refreshBtn: document.getElementById("refreshRunsBtn"),
  runSummary: document.getElementById("runSummary"),
  runLog: document.getElementById("runLog"),
  runsList: document.getElementById("runsList"),
  runsMeta: document.getElementById("runsMeta"),
  baseUrl: document.getElementById("baseUrl"),
  seedUrls: document.getElementById("seedUrls"),
  linkInclude: document.getElementById("linkInclude"),
  linkExclude: document.getElementById("linkExclude"),
  crawlInclude: document.getElementById("crawlInclude"),
  linkRegex: document.getElementById("linkRegex"),
  maxCrawlPages: document.getElementById("maxCrawlPages"),
  maxIdeaPages: document.getElementById("maxIdeaPages"),
  navTimeoutMs: document.getElementById("navTimeoutMs"),
  slowMoMs: document.getElementById("slowMoMs"),
  headless: document.getElementById("headless"),
};

let activeRunId = null;
let pollTimer = null;

function serializeForm() {
  return {
    baseUrl: ui.baseUrl.value.trim(),
    seedUrls: ui.seedUrls.value.trim(),
    linkInclude: ui.linkInclude.value.trim(),
    linkExclude: ui.linkExclude.value.trim(),
    crawlInclude: ui.crawlInclude.value.trim(),
    linkRegex: ui.linkRegex.value.trim(),
    maxCrawlPages: Number(ui.maxCrawlPages.value || 0),
    maxIdeaPages: Number(ui.maxIdeaPages.value || 0),
    navTimeoutMs: Number(ui.navTimeoutMs.value || 0),
    slowMoMs: Number(ui.slowMoMs.value || 0),
    headless: ui.headless.checked,
  };
}

function setSummary(html) {
  ui.runSummary.innerHTML = html;
}

function setLog(text) {
  ui.runLog.textContent = text || "";
}

function runRow(run) {
  const statusClass = run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "pending";
  const summaryPath = run.outDir ? `${run.outDir}/summary.json` : "";
  const summaryLink = summaryPath ? `<a href="/output/${summaryPath.split("/output/")[1] || ""}" target="_blank" rel="noopener">summary.json</a>` : "";
  const outputLink = run.outDir ? `<a href="/output/${run.outDir.split("/output/")[1] || ""}" target="_blank" rel="noopener">output folder</a>` : "";
  return `
    <div class="run-card">
      <div class="run-head">
        <strong>${run.id}</strong>
        <span class="pill ${statusClass}">${run.status}</span>
      </div>
      <div class="run-meta">
        <div>Started: ${run.startedAt || "-"}</div>
        <div>Finished: ${run.finishedAt || "-"}</div>
        <div>Exit: ${run.exitCode ?? "-"}</div>
      </div>
      <div class="run-actions">
        <button class="btn ghost" data-run-log="${run.id}">View Log</button>
        ${summaryLink}
        ${outputLink}
      </div>
    </div>
  `;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function loadRuns() {
  const runs = await fetchJson("/api/runs");
  ui.runsMeta.textContent = `${runs.length} run(s)`;
  ui.runsList.innerHTML = runs.map(runRow).join("") || "<p>No runs yet.</p>";

  ui.runsList.querySelectorAll("[data-run-log]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-run-log");
      if (id) selectRun(id);
    });
  });
}

async function selectRun(id) {
  activeRunId = id;
  const run = await fetchJson(`/api/runs/${id}`);
  setSummary(`
    <div class="summary-grid">
      <div>
        <strong>Status:</strong> ${run.status}
      </div>
      <div>
        <strong>Started:</strong> ${run.startedAt || "-"}
      </div>
      <div>
        <strong>Finished:</strong> ${run.finishedAt || "-"}
      </div>
      <div>
        <strong>Output:</strong> ${run.outDir || "-"}
      </div>
    </div>
  `);
  const log = await fetch(`/api/runs/${id}/log`).then((res) => res.text());
  setLog(log || "No log yet.");

  if (run.status === "running") {
    startPolling();
  } else {
    stopPolling();
  }
}

async function startScrape() {
  ui.startBtn.disabled = true;
  setSummary("<p>Starting scrape...</p>");
  setLog("");
  try {
    const payload = serializeForm();
    if (!payload.baseUrl) {
      setSummary("<p class=\"error\">Base URL is required.</p>");
      return;
    }
    const res = await fetchJson("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await loadRuns();
    await selectRun(res.id);
  } catch (err) {
    setSummary(`<p class="error">${err.message}</p>`);
  } finally {
    ui.startBtn.disabled = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!activeRunId) return;
    try {
      await selectRun(activeRunId);
      await loadRuns();
    } catch {
      // Ignore transient errors while polling.
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

ui.startBtn.addEventListener("click", startScrape);
ui.refreshBtn.addEventListener("click", async () => {
  stopPolling();
  await loadRuns();
});

loadRuns().catch(() => {
  ui.runsMeta.textContent = "Failed to load runs";
});
