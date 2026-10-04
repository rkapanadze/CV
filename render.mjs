// Renders tailored CVs to PDF (respects @page / @media print in style.css).
// Usage: node render.mjs            -> every jobs/**/index.html without a PDF yet
//        node render.mjs <dir> ...  -> specific job folders (re-renders)
// Engine: Playwright Chromium if it can launch, otherwise WeasyPrint
// (`pip install --user weasyprint`). Force one with RENDERER=playwright|weasyprint.
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const PDF_NAME = "CV_Revaz_Kapanadze.pdf";
const MAX_PAGES = 2;

function findJobDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) return [];
    return existsSync(join(p, "index.html")) ? [p] : findJobDirs(p);
  });
}

function countPages(file) {
  try {
    const out = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    const m = out.match(/^Pages:\s+(\d+)/m);
    if (m) return Number(m[1]);
  } catch {}
  return (readFileSync(file).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

async function playwrightEngine() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage();
  return {
    name: "playwright",
    async render(html, out) {
      await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
      await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    },
    close: () => browser.close(),
  };
}

function weasyEngine() {
  execFileSync("python3", ["-c", "import weasyprint"], { stdio: "ignore" });
  return {
    name: "weasyprint",
    async render(html, out) {
      execFileSync("python3", ["-m", "weasyprint", "-q", html, out], { stdio: "inherit" });
    },
    close: async () => {},
  };
}

async function getEngine() {
  const want = process.env.RENDERER;
  if (want === "weasyprint") return weasyEngine();
  if (want === "playwright") return playwrightEngine();
  try { return await playwrightEngine(); }
  catch (e) {
    console.warn(`Playwright unavailable (${String(e.message).split("\n")[0]}), using WeasyPrint.`);
    return weasyEngine();
  }
}

const args = process.argv.slice(2);
const dirs = args.length
  ? args
  : findJobDirs("jobs").filter((d) => !existsSync(join(d, PDF_NAME)));

if (!dirs.length) { console.log("Nothing to render."); process.exit(0); }

const engine = await getEngine();
let failed = false;
for (const dir of dirs) {
  const out = join(dir, PDF_NAME);
  await engine.render(resolve(dir, "index.html"), out);
  const pages = countPages(out);
  const ok = pages <= MAX_PAGES;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "LONG"} ${dir} -> ${pages} page(s) [${engine.name}]`);
}
await engine.close();
if (failed) { console.error(`Some CVs exceed ${MAX_PAGES} pages - trim them.`); process.exit(1); }
