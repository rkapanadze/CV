// Renders tailored CVs to PDF.
// Usage: node render.mjs            -> every jobs/**/index.html without a PDF yet
//        node render.mjs <dir> ...  -> specific job folders (re-renders)
import { chromium } from "playwright";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const args = process.argv.slice(2);
const dirs = args.length
  ? args
  : findJobDirs("jobs").filter((d) => !existsSync(join(d, PDF_NAME)));

if (!dirs.length) { console.log("Nothing to render."); process.exit(0); }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
let failed = false;

for (const dir of dirs) {
  const html = resolve(dir, "index.html");
  await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
  const pdf = await page.pdf({
    path: join(dir, PDF_NAME),
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const ok = pages <= MAX_PAGES;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "LONG"} ${dir} -> ${pages} page(s)`);
}

await browser.close();
if (failed) { console.error(`Some CVs exceed ${MAX_PAGES} pages - trim them.`); process.exit(1); }
