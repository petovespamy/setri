// SKÚŠKA: AI prečíta leták Billy ako obrázky a výsledok sa porovná s tým, čo našiel súčasný scraper.
// Nič sa neukladá do data/. Výsledok je v logu a v zhrnutí behu (záložka Actions → beh → Summary).
//   node scraper/src/aiTest.mjs            (potrebuje ANTHROPIC_API_KEY a nainštalované pdftoppm)
// Voliteľne: AI_TEST_MODEL (predvolene claude-sonnet-5-5), AI_TEST_MAX_PAGES (obmedzí počet strán).
import fs from "node:fs/promises";
import path from "node:path";
import { readFlyerWithAI, AI_READ_MODEL } from "./aiReader.mjs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "data");
const MODEL = AI_READ_MODEL;
const MAX_PAGES = Number(process.env.AI_TEST_MAX_PAGES || 200);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const overlap = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
};

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Chýba ANTHROPIC_API_KEY.");

  const index = JSON.parse(await fs.readFile(path.join(DATA, "index.json"), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const billa = index.leaflets.filter((l) => l.store === "billa").sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const leaflet = billa.find((l) => l.validFrom <= today && today <= l.validTo) ?? billa.at(-1);
  if (!leaflet?.source) throw new Error("V data/index.json som nenašiel leták Billy.");
  console.log(`Leták Billa ${leaflet.validFrom} až ${leaflet.validTo}\n${leaflet.source}`);

  const current = JSON.parse(await fs.readFile(path.join(DATA, leaflet.file), "utf8")).deals ?? [];

  const res = await fetch(leaflet.source, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Stiahnutie PDF zlyhalo: HTTP ${res.status}`);
  const read = await readFlyerWithAI(Buffer.from(await res.arrayBuffer()), { apiKey, maxPages: MAX_PAGES });
  const aiDeals = read.deals;
  const pages = { length: read.pages };
  const inTok = read.usage.input, outTok = read.usage.output, failedPages = read.failedPages;

  // Porovnanie: produkt je "zhodný", ak má podobný názov a rovnakú cenu.
  const usedCur = new Set();
  const priceDiff = [];   // AI a scraper sa zhodli na produkte, ale nie na cene/zľave
  const onlyAi = [];
  let matched = 0;
  for (const a of aiDeals) {
    let best = -1, bestScore = 0;
    current.forEach((c, idx) => {
      if (usedCur.has(idx)) return;
      const s = overlap(`${a.name}`, `${c.n}`) + 0.3 * overlap(`${a.detail ?? ""}`, `${c.d ?? ""}`);
      if (s > bestScore) { bestScore = s; best = idx; }
    });
    if (best >= 0 && bestScore >= 0.7) {
      usedCur.add(best);
      matched++;
      const c = current[best];
      const samePrice = a.price == null ? c.p == null : Math.abs(a.price - c.p) < 0.005;
      const sameDisc = (a.discountPercent ?? null) === (c.x ?? null);
      if (!samePrice || !sameDisc) priceDiff.push({ name: a.name, ai: `${a.price} € (old ${a.oldPrice}, -${a.discountPercent}%)${a.condition ? " [" + a.condition + "]" : ""}`, scraper: `${c.p} € (old ${c.o}, -${c.x}%)` });
    } else onlyAi.push(a);
  }
  const onlyScraper = current.filter((_, i) => !usedCur.has(i));

  // Vnútorná kontrola AI: sedí zľava s cenami?
  const aiBad = aiDeals.filter((a) => a.price && a.oldPrice && a.discountPercent && Math.abs(Math.round((1 - a.price / a.oldPrice) * 100) - a.discountPercent) > 2);

  const lines = [
    `## Skúška AI čítania letáku Billa (${leaflet.validFrom} až ${leaflet.validTo})`,
    `Model: ${MODEL}, strán: ${pages.length}${failedPages ? ` (zlyhalo: ${failedPages})` : ""}`,
    `Tokeny: vstup ${inTok}, výstup ${outTok}`,
    ``,
    `| | počet |`,
    `|---|---|`,
    `| Súčasný scraper | ${current.length} |`,
    `| AI | ${aiDeals.length} |`,
    `| Zhodné produkty | ${matched} |`,
    `| Zhodný produkt, iná cena alebo zľava | ${priceDiff.length} |`,
    `| Len AI | ${onlyAi.length} |`,
    `| Len súčasný scraper | ${onlyScraper.length} |`,
    `| AI: zľava nesedí s jej vlastnými cenami | ${aiBad.length} |`,
    ``,
  ];
  const section = (title, rows, fmt) => {
    if (!rows.length) return;
    lines.push(`### ${title}`, ...rows.slice(0, 40).map(fmt), rows.length > 40 ? `… a ďalších ${rows.length - 40}` : "", "");
  };
  section("Iná cena alebo zľava", priceDiff, (r) => `- ${r.name}: AI ${r.ai} | scraper ${r.scraper}`);
  section("Len AI (scraper ich nenašiel)", onlyAi, (a) => `- strana ${a.page}: ${a.name} ${a.detail ?? ""} – ${a.price} €`);
  section("Len súčasný scraper (AI ich nenašla)", onlyScraper, (c) => `- ${c.n} ${c.d ?? ""} – ${c.p} €`);

  const report = lines.join("\n");
  console.log("\n" + report);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
