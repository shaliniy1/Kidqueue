import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const app = express();
const port = process.env.PORT || 3000;
const rootDir = process.cwd();
const outputRoot = path.join(rootDir, "output");
const runsPath = path.join(outputRoot, "_runs.json");

app.use(express.json({ limit: "1mb" }));

const runs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function generateRunId() {
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function sanitizeList(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

function toEnvNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return "";
  return String(parsed);
}

function resolveOutputDir(id) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  return path.join(outputRoot, `scrapper-${stamp}-${id}`);
}

async function ensureOutputRoot() {
  await fs.mkdir(outputRoot, { recursive: true });
}

async function saveRunsToDisk() {
  await ensureOutputRoot();
  const data = Array.from(runs.values()).map((run) => ({
    ...run,
    logTail: run.logTail || "",
  }));
  await fs.writeFile(runsPath, JSON.stringify(data, null, 2));
}

async function loadRunsFromDisk() {
  if (!existsSync(runsPath)) return;
  try {
    const raw = await fs.readFile(runsPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      data.forEach((run) => {
        runs.set(run.id, {
          ...run,
          status: run.status || "unknown",
        });
      });
    }
  } catch {
    // Ignore invalid cached runs.
  }
}

function appendLog(run, chunk) {
  const text = chunk.toString();
  run.logTail = `${run.logTail || ""}${text}`;
  if (run.logTail.length > 20000) {
    run.logTail = run.logTail.slice(-20000);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.get("/api/runs", async (_req, res) => {
  const list = Array.from(runs.values()).sort(
    (a, b) => (b.startedAt || "").localeCompare(a.startedAt || "")
  );
  res.json(list);
});

app.get("/api/runs/:id", async (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

app.get("/api/runs/:id/log", async (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).send("Run not found");
    return;
  }
  res.type("text/plain").send(run.logTail || "");
});

app.post("/api/scrape", async (req, res) => {
  const id = generateRunId();
  const outDir = resolveOutputDir(id);
  const logPath = path.join(outDir, "run.log");
  await fs.mkdir(outDir, { recursive: true });

  const env = {
    ...process.env,
    OUTPUT_DIR: outDir,
    IDEA_BASE_URL: req.body?.baseUrl || process.env.IDEA_BASE_URL || "",
    SEED_URLS: sanitizeList(req.body?.seedUrls),
    LINK_INCLUDE: sanitizeList(req.body?.linkInclude),
    LINK_EXCLUDE: sanitizeList(req.body?.linkExclude),
    CRAWL_INCLUDE: sanitizeList(req.body?.crawlInclude),
    LINK_REGEX: req.body?.linkRegex || "",
    MAX_CRAWL_PAGES: toEnvNumber(req.body?.maxCrawlPages),
    MAX_IDEA_PAGES: toEnvNumber(req.body?.maxIdeaPages),
    NAV_TIMEOUT_MS: toEnvNumber(req.body?.navTimeoutMs),
    HEADLESS: req.body?.headless === false ? "0" : "1",
    SLOW_MO_MS: toEnvNumber(req.body?.slowMoMs),
  };

  const run = {
    id,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    outDir,
    logPath,
    exitCode: null,
    logTail: "",
  };
  runs.set(id, run);
  await saveRunsToDisk();

  const child = spawn(process.execPath, ["scripts/scrape-ideas.mjs"], {
    cwd: rootDir,
    env,
  });

  const logStream = await fs.open(logPath, "a");

  child.stdout.on("data", async (chunk) => {
    appendLog(run, chunk);
    await logStream.appendFile(chunk);
  });

  child.stderr.on("data", async (chunk) => {
    appendLog(run, chunk);
    await logStream.appendFile(chunk);
  });

  child.on("close", async (code) => {
    run.exitCode = code;
    run.status = code === 0 ? "completed" : "failed";
    run.finishedAt = nowIso();
    await logStream.close();
    await saveRunsToDisk();
  });

  res.json({ id, status: "running", outDir });
});

app.use("/output", express.static(outputRoot));
app.use(express.static(rootDir));

await ensureOutputRoot();
await loadRunsFromDisk();

app.listen(port, () => {
  console.log(`Scraper UI running at http://localhost:${port}`);
});
