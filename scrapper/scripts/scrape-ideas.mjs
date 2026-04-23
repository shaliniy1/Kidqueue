import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const now = new Date();
const timestamp = now
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/Z$/, "Z");

const config = {
  baseUrl: process.env.IDEA_BASE_URL || "",
  seedUrls: parseList(process.env.SEED_URLS),
  linkInclude: parseList(
    process.env.LINK_INCLUDE || "idea-of-the-day,idea,ideas"
  ),
  linkExclude: parseList(
    process.env.LINK_EXCLUDE ||
      "login,signup,account,privacy,terms,contact,cart,checkout"
  ),
  crawlInclude: parseList(
    process.env.CRAWL_INCLUDE || "idea-of-the-day,idea,ideas,archive,browse"
  ),
  maxCrawlPages: toInt(process.env.MAX_CRAWL_PAGES, 30),
  maxIdeaPages: toInt(process.env.MAX_IDEA_PAGES, 0),
  navTimeoutMs: toInt(process.env.NAV_TIMEOUT_MS, 45000),
  headless: process.env.HEADLESS
    ? process.env.HEADLESS !== "0"
    : true,
  slowMoMs: toInt(process.env.SLOW_MO_MS, 0),
  outDir:
    process.env.OUTPUT_DIR || path.join("output", `scrapper-${timestamp}`),
  linkRegex: process.env.LINK_REGEX
    ? new RegExp(process.env.LINK_REGEX)
    : null,
};

function parseList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(input) {
  try {
    const url = new URL(input);
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function slugForUrl(url) {
  const { pathname } = new URL(url);
  const cleaned = pathname
    .replace(/\/+$/, "")
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = cleaned || "root";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}

function shouldIncludeLink(url) {
  if (!url) return false;
  if (config.linkRegex) return config.linkRegex.test(url);
  const lowered = url.toLowerCase();
  if (config.linkExclude.some((token) => lowered.includes(token))) return false;
  return config.linkInclude.some((token) => lowered.includes(token));
}

function shouldCrawlLink(url) {
  if (!url) return false;
  const lowered = url.toLowerCase();
  return config.crawlInclude.some((token) => lowered.includes(token));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

async function expandAll(page) {
  await page.$$eval("details", (nodes) => {
    nodes.forEach((node) => {
      node.open = true;
    });
  });
  await page.$$eval("button, a", (nodes) => {
    nodes.forEach((node) => {
      const label = (node.textContent || "").toLowerCase();
      if (
        label.includes("read more") ||
        label.includes("show more") ||
        label.includes("see more") ||
        label.includes("expand")
      ) {
        node.click();
      }
    });
  });
}

async function collectIdeaLinks(page) {
  const baseOrigin = new URL(config.baseUrl).origin;
  const queue = [config.baseUrl, ...config.seedUrls];
  const visited = new Set();
  const ideaLinks = new Set();

  while (queue.length && visited.size < config.maxCrawlPages) {
    const url = queue.shift();
    const normalized = normalizeUrl(url);
    if (!normalized || visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      await page.goto(normalized, {
        waitUntil: "domcontentloaded",
        timeout: config.navTimeoutMs,
      });
      await autoScroll(page);
      await expandAll(page);
    } catch {
      continue;
    }

    const hrefs = await page.$$eval("a[href]", (nodes) =>
      nodes.map((node) => node.getAttribute("href") || "").filter(Boolean)
    );

    for (const href of hrefs) {
      let absolute;
      try {
        absolute = new URL(href, normalized).toString();
      } catch {
        continue;
      }
      if (!absolute.startsWith(baseOrigin)) continue;
      const cleaned = normalizeUrl(absolute);
      if (!cleaned) continue;

      if (shouldIncludeLink(cleaned)) {
        ideaLinks.add(cleaned);
      }
      if (!visited.has(cleaned) && shouldCrawlLink(cleaned)) {
        queue.push(cleaned);
      }
    }
  }

  return Array.from(ideaLinks).sort();
}

async function scrapeIdeaPage(browser, url, outputDir) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  });
  page.setDefaultNavigationTimeout(config.navTimeoutMs);

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await autoScroll(page);
    await expandAll(page);
    await page.waitForTimeout(500);
  } catch (err) {
    await page.close();
    return { url, error: err.message };
  }

  const data = await page.evaluate(() => {
    const pickMain = () => {
      const selectors = [
        "main",
        "article",
        "[role=main]",
        ".content",
        ".post",
        ".entry-content",
        ".idea",
      ];
      const candidates = selectors
        .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
        .map((el) => ({
          el,
          score: (el.innerText || "").trim().length,
        }))
        .sort((a, b) => b.score - a.score);
      return candidates[0]?.el || document.body;
    };

    const main = pickMain();
    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      "";
    const description =
      document.querySelector("meta[name=description]")?.getAttribute("content") ||
      "";
    const headings = Array.from(main.querySelectorAll("h2, h3"))
      .map((h) => h.textContent?.trim() || "")
      .filter(Boolean);
    const sections = Array.from(main.querySelectorAll("h2, h3")).map((h) => {
      const heading = h.textContent?.trim() || "";
      const parts = [];
      let next = h.nextElementSibling;
      while (next && !["H2", "H3"].includes(next.tagName)) {
        const chunk = (next.innerText || "").trim();
        if (chunk) parts.push(chunk);
        next = next.nextElementSibling;
      }
      return { heading, text: parts.join("\n").trim() };
    });
    const text = (main.innerText || "").trim();
    const html = (main.innerHTML || "").trim();

    return {
      title,
      description,
      headings,
      sections,
      text,
      html,
    };
  });

  const slug = slugForUrl(url);
  const pageDir = path.join(outputDir, "pages", slug);
  await fs.mkdir(pageDir, { recursive: true });

  const pdfPath = path.join(pageDir, "page.pdf");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "18mm",
      bottom: "18mm",
      left: "15mm",
      right: "15mm",
    },
  });

  await fs.writeFile(
    path.join(pageDir, "content.json"),
    JSON.stringify(
      {
        url,
        scrapedAt: new Date().toISOString(),
        ...data,
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(pageDir, "content.txt"), data.text || "");
  await fs.writeFile(path.join(pageDir, "content.html"), data.html || "");

  await page.close();

  return {
    url,
    title: data.title,
    headings: data.headings,
    pdfPath: path.relative(process.cwd(), pdfPath),
    pageDir: path.relative(process.cwd(), pageDir),
  };
}

async function run() {
  if (!config.baseUrl) {
    throw new Error(
      "IDEA_BASE_URL is required. Set it to the Idea of the Day page URL."
    );
  }
  await fs.mkdir(config.outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMoMs || undefined,
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  });
  page.setDefaultNavigationTimeout(config.navTimeoutMs);

  const ideaLinks = await collectIdeaLinks(page);
  await page.close();

  const limitedLinks =
    config.maxIdeaPages > 0
      ? ideaLinks.slice(0, config.maxIdeaPages)
      : ideaLinks;

  const results = [];
  for (const link of limitedLinks) {
    const result = await scrapeIdeaPage(browser, link, config.outDir);
    results.push(result);
  }

  await browser.close();

  const summary = {
    baseUrl: config.baseUrl,
    scrapedAt: new Date().toISOString(),
    totalDiscovered: ideaLinks.length,
    totalScraped: results.length,
    outputDir: path.relative(process.cwd(), config.outDir),
    results,
  };

  await fs.writeFile(
    path.join(config.outDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log(
    `Scrape complete. ${results.length} idea page(s) saved to ${config.outDir}`
  );
}

run().catch((err) => {
  console.error("Scrape failed:", err);
  process.exitCode = 1;
});
