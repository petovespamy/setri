// Denná kontrola letákov.
//   node src/run.mjs            normálna kontrola (preskočí obchody, ktoré netreba kontrolovať)
//   node src/run.mjs --force    skontroluje všetky obchody hneď
//   node src/run.mjs billa      len jeden obchod
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stores } from "./stores/index.mjs";
import { readPdfPages } from "./pdf.mjs";
import { parseFlyer, extractValidity, pageText } from "./parseFlyer.mjs";
import { recategorize, dietTags } from "./categorize.mjs";
import { classifyAll } from "./classify.mjs";
import { readFlyerWithAI, toAppDeals } from "./aiReader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "data");
const INDEX = path.join(DATA, "index.json");

// Všetko, čo program vypíše, uložíme aj do data/status.txt, aby sa dalo skontrolovať, čo sa pri behu stalo.
const logLines = [];
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...a) => {
    logLines.push((level === "log" ? "" : level.toUpperCase() + ": ") + a.join(" "));
    original(...a);
  };
}

/** Obchody, ktorých PDF leták číta AI (Claude). Ostatné čítajú pôvodné parsery. */
const AI_STORES = new Set(["billa"]);

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.find((a) => !a.startsWith("--"));

/** Kontrolu pred koncom platnosti letáku začíname toľko dní vopred. */
const CHECK_DAYS_BEFORE_END = 3;
/** Staré letáky mažeme po toľkých dňoch od konca platnosti. */
const KEEP_DAYS_AFTER_END = 7;

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(new Date()); // YYYY-MM-DD

const dayNumber = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(INDEX, "utf8"));
  } catch {
    return { updatedAt: null, leaflets: [] };
  }
}

async function download(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** Treba obchod teraz kontrolovať? Áno, keď nemáme aktuálny leták, alebo sa blíži koniec a nemáme budúci. */
function needsCheck(leaflets) {
  if (force) return "vynútená kontrola";
  const current = leaflets.find((l) => l.validFrom <= today && today <= l.validTo);
  const upcoming = leaflets.find((l) => l.validFrom > today);
  if (!current) return "nemáme aktuálny leták";
  if (!upcoming && daysBetween(today, current.validTo) <= CHECK_DAYS_BEFORE_END) return "leták končí, hľadáme nový";
  return null;
}

async function processStore(store, index) {
  const mine = index.leaflets.filter((l) => l.store === store.id);
  const reason = needsCheck(mine);
  if (!reason) {
    console.log(`[${store.id}] preskakujem (aktuálny leták platí do ${mine.find((l) => l.validFrom <= today && today <= l.validTo)?.validTo})`);
    return false;
  }
  console.log(`[${store.id}] kontrolujem: ${reason}`);

  // Obchody, ktoré majú dáta priamo na stránke (bez PDF), vracajú hotové letáky.
  if (store.fetchLeaflets) {
    let changed = false;
    for (const lf of await store.fetchLeaflets({ known: new Set(mine.map((l) => l.source)) })) {
      const prev = mine.find((l) => l.validFrom === lf.validFrom);
      if (!force && prev && prev.count === lf.deals.length) continue;
      if (lf.deals.length < 10) {
        console.warn(`[${store.id}] podozrivo málo zliav (${lf.deals.length}), leták neukladám`);
        continue;
      }
      const file = `${store.id}/${lf.validFrom}.json`;
      await fs.mkdir(path.join(DATA, store.id), { recursive: true });
      await fs.writeFile(
        path.join(DATA, file),
        JSON.stringify({ store: store.id, validFrom: lf.validFrom, validTo: lf.validTo, deals: lf.deals }),
        "utf8"
      );
      index.leaflets = index.leaflets.filter((l) => !(l.store === store.id && l.validFrom === lf.validFrom));
      index.leaflets.push({ store: store.id, file, validFrom: lf.validFrom, validTo: lf.validTo, source: lf.source, count: lf.deals.length });
      console.log(`[${store.id}] uložené: ${file} (${lf.deals.length} zliav, ${lf.validFrom} až ${lf.validTo})`);
      changed = true;
    }
    return changed;
  }

  const found = await store.discover();
  console.log(`[${store.id}] nájdené letáky: ${found.length}`);
  let changed = false;

  for (const item of found) {
    const source = item.pdfUrl.split("?")[0];
    if (!force && mine.some((l) => l.source === source)) continue;

    console.log(`[${store.id}] sťahujem ${source}`);
    const pdf = await download(item.pdfUrl);
    const pages = await readPdfPages(pdf);
    const validity = extractValidity(pageText(pages[0])) ??
      extractValidity(pages.slice(0, 3).map(pageText).join(" ")) ??
      (item.validFrom && item.validTo ? { validFrom: item.validFrom, validTo: item.validTo } : null);
    if (!validity) {
      console.warn(`[${store.id}] nepodarilo sa zistiť platnosť letáku, preskakujem`);
      continue;
    }

    let deals = parseFlyer(pages);
    if (AI_STORES.has(store.id) && process.env.ANTHROPIC_API_KEY) {
      deals = await readWithAI(store.id, pdf, deals);
    }
    if (deals.length < 10) {
      console.warn(`[${store.id}] podozrivo málo zliav (${deals.length}), leták neukladám`);
      continue;
    }

    const file = `${store.id}/${validity.validFrom}.json`;
    await fs.mkdir(path.join(DATA, store.id), { recursive: true });
    await fs.writeFile(
      path.join(DATA, file),
      JSON.stringify({ store: store.id, validFrom: validity.validFrom, validTo: validity.validTo, deals }),
      "utf8"
    );
    index.leaflets = index.leaflets.filter((l) => !(l.store === store.id && l.validFrom === validity.validFrom));
    index.leaflets.push({ store: store.id, file, validFrom: validity.validFrom, validTo: validity.validTo, source });
    console.log(`[${store.id}] uložené: ${file} (${deals.length} zliav, ${validity.validFrom} až ${validity.validTo})`);
    changed = true;
  }
  return changed;
}

/**
 * AI prečíta leták ako obrázky. Jej výsledok sa použije len vtedy, keď prešiel kontrolami:
 * žiadna strana nezlyhala a AI našla aspoň 80 % toho, čo pôvodný parser. Inak ostáva pôvodný výsledok.
 */
async function readWithAI(storeId, pdf, fallback) {
  try {
    const read = await readFlyerWithAI(pdf);
    const { deals, issues } = toAppDeals(read.deals);
    console.log(`[${storeId}] AI: ${deals.length} zliav (pôvodný parser ${fallback.length}), tokeny ${read.usage.input}/${read.usage.output}, zahodených ${issues.dropped}, opravených percent ${issues.percentFixed}`);
    if (read.failedPages > 0) {
      console.warn(`[${storeId}] AI neprečítala ${read.failedPages} strán, používam pôvodný parser`);
      return fallback;
    }
    if (deals.length < fallback.length * 0.8) {
      console.warn(`[${storeId}] AI našla podozrivo málo zliav, používam pôvodný parser`);
      return fallback;
    }
    return deals;
  } catch (err) {
    console.warn(`[${storeId}] AI čítanie zlyhalo (${err.message}), používam pôvodný parser`);
    return fallback;
  }
}

async function prune(index) {
  const keep = [];
  for (const l of index.leaflets) {
    if (daysBetween(l.validTo, today) > KEEP_DAYS_AFTER_END) {
      await fs.rm(path.join(DATA, l.file), { force: true });
      console.log(`odstránený starý leták ${l.file}`);
    } else keep.push(l);
  }
  index.leaflets = keep;
}

/**
 * Znova zaradí produkty do kategórií podľa aktuálnych pravidiel (categorize.mjs).
 * Vďaka tomu sa oprava pravidiel prejaví aj v letákoch, ktoré už máme stiahnuté.
 */
async function recategorizeAll(index) {
  let changed = false;
  for (const l of index.leaflets) {
    if (only && l.store !== only) continue;
    const file = path.join(DATA, l.file);
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    let touched = 0;
    for (const deal of data.deals ?? []) {
      const c = recategorize(l.store, deal.n, deal.d, deal.c);
      if (c !== deal.c) {
        if (c) deal.c = c;
        else delete deal.c;
        touched++;
      }
      const tags = dietTags(deal.n, deal.d);
      if (tags.join() !== (deal.f ?? []).join()) {
        if (tags.length) deal.f = tags;
        else delete deal.f;
        touched++;
      }
    }
    if (touched) {
      await fs.writeFile(file, JSON.stringify(data), "utf8");
      console.log(`[${l.store}] ${l.file}: znova zaradených ${touched} produktov do kategórií`);
      changed = true;
    }
  }
  return changed;
}

/** Ku každému letáku si zapamätáme odtlačok obsahu, aby appka vedela, že sa súbor zmenil. */
async function stampRevisions(index) {
  let changed = false;
  for (const l of index.leaflets) {
    try {
      const rev = createHash("sha1").update(await fs.readFile(path.join(DATA, l.file))).digest("hex").slice(0, 10);
      if (l.rev !== rev) {
        l.rev = rev;
        changed = true;
      }
    } catch {
      /* súbor chýba – necháme tak */
    }
  }
  return changed;
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const index = await readIndex();
  let failures = 0;
  let changed = false;

  for (const store of stores) {
    if (only && store.id !== only) continue;
    try {
      changed = (await processStore(store, index)) || changed;
    } catch (err) {
      failures++;
      console.error(`[${store.id}] CHYBA: ${err.stack || err}`);
    }
  }

  const before = index.leaflets.length;
  await prune(index);
  changed = changed || index.leaflets.length !== before;

  changed = (await recategorizeAll(index)) || changed;
  changed = (await classifyAll(index, DATA, only)) || changed;
  changed = (await stampRevisions(index)) || changed;

  if (changed) {
    index.leaflets.sort((a, b) => a.store.localeCompare(b.store) || a.validFrom.localeCompare(b.validFrom));
    index.updatedAt = new Date().toISOString();
    await fs.writeFile(INDEX, JSON.stringify(index, null, 2) + "\n", "utf8");
    console.log("index.json aktualizovaný");
  } else {
    console.log("bez zmien");
  }
  await fs.writeFile(path.join(DATA, "status.txt"), `${new Date().toISOString()}\n${logLines.join("\n")}\n`, "utf8");
  if (failures) process.exitCode = 1;
}

main();
