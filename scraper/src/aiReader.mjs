// AI čítanie letákov: strany PDF sa premenia na obrázky a Claude z nich vypíše zľavy.
// Použitie: readFlyerWithAI(pdfBuffer, { cachePath }) -> { deals, usage, pages, failedPages, model }, toAppDeals(deals) -> zľavy v tvare pre appku.
// Potrebuje ANTHROPIC_API_KEY a nainštalovaný `pdftoppm` (balík poppler-utils).
//
// Úspora tokenov (kvalita čítania sa nemení – rovnaký model, rovnaké obrázky, rovnaké pravidlá v prompte):
//  1. Kompaktný výstup: krátke kľúče a vynechané prázdne polia (výstupné tokeny sú najdrahšie).
//  2. Message Batches API: rovnaká práca za polovičnú cenu. Ak dávka nestihne do limitu alebo zlyhá,
//     zvyšné strany sa dočítajú bežným volaním. Vypnutie: AI_BATCH=0.
//  3. Cache po stranách (podľa odtlačku obrázka, modelu a verzie promptu): strana, ktorá sa už čítala, sa neplatí znova.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { guessCategory } from "./categorize.mjs";

export const AI_READ_MODEL = process.env.AI_READ_MODEL || process.env.AI_TEST_MODEL || "claude-sonnet-5-5";

/** Zmeň pri každej úprave promptu, aby sa staré výsledky z cache nepoužili. */
const PROMPT_VERSION = "2-compact";
const API = "https://api.anthropic.com/v1";
const CACHE_KEEP_DAYS = 14;
const BATCH_MIN_PAGES = 10;                       // pod tento počet strán sa batch nevypláca čakať
const BATCH_WAIT_MS = (Number(process.env.AI_BATCH_WAIT_MIN) || 15) * 60_000;

const SYSTEM = `Si presný čítač slovenských letákov. Dostaneš jednu stranu letáku ako obrázok.
Vypíš KAŽDÚ zľavu na strane.

Pre každú zľavu uveď:
- name: názov produktu presne ako je na letáku (pri zľave na celý sortiment názov sortimentu, napr. "Stará mama – celý sortiment knedlíky, šúlance, pirohy")
- detail: podrobnosť (gramáž, balenie, "rôzne druhy"…) alebo null
- price: akciová cena v eurách ako číslo (napr. 1.49). Ak zľava nemá cenu, ale len percento (napr. "celý sortiment −20 %"), daj null.
- oldPrice: pôvodná (prečiarknutá) cena v eurách, alebo null, ak na letáku nie je
- discountPercent: zľava v percentách ako celé číslo, ako je vytlačená na letáku, alebo null, ak na letáku nie je
- condition: podmienka, za ktorej cena alebo zľava platí, krátko po slovensky a podľa letáku, napr. "pri kúpe 2 ks", "pri kúpe 4 ks", "s vernostnou kartou", "od 2 ks", "2+1 zdarma". Ak je cena bez podmienky, daj null.

Dôležité:
- Ak cena platí len pri kúpe viacerých kusov alebo len s kartou, VŽDY to uveď v condition. Nikdy takú cenu nevydávaj za bežnú.
- Ak je podmienkou počet kusov (napr. "pri kúpe od 2 ks"), napíš do condition len počet kusov a nepíš, že sa viaže na kartu, kupón alebo BILLA Bonus. Ostatné podmienky (napr. "s BILLA Bonus" bez počtu kusov) uveď tak, ako sú v letáku.
- Ak sú pri produkte dve ceny (napr. "cena za 1 ks pri kúpe 2 ks" a "cena za 1 ks pri kúpe 1 ks"), vypíš ako price tú akciovú a do condition napíš podmienku.
- Cena "za 1 kg" alebo "za 100 g" je cena produktu; jednotku uveď v detail (napr. "cena za 1 kg").
- Nič nehádaj ani nepočítaj. Čo na obrázku nevidíš, daj null. Nevynechávaj zľavy a nevymýšľaj nové.
- Ak ide o titulnú stranu alebo stranu bez zliav, vráť prázdne pole.
Výstup (kvôli úspore používaj tieto krátke kľúče): name→n, detail→d, price→p, oldPrice→o, discountPercent→x, condition→q.
Kľúč, ktorého hodnota by bola null, úplne vynechaj (nepíš ho). Ceny a percentá píš ako čísla.
Odpovedz IBA JSON poľom objektov napísaným na jeden riadok bez zbytočných medzier, žiadny ďalší text.`;

const headers = (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parametre jedného volania (rovnaké pre bežné volanie aj pre batch). */
function buildParams(jpegBase64, model) {
  return {
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
        { type: "text", text: "Vypíš zľavy z tejto strany letáku." },
      ],
    }],
  };
}

/** Krátke aj dlhé kľúče -> jeden tvar (name, detail, price, oldPrice, discountPercent, condition). */
function expand(d) {
  return {
    name: d.name ?? d.n ?? null,
    detail: d.detail ?? d.d ?? null,
    price: d.price ?? d.p ?? null,
    oldPrice: d.oldPrice ?? d.o ?? null,
    discountPercent: d.discountPercent ?? d.x ?? null,
    condition: d.condition ?? d.q ?? null,
  };
}

function parseDeals(text) {
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  if (!Array.isArray(arr)) throw new Error("odpoveď nie je pole");
  return arr.map(expand);
}

const textOf = (message) => message?.content?.map((c) => c.text ?? "").join("") ?? "";

function addUsage(total, u = {}) {
  total.input += u.input_tokens ?? 0;
  total.output += u.output_tokens ?? 0;
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
}

/** Bežné (okamžité) volanie jednej strany. Vráti null, ak ani na tretí pokus nevyšlo. */
async function readPage(apiKey, jpegBase64, model) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/messages`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(buildParams(jpegBase64, model)) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      return { deals: parseDeals(textOf(body)), usage: body.usage ?? {} };
    } catch (err) {
      console.error(`  [ai] pokus ${attempt} zlyhal: ${err.message}`);
    }
  }
  return null;
}

/**
 * Prečíta strany cez Message Batches API (polovičná cena). Vráti Map: index strany -> { deals, usage }.
 * Strany, ktoré sa nepodarilo prečítať (chyba, vypršanie, limit času), v mape chýbajú – dočítajú sa bežným volaním.
 */
async function readViaBatch(apiKey, model, items) {
  const out = new Map();
  try {
    const create = await fetch(`${API}/messages/batches`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ requests: items.map((it) => ({ custom_id: `p${it.i}`, params: buildParams(it.b64, model) })) }),
    });
    if (!create.ok) throw new Error(`HTTP ${create.status}: ${(await create.text()).slice(0, 200)}`);
    let batch = await create.json();
    console.log(`  [ai] batch ${batch.id}: ${items.length} strán odoslaných`);

    const poll = async () => {
      const r = await fetch(`${API}/messages/batches/${batch.id}`, { headers: headers(apiKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status} pri čakaní na batch`);
      batch = await r.json();
    };
    const started = Date.now();
    let cancelled = false;
    while (batch.processing_status !== "ended") {
      await sleep(batch.processing_status === "in_progress" && Date.now() - started < 60_000 ? 15_000 : 30_000);
      await poll();
      if (!cancelled && Date.now() - started > BATCH_WAIT_MS) {
        console.warn(`  [ai] batch nestihol do ${Math.round(BATCH_WAIT_MS / 60000)} min, rušim ho a zvyšok dočítam bežne`);
        await fetch(`${API}/messages/batches/${batch.id}/cancel`, { method: "POST", headers: headers(apiKey) });
        cancelled = true;
      }
      if (cancelled && Date.now() - started > BATCH_WAIT_MS + 5 * 60_000) throw new Error("batch sa po zrušení neukončil");
    }

    if (!batch.results_url) throw new Error("batch nemá results_url");
    const res = await fetch(batch.results_url, { headers: headers(apiKey) });
    if (!res.ok) throw new Error(`HTTP ${res.status} pri sťahovaní výsledkov`);
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const i = Number(String(row.custom_id).slice(1));
      if (row.result?.type !== "succeeded") {
        console.error(`  [ai] batch strana ${i + 1}: ${row.result?.type ?? "bez výsledku"}`);
        continue;
      }
      try {
        out.set(i, { deals: parseDeals(textOf(row.result.message)), usage: row.result.message.usage ?? {} });
      } catch (err) {
        console.error(`  [ai] batch strana ${i + 1}: neplatná odpoveď (${err.message})`);
      }
    }
  } catch (err) {
    console.error(`  [ai] batch zlyhal (${err.message}), zvyšok čítam bežne`);
  }
  return out;
}

async function loadCache(cachePath) {
  if (!cachePath) return { v: 1, entries: {} };
  try {
    const c = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (c?.v === 1 && c.entries) return c;
  } catch { /* cache ešte neexistuje */ }
  return { v: 1, entries: {} };
}

async function saveCache(cachePath, cache) {
  if (!cachePath) return;
  const limit = new Date(Date.now() - CACHE_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const [k, e] of Object.entries(cache.entries)) if (e.u < limit) delete cache.entries[k];
  await fs.writeFile(cachePath, JSON.stringify(cache), "utf8");
}

/**
 * Prečíta celé PDF. Vráti surové zľavy z AI (s číslom strany), spotrebu tokenov a počet zlyhaných strán.
 * cachePath: súbor s cache prečítaných strán (bez neho sa cache nepoužije, napr. pri skúške).
 */
export async function readFlyerWithAI(pdfBuffer, { apiKey = process.env.ANTHROPIC_API_KEY, model = AI_READ_MODEL, maxPages = 200, cachePath = null, batch = process.env.AI_BATCH !== "0" } = {}) {
  if (!apiKey) throw new Error("Chýba ANTHROPIC_API_KEY.");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-read-"));
  try {
    const pdfPath = path.join(tmp, "flyer.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);
    execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-scale-to", "1568", pdfPath, path.join(tmp, "p")]);
    const files = (await fs.readdir(tmp)).filter((f) => f.startsWith("p") && f.endsWith(".jpg")).sort().slice(0, maxPages);

    const cache = await loadCache(cachePath);
    const day = new Date().toISOString().slice(0, 10);
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cachedPages: 0, batchPages: 0 };
    const pageDeals = new Array(files.length).fill(null);
    const pending = [];
    for (const [i, f] of files.entries()) {
      const jpeg = await fs.readFile(path.join(tmp, f));
      const key = crypto.createHash("sha256").update(`${model}|${PROMPT_VERSION}|`).update(jpeg).digest("hex").slice(0, 24);
      const hit = cache.entries[key];
      if (hit) {
        hit.u = day;
        pageDeals[i] = hit.d.map(expand);
        usage.cachedPages++;
      } else pending.push({ i, key, b64: jpeg.toString("base64") });
    }
    if (usage.cachedPages) console.log(`  [ai] ${usage.cachedPages} strán z cache (neplatí sa znova)`);

    try {
      const finish = (it, out, how) => {
        pageDeals[it.i] = out.deals;
        addUsage(usage, out.usage);
        cache.entries[it.key] = { d: out.deals.map(({ name, detail, price, oldPrice, discountPercent, condition }) => {
          const o = { n: name, d: detail, p: price, o: oldPrice, x: discountPercent, q: condition };
          for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
          return o;
        }), u: day };
        console.log(`  [ai] strana ${it.i + 1}/${files.length}: ${out.deals.length} zliav${how}`);
      };

      let todo = pending;
      if (batch && pending.length >= BATCH_MIN_PAGES) {
        const done = await readViaBatch(apiKey, model, pending);
        for (const it of pending) if (done.has(it.i)) { finish(it, done.get(it.i), " (batch)"); usage.batchPages++; }
        todo = pending.filter((it) => !done.has(it.i));
      }
      for (const it of todo) {
        const out = await readPage(apiKey, it.b64, model);
        if (out) finish(it, out, "");
      }
    } finally {
      await saveCache(cachePath, cache);
    }

    const deals = [];
    let failedPages = 0;
    for (const [i, list] of pageDeals.entries()) {
      if (!list) { failedPages++; continue; }
      for (const d of list) deals.push({ ...d, page: i + 1 });
    }
    return { deals, usage, pages: files.length, failedPages, model };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Surové zľavy z AI -> zľavy v tvare pre appku (n, d, p, o, x, q, c).
 * Zahodí nezmysly a opraví percento, ak nesedí s cenami. Vráti aj počet nájdených problémov.
 */
export function toAppDeals(raw) {
  const seen = new Set();
  const deals = [];
  const issues = { dropped: 0, percentFixed: 0 };
  for (const r of raw) {
    const name = clean(r.name).slice(0, 80);
    const detail = clean(r.detail);
    const price = num(r.price);
    const old = num(r.oldPrice);
    let percent = Number.isFinite(r.discountPercent) && r.discountPercent > 0 && r.discountPercent < 100 ? Math.round(r.discountPercent) : null;
    const condition = clean(r.condition);

    // Zľava musí mať cenu alebo percento a rozumný názov.
    if (name.length < 3 || (price == null && percent == null) || (price != null && price > 1000)) { issues.dropped++; continue; }
    if (price != null && old != null && old <= price) { issues.dropped++; continue; }
    if (price != null && old != null) {
      const computed = Math.round((1 - price / old) * 100);
      if (percent == null) percent = computed;
      else if (Math.abs(computed - percent) > 2) { percent = computed; issues.percentFixed++; }
    }

    const deal = { n: name };
    if (price != null) deal.p = price;
    if (detail) deal.d = detail.slice(0, 90);
    if (old != null) deal.o = old;
    if (percent != null) deal.x = percent;
    if (condition) deal.q = condition.slice(0, 60);
    const category = guessCategory(`${name} ${detail}`);
    if (category) deal.c = category;

    const key = `${deal.n}|${deal.p ?? ""}|${deal.o ?? ""}|${deal.q ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deals.push(deal);
  }
  return { deals, issues };
}
