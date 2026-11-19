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
import { classifyAll, keyOf, loadCategoryCache } from "./classify.mjs";
import { readFlyerWithAI, toAppDeals } from "./aiReader.mjs";
import { fillCondition, tidyCondition } from "./conditions.mjs";

// Žiadne sieťové volanie nesmie visieť donekonečna (server, ktorý neodpovedá, by zablokoval celý beh):
// stránky a PDF majú 60 sekúnd, AI odpovede 180 sekúnd. Po uplynutí sa volanie preruší a zvyšok behu pokračuje.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  if (init.signal) return realFetch(input, init);
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  const ms = url.includes("api.anthropic.com") ? 180_000 : 60_000;
  return realFetch(input, { ...init, signal: AbortSignal.timeout(ms) });
};

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

/**
 * Obchody, ktorých PDF leták číta AI (Claude). Ostatné (dáta priamo zo stránky: Kaufland, COOP, Teta, YEME)
 * čítajú pôvodné parsery. Model sa dá zmeniť premennou AI_READ_MODEL (pre všetky) alebo AI_READ_MODEL_<OBCHOD>.
 */
const AI_STORES = new Set(["billa", "tesco", "lidl", "kraj", "drogerie101"]);

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.find((a) => !a.startsWith("--"));

/** Kontrolu pred koncom platnosti letáku začíname toľko dní vopred. */
const CHECK_DAYS_BEFORE_END = 3;
/** Staré letáky mažeme po toľkých dňoch od konca platnosti. */
const KEEP_DAYS_AFTER_END = 7;

let problems = 0; // koľkokrát sa odmietol leták so zlou platnosťou
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(new Date()); // YYYY-MM-DD

const dayNumber = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

/** Najdlhšia možná platnosť jedného letáku (dni vrátane oboch krajných). Dlhšia platnosť = chyba pri čítaní dátumov. */
const MAX_DAYS = { kaufland: 14, billa: 8, tesco: 8, lidl: 8, coop: 8, kraj: 8, drogerie101: 15, teta: 2, yeme: 2 };
/** Obchody, ktoré nemajú pevné letákové obdobie (dáta zo stránky e-shopu, každý deň nové) – tam sa prekrývanie nekontroluje. */
const DAILY_SNAPSHOT = new Set(["teta", "yeme"]);
const isRealDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Vráti text chyby, ak je platnosť letáku nezmyselná, inak null. Zlá platnosť sa NIKDY neuloží. */
function validityProblem(storeId, validFrom, validTo) {
  if (!isRealDate(validFrom) || !isRealDate(validTo)) return `neplatný dátum (${validFrom} – ${validTo})`;
  if (validFrom > validTo) return `začiatok ${validFrom} je po konci ${validTo}`;
  const days = daysBetween(validFrom, validTo) + 1;
  const max = MAX_DAYS[storeId] ?? 15;
  if (days > max) return `platnosť ${validFrom} – ${validTo} je ${days} dní (maximum ${max})`;
  return null;
}

/** Overí celý index: platnosť každého letáku, zhodu so súborom a že sa letáky jedného obchodu neprekrývajú. */
async function auditIndex(index) {
  const problems = [];
  for (const l of index.leaflets) {
    const bad = validityProblem(l.store, l.validFrom, l.validTo);
    if (bad) problems.push(`[${l.store}] ${l.file}: ${bad}`);
    try {
      const f = JSON.parse(await fs.readFile(path.join(DATA, l.file), "utf8"));
      if (f.validFrom !== l.validFrom || f.validTo !== l.validTo) problems.push(`[${l.store}] ${l.file}: platnosť v súbore (${f.validFrom} – ${f.validTo}) sa líši od indexu (${l.validFrom} – ${l.validTo})`);
      for (const d of f.deals ?? []) {
        if ((d.vf && !isRealDate(d.vf)) || (d.vt && !isRealDate(d.vt))) { problems.push(`[${l.store}] ${l.file}: ponuka "${d.n}" má neplatné dátumy`); break; }
      }
    } catch {
      problems.push(`[${l.store}] ${l.file}: súbor chýba alebo je poškodený`);
    }
  }
  for (const store of new Set(index.leaflets.map((l) => l.store))) {
    if (DAILY_SNAPSHOT.has(store)) continue;
    const mine = index.leaflets.filter((l) => l.store === store).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (let i = 1; i < mine.length; i++) {
      if (mine[i].validFrom <= mine[i - 1].validTo) problems.push(`[${store}] letáky sa prekrývajú: ${mine[i - 1].validFrom}–${mine[i - 1].validTo} a ${mine[i].validFrom}–${mine[i].validTo}`);
    }
  }
  return problems;
}

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
  // Obchody s hotovými dátami na stránke (bez PDF a AI) kontrolujeme vždy – je to lacné a ponuky sa tam môžu meniť.
  const reason = store.fetchLeaflets ? "kontrola dát na stránke" : needsCheck(mine);
  if (!reason) {
    console.log(`[${store.id}] preskakujem (aktuálny leták platí do ${mine.find((l) => l.validFrom <= today && today <= l.validTo)?.validTo})`);
    return false;
  }
  console.log(`[${store.id}] kontrolujem: ${reason}`);

  // Obchody, ktoré majú dáta priamo na stránke (bez PDF), vracajú hotové letáky.
  if (store.fetchLeaflets) {
    let changed = false;
    const useAI = AI_STORES.has(store.id) && process.env.ANTHROPIC_API_KEY;
    // Pri vynútenom čítaní (--force) sa znova prečíta aj leták, ktorý už máme.
    const known = force ? new Set() : new Set(mine.map((l) => l.source));
    const fetched = await store.fetchLeaflets({ known });
    // Kaufland: starý chybný leták (zlepené viaceré týždne) nahradia správne týždenné letáky.
    if (store.id === "kaufland" && fetched.length) {
      const starts = new Set(fetched.map((l) => l.validFrom));
      const stale = (l) => l.store === "kaufland" && !starts.has(l.validFrom) && l.validTo >= fetched[0].validFrom && l.validFrom <= fetched[fetched.length - 1].validTo;
      for (const l of index.leaflets.filter(stale)) {
        await fs.rm(path.join(DATA, l.file), { force: true });
        console.log(`[kaufland] odstraňujem starý prekrývajúci sa leták ${l.file} (${l.validFrom} – ${l.validTo})`);
      }
      index.leaflets = index.leaflets.filter((l) => !stale(l));
      changed = true;
    }
    for (const lf of fetched) {
      if (useAI && lf.pdf) {
        // Za AI čítanie platíme, takže nikdy nečítame leták, ktorý už skončil.
        if (lf.validTo < today) {
          console.log(`[${store.id}] leták ${lf.validFrom} až ${lf.validTo} už skončil, AI ho nečíta`);
          continue;
        }
        lf.deals = await readWithAI(store.id, lf.pdf, lf.deals);
      }
      const problem = validityProblem(store.id, lf.validFrom, lf.validTo);
      if (problem) {
        console.error(`[${store.id}] leták neukladám, zlá platnosť: ${problem}`);
        problems++;
        continue;
      }
      const prev = mine.find((l) => l.validFrom === lf.validFrom);
      // Teta a YEME nemajú platnosť uvedenú nikde (ceny z e-shopu, nie leták). Preto každý deň porovnáme nové ponuky
      // s predošlým stavom: zapíšeme, koľko sa ich zmenilo (z toho sa dá vidieť, ako často sa menia), a čiastočné
      // stiahnutie (výrazne menej produktov než včera) radšej neuložíme.
      if (DAILY_SNAPSHOT.has(store.id)) {
        const last = [...mine].filter((l) => l.validFrom < lf.validFrom).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
        if (last) {
          try {
            const before = JSON.parse(await fs.readFile(path.join(DATA, last.file), "utf8")).deals ?? [];
            const old = new Map(before.map((d) => [d.n, d]));
            const now = new Map(lf.deals.map((d) => [d.n, d]));
            const added = [...now.keys()].filter((k) => !old.has(k)).length;
            const removed = [...old.keys()].filter((k) => !now.has(k)).length;
            const repriced = [...now.keys()].filter((k) => old.has(k) && old.get(k).p !== now.get(k).p).length;
            console.log(`[${store.id}] zmeny od ${last.validFrom}: ${before.length} → ${lf.deals.length} produktov, pribudlo ${added}, ubudlo ${removed}, zmenená cena ${repriced}`);
            if (lf.complete) {
              if (lf.deals.length < before.length * 0.8) console.warn(`[${store.id}] výrazný pokles (${before.length} → ${lf.deals.length}), ale web potvrdil koniec zoznamu, ukladám`);
            } else if (lf.deals.length < before.length * 0.8) {
              console.error(`[${store.id}] podozrivo málo produktov (${lf.deals.length} oproti ${before.length}), stiahnutie neukladám`);
              problems++;
              continue;
            }
          } catch { /* predošlý súbor chýba – nie je s čím porovnať */ }
        }
      }
      const file = `${store.id}/${lf.validFrom}.json`;
      const content = JSON.stringify({ store: store.id, validFrom: lf.validFrom, validTo: lf.validTo, deals: lf.deals });
      let existing = null;
      try { existing = await fs.readFile(path.join(DATA, file), "utf8"); } catch { /* nový súbor */ }
      // Prepíšeme len vtedy, keď sa obsah zmenil (existujúci súbor má doplnené kategórie, preto porovnávame počet aj podmienky).
      const sameCount = prev && prev.count === lf.deals.length;
      const conditionsCount = (txt) => (txt.match(/"q":/g) ?? []).length;
      if (!force && sameCount && existing && conditionsCount(existing) >= conditionsCount(content)) continue;
      if (lf.deals.length < 10) {
        console.warn(`[${store.id}] podozrivo málo zliav (${lf.deals.length}), leták neukladám`);
        continue;
      }
      await fs.mkdir(path.join(DATA, store.id), { recursive: true });
      await fs.writeFile(path.join(DATA, file), content, "utf8");
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

    const problem = validityProblem(store.id, validity.validFrom, validity.validTo);
    if (problem) {
      console.error(`[${store.id}] leták neukladám, zlá platnosť: ${problem}`);
      problems++;
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
    const model = process.env[`AI_READ_MODEL_${storeId.toUpperCase()}`] || undefined;
    const read = await readFlyerWithAI(pdf, model ? { model } : {});
    const { deals, issues } = toAppDeals(read.deals);
    console.log(`[${storeId}] AI: ${deals.length} zliav (pôvodný parser ${fallback.length}), strán ${read.pages}, model ${read.model}, tokeny ${read.usage.input}/${read.usage.output}, zahodených ${issues.dropped}, opravených percent ${issues.percentFixed}`);
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
  const aiCategories = await loadCategoryCache(DATA);
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
      // Kategória, ktorú určila AI, má prednosť pred slovnými pravidlami.
      const c = aiCategories[keyOf(deal)] ?? recategorize(l.store, deal.n, deal.d, deal.c);
      if (c !== deal.c) {
        if (c) deal.c = c;
        else delete deal.c;
        touched++;
      }
      if (fillCondition(deal)) touched++;
      if (tidyCondition(deal)) touched++;
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
      // Žiadny obchod nesmie blokovať celý beh dlhšie ako 8 minút (AI čítanie letákov je vo výnimke – 40 min).
      const limitMs = AI_STORES.has(store.id) ? 40 * 60_000 : 8 * 60_000;
      let timer;
      const stuck = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`prekročený časový limit ${limitMs / 60000} min, obchod preskakujem`)), limitMs); });
      try {
        changed = (await Promise.race([processStore(store, index), stuck])) || changed;
      } finally { clearTimeout(timer); }
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

  // Teta/YEME: staršie snapshoty mali platnosť o deň dlhšiu; skrátime ich na "deň sťahovania a nasledujúci deň".
  for (const l of index.leaflets.filter((l) => DAILY_SNAPSHOT.has(l.store) && daysBetween(l.validFrom, l.validTo) > 1)) {
    const to = new Date((dayNumber(l.validFrom) + 1) * 86400000).toISOString().slice(0, 10);
    try {
      const f = JSON.parse(await fs.readFile(path.join(DATA, l.file), "utf8"));
      f.validTo = to;
      await fs.writeFile(path.join(DATA, l.file), JSON.stringify(f), "utf8");
      l.validTo = to;
      changed = true;
    } catch { /* súbor chýba – auditom sa ohlási */ }
  }
  if (changed) changed = (await stampRevisions(index)) || changed;

  // Posledná poistka: ak by index obsahoval zlú alebo si odporujúcu platnosť, beh skončí chybou (Actions zčervenie).
  const audit = await auditIndex(index);
  for (const p of audit) console.error(`KONTROLA PLATNOSTI: ${p}`);
  if (audit.length || problems) failures += audit.length + problems;

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
