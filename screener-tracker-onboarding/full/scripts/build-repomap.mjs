#!/usr/bin/env node
/**
 * build-repomap.mjs
 * Generates REPOMAP.md — a lightweight symbol index of the codebase.
 * Run: node scripts/build-repomap.mjs  (or: npm run repomap)
 * Auto-run: .git/hooks/pre-commit
 *
 * What it indexes:
 *   - JS/MJS: exported functions, classes, top-level consts with arrows/functions
 *   - SQL:    CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN
 *   - JSON:   top-level keys of data files
 *   - Routes: Express app.get/post/put/delete/patch registrations
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT  = path.join(ROOT, "REPOMAP.md");

// ── Config ────────────────────────────────────────────────────────────────────
const INCLUDE_DIRS = [".", "public", "scripts", "migrations"];
const EXCLUDE = new Set([
  "node_modules", ".git", "dist", "build", ".claude",
  "data",                     // handled via DATA_ALLOWLIST below
  "build-repomap.mjs",        // skip self
  "design-library.html",
  "design-mockup.html",
]);
// Only index specific files from data/ (skip per-symbol JSON blobs)
const DATA_ALLOWLIST = new Set(["nse_universe.json", "portfolio.json"]);

const FILE_EXTS = new Set([".js", ".mjs", ".sql", ".json"]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function relPath(abs) { return path.relative(ROOT, abs); }

function collectFiles() {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (EXCLUDE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (FILE_EXTS.has(path.extname(e.name))) results.push(full);
    }
  }
  for (const d of INCLUDE_DIRS) walk(path.join(ROOT, d));
  // Add allowlisted data/ files
  for (const fname of DATA_ALLOWLIST) {
    const full = path.join(ROOT, "data", fname);
    if (fs.existsSync(full)) results.push(full);
  }
  // Deduplicate (INCLUDE_DIRS[0]="." covers everything; avoid double-scan)
  const seen = new Set();
  return results.filter(f => { const r = relPath(f); if (seen.has(r)) return false; seen.add(r); return true; });
}

function extractJS(src) {
  const hits = [];
  const patterns = [
    // export function foo / export async function foo
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    // export const foo = (...) =>  or  = function
    /^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/gm,
    // export class Foo
    /^export\s+class\s+(\w+)/gm,
    // top-level: const foo = (...) =>   (non-export, interesting symbols)
    /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm,
    // async function foo(  (non-export top-level)
    /^(?:async\s+)?function\s+(\w+)\s*\(/gm,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(src)) !== null) {
      if (!hits.includes(m[1])) hits.push(m[1]);
    }
  }
  return hits;
}

function extractRoutes(src) {
  const hits = [];
  const pat = /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = pat.exec(src)) !== null) {
    hits.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return hits;
}

function extractSQL(src) {
  const hits = [];
  const patterns = [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi,
    /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+COLUMN/gi,
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(src)) !== null) hits.push(m[1]);
  }
  return [...new Set(hits)];
}

function extractJSON(src, filePath) {
  // For data files only (not package.json / lockfiles)
  const base = path.basename(filePath);
  if (base === "package.json" || base === "package-lock.json") return [];
  try {
    const obj = JSON.parse(src);
    if (Array.isArray(obj)) return [`[Array length=${obj.length}]`];
    return Object.keys(obj).slice(0, 20);
  } catch { return []; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const files = collectFiles().sort();
const sections = [];

for (const file of files) {
  const rel  = relPath(file);
  const ext  = path.extname(file);
  let src;
  try { src = fs.readFileSync(file, "utf8"); } catch { continue; }

  let symbols = [];
  let routes  = [];

  if (ext === ".js" || ext === ".mjs") {
    symbols = extractJS(src);
    routes  = extractRoutes(src);
  } else if (ext === ".sql") {
    symbols = extractSQL(src);
  } else if (ext === ".json") {
    symbols = extractJSON(src, file);
  }

  if (symbols.length === 0 && routes.length === 0) continue;

  const lines = [`### \`${rel}\``];
  const stat  = fs.statSync(file);
  const lc    = src.split("\n").length;
  lines.push(`*${lc} lines · ${Math.round(stat.size / 1024)}KB*`);
  lines.push("");

  if (routes.length) {
    lines.push("**Routes:** " + routes.join(" · "));
  }
  if (symbols.length) {
    lines.push("**Symbols:** `" + symbols.join("` · `") + "`");
  }
  sections.push(lines.join("\n"));
}

const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const output = `# REPOMAP — BoardroomX
> Auto-generated ${timestamp} by \`scripts/build-repomap.mjs\`
> **Read this before grepping.** Find the right file first, then Read it.

---

${sections.join("\n\n---\n\n")}

---
*${files.length} files scanned · regenerate with \`npm run repomap\`*
`;

fs.writeFileSync(OUT, output, "utf8");
console.log(`✓ REPOMAP.md written (${sections.length} files with symbols)`);
