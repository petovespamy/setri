// Anglické názvy produktov pre cudzincov na Slovensku.
// Zo všetkých aktuálnych letákov vezme unikátne názvy (n) a podrobnosti (d), preloží len tie, ktoré ešte nemajú preklad,
// a uloží ich do data/translations_en.json: { v, updatedAt, n: { "slovenský názov": "English name" }, d: { … } }.
// Letáky samotné sa nemenia (platnosť letákov je jadro appky, preto sa jej nedotýkame) – appka si preklady stiahne zvlášť.
// Preklad je samostatný krok na konci behu: ak zlyhá, appka ukáže slovenský názov a zajtra sa to skúsi znova.
//
// Úspora: každý názov sa prekladá raz, ďalšie dni len nové; model je lacný (Haiku), dávky po 100 názvov,
// väčšie množstvo ide cez Message Batches API (polovičná cena). Nastavenia: AI_TRANSLATE_MODEL, AI_TRANSLATE=0 (vypnúť).
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.anthropic.com/v1";
const MODEL = process.env.AI_TRANSLATE_MODEL || "claude-haiku-5-5";
const CHUNK = 100;
const BATCH_MIN_REQUESTS = 4;
const BATCH_WAIT_MS = (Number(process.env.AI_BATCH_WAIT_MIN) || 15) * 60_000;
const MAX_NEW_PER_RUN = Number(process.env.AI_TRANSLATE_MAX) || 15000;   // poistka proti nečakane veľkému účtu

const SYSTEM = `You translate product names from Slovak supermarket flyers into English for foreigners living in Slovakia.
You get a JSON array of Slovak strings (product names, or short package/detail descriptions such as "rôzne druhy" or "cena za 1 kg").
Return ONLY a JSON array of English strings: same length, same order, one translation per input, on a single line, no other text.
Rules:
- Natural, short, what an English speaker would call the product ("Mlieko polotučné" -> "Semi-skimmed milk").
- Keep brand names exactly as written (Rama, Milka, Coca-Cola, Kinder, Zlatý Bažant...).
- Keep numbers, weights, volumes, percentages and units as they are.
- Typical Slovak foods without an English equivalent: keep the Slovak name and add a short explanation ("Bryndzové halušky" -> "Bryndzové halušky (potato dumplings with sheep cheese)").
- Add nothing the original does not say. If a string cannot be translated (only a brand or a code), return it unchanged.`;

const headers = (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasWords = (s) => /\p{L}{4,}/u.test(s);

function params(items) {
  return { model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(items) }] };
}

function parseAnswer(text, expected) {
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  if (!Array.isArray(arr) || arr.length !== expected) throw new Error(`čakal som ${expected} prekladov, prišlo ${Array.isArray(arr) ? arr.length : "nie pole"}`);
  return arr.map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 200) : ""));
}

const textOf = (message) => message?.content?.map((c) => c.text ?? "").join("") ?? "";

async function translateNow(apiKey, items, usage) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/messages`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(params(items)) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      usage.input += body.usage?.input_tokens ?? 0;
      usage.output += body.usage?.output_tokens ?? 0;
      return parseAnswer(textOf(body), items.length);
    } catch (err) {
      console.error(`  [preklad] pokus ${attempt} zlyhal: ${err.message}`);
    }
  }
  return null;
}

/** Message Batches API: vráti Map custom_id -> pole prekladov (chýbajúce dočíta volajúci bežne). */
async function translateBatch(apiKey, chunks, usage) {
  const out = new Map();
  try {
    const create = await fetch(`${API}/messages/batches`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ requests: chunks.map((items, i) => ({ custom_id: `c${i}`, params: params(items) })) }),
    });
    if (!create.ok) throw new Error(`HTTP ${create.status}: ${(await create.text()).slice(0, 200)}`);
    let batch = await create.json();
    console.log(`  [preklad] batch ${batch.id}: ${chunks.length} dávok`);
    const started = Date.now();
    let cancelled = false;
    while (batch.processing_status !== "ended") {
      await sleep(Date.now() - started < 60_000 ? 15_000 : 30_000);
      const r = await fetch(`${API}/messages/batches/${batch.id}`, { headers: headers(apiKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status} pri čakaní na batch`);
      batch = await r.json();
      if (!cancelled && Date.now() - started > BATCH_WAIT_MS) {
        console.warn("  [preklad] batch nestihol, rušim ho a zvyšok dočítam bežne");
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
      if (row.result?.type !== "succeeded") continue;
      try {
        out.set(i, parseAnswer(textOf(row.result.message), chunks[i].length));
        usage.input += row.result.message.usage?.input_tokens ?? 0;
        usage.output += row.result.message.usage?.output_tokens ?? 0;
      } catch (err) {
        console.error(`  [preklad] batch dávka ${i}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  [preklad] batch zlyhal (${err.message}), zvyšok prekladám bežne`);
  }
  return out;
}

/** Preloží zoznam reťazcov. Vráti Map pôvodný -> anglický (len úspešne preložené). */
async function translateStrings(apiKey, strings, usage) {
  const result = new Map();
  const chunks = [];
  for (let i = 0; i < strings.length; i += CHUNK) chunks.push(strings.slice(i, i + CHUNK));
  let done = new Map();
  if (chunks.length >= BATCH_MIN_REQUESTS) done = await translateBatch(apiKey, chunks, usage);
  for (const [i, items] of chunks.entries()) {
    let answer = done.get(i);
    if (!answer) {
      answer = await translateNow(apiKey, items, usage);
      // Ak počet nesedí ani na druhý pokus, skús polovice (jedna zlá odpoveď nesmie zhodiť celú dávku).
      if (!answer && items.length > 10) {
        const half = Math.ceil(items.length / 2);
        const a = await translateNow(apiKey, items.slice(0, half), usage);
        const b = await translateNow(apiKey, items.slice(half), usage);
        if (a && b) answer = [...a, ...b];
      }
    }
    if (!answer) continue;
    items.forEach((s, k) => { if (answer[k]) result.set(s, answer[k]); });
  }
  return result;
}

/**
 * Zbiera názvy zo všetkých letákov v indexe, preloží chýbajúce a zapíše data/translations_en.json.
 * Nikdy nezhodí beh: chyby sa len vypíšu.
 */
export async function translateAll(index, DATA, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey || process.env.AI_TRANSLATE === "0") return;
  try {
    const file = path.join(DATA, "translations_en.json");
    let saved = { v: 1, n: {}, d: {} };
    try { saved = { ...saved, ...JSON.parse(await fs.readFile(file, "utf8")) }; } catch { /* ešte neexistuje */ }

    const names = new Set(), details = new Set();
    for (const l of index.leaflets) {
      let deals;
      try { deals = JSON.parse(await fs.readFile(path.join(DATA, l.file), "utf8")).deals ?? []; } catch { continue; }
      for (const d of deals) {
        if (typeof d.n === "string" && d.n.trim()) names.add(d.n.trim());
        if (typeof d.d === "string" && hasWords(d.d)) details.add(d.d.trim());
      }
    }

    const missingN = [...names].filter((s) => !saved.n[s]);
    const missingD = [...details].filter((s) => !saved.d[s]);
    const limitedN = missingN.slice(0, MAX_NEW_PER_RUN);
    const limitedD = missingD.slice(0, Math.max(0, MAX_NEW_PER_RUN - limitedN.length));
    if (missingN.length + missingD.length > limitedN.length + limitedD.length) {
      console.warn(`[preklad] limit ${MAX_NEW_PER_RUN} nových reťazcov na beh, zvyšok ${missingN.length + missingD.length - limitedN.length - limitedD.length} prejde zajtra`);
    }

    const usage = { input: 0, output: 0 };
    const newN = limitedN.length ? await translateStrings(apiKey, limitedN, usage) : new Map();
    const newD = limitedD.length ? await translateStrings(apiKey, limitedD, usage) : new Map();

    // Uložíme len to, čo sa v aktuálnych letákoch ešte vyskytuje (staré názvy sa tak samy čistia).
    const next = { v: 1, updatedAt: new Date().toISOString(), n: {}, d: {} };
    for (const s of names) { const t = newN.get(s) ?? saved.n[s]; if (t) next.n[s] = t; }
    for (const s of details) { const t = newD.get(s) ?? saved.d[s]; if (t) next.d[s] = t; }

    const same = JSON.stringify(next.n) === JSON.stringify(saved.n) && JSON.stringify(next.d) === JSON.stringify(saved.d);
    console.log(`[preklad] ${names.size} názvov, ${details.size} podrobností; nových ${newN.size + newD.size} (z ${limitedN.length + limitedD.length}), model ${MODEL}, tokeny ${usage.input}/${usage.output}`);
    if (!same) await fs.writeFile(file, JSON.stringify(next), "utf8");
  } catch (err) {
    console.warn(`[preklad] preskočené (${err.message})`);
  }
}
