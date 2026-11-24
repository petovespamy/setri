// AI zaradenie zliav do typov produktov (sušienky, citróny, psie granule…) a do kategórií vo Feede.
// Claude prečíta CELÝ názov produktu, nielen jednotlivé slová, a vyberie typ zo zoznamu v productTypes.mjs
// a kategóriu zo zoznamu CATEGORIES nižšie.
// Typ sa uloží ku každej zľave ako "t" (cache: data/type_cache.json), kategória ako "c" (cache: data/category_cache_v2.json),
// takže sa každý názov posiela AI len raz. Ak AI kategóriu nedá, ostáva kategória zo slovných pravidiel (categorize.mjs).
// Ak nie je nastavený ANTHROPIC_API_KEY, preskočí sa (appka vtedy použije svoje slovné pravidlá).
import fs from "node:fs/promises";
import path from "node:path";
import { PRODUCT_TYPES } from "./productTypes.mjs";

const MODEL = process.env.CLASSIFY_MODEL || "claude-sonnet-5-5";
const BATCH = 40;
const VALID = new Set([...PRODUCT_TYPES.map((t) => t.id), "other"]);

/** Kategórie vo Feede (rovnaké id ako ProductCategory v appke; "Vegan" a "Bezlepkové" sú označenia, nie kategórie). */
export const CATEGORIES = [
  ["fruitveg", "Ovocie & zelenina (čerstvé ovocie, zelenina, bylinky, huby)"],
  ["bakery", "Pekáreň (chlieb, pečivo, koláče, torty)"],
  ["meat", "Mäso & ryby (čerstvé a chladené mäso, ryby, hydina)"],
  ["deli", "Údeniny & lahôdky (šunka, saláma, párky, paštéty, lahôdkové nátierky)"],
  ["dairy", "Mliečne výrobky & vajcia (mlieko, jogurty, syry, maslo, smotana, vajcia)"],
  ["ready", "Hotové jedlá (pizza, polievky, sendviče, hotové menu)"],
  ["pantry", "Trvanlivé potraviny (cestoviny, ryža, múka, konzervy, oleje, korenie, omáčky, cukor, cereálie, nátierky)"],
  ["frozen", "Mrazené (mrazená zelenina, mrazené jedlá, zmrzlina)"],
  ["sweets", "Sladkosti & snacky (čokoláda, sušienky, cukríky, chipsy, oriešky)"],
  ["drinks", "Nápoje (voda, džúsy, malinovky, cola, energetické nápoje, ľadové čaje a hotové studené kávy, nealko pivo)"],
  ["hotdrinks", "Káva, čaj & zalievané nápoje (zrnková, mletá, instantná a kapsulová káva, kávovina, čaje, instantné a zalievané nápoje, horúca čokoláda, instantné kakao)"],
  ["alcohol", "Víno & alkohol (pivo, víno, destiláty, likéry)"],
  ["drugstore", "Drogéria (hygiena, kozmetika, zubné pasty, vitamíny, lieky)"],
  ["household", "Domácnosť (čistiace a prané prostriedky, toaletný papier, vrecká, batérie, žiarovky)"],
  ["seasonal", "Sezónne & dekorácie (sviečky, vianočné a halloweenske dekorácie, kvety)"],
  ["nonfood", "Ostatný tovar (oblečenie, náradie, elektro, hračky, riad, textil, papiernictvo)"],
  ["baby", "Deti & bábätká (plienky, detská výživa)"],
  ["pets", "Domáce zvieratá (krmivo, stelivo)"],
];
const VALID_CATEGORIES = new Set(CATEGORIES.map(([id]) => id));

const SYSTEM = `Si expert na slovenské obchody a ich letáky. Dostaneš číslovaný zoznam produktov z letákov (názov | podrobnosť).
Pre každý produkt urči, ČO TO CELÉ JE, a vyber práve jeden typ zo zoznamu A práve jednu kategóriu.

Pravidlá:
- Rozhoduj podľa celého názvu a podľa toho, čo produkt reálne je. Príchuť alebo prísada nie je typ: "Citrónové sušienky" sú sušienky, "Čokoládový jogurt" je jogurt, "Pes granule" sú krmivo.
- Značka (aj privátna: Clever, K-Classic, Tesco, Pilos…) ti pomáha, ale sama typ neurčuje.
- Ak nič zo zoznamu nesedí, použi "other".

Typy (id – názov – nadkategória):
${PRODUCT_TYPES.map((t) => `${t.id} – ${t.label} – ${t.parent}`).join("\n")}
other – nič z uvedeného

Kategórie (id – názov a čo tam patrí):
${CATEGORIES.map(([id, label]) => `${id} – ${label}`).join("\n")}
Kategóriu vyber podľa toho, čo produkt reálne je, nie podľa príchute alebo prísady: "Čokoládový jogurt" je dairy, "Citrónové sušienky" sú sweets, "Pes granule" sú pets, "Kuracie prsia" sú meat. Vždy vyber niektorú z uvedených kategórií.

Najprv si v hlave urči, čo to za produkt naozaj je (použi svoju znalosť značiek a slovenského trhu, prípadne podrobnosť za názvom), a až potom vyber kategóriu. Názov môže zavádzať: "Bambino črievko" a "Karička črievko" sú tavené syry (dairy), nie pečivo ani sladkosti; "Mochi" sú ryžové sladkosti; "ryžové chlebíčky" a "kukuričné chlebíčky" sú chrumkavé snacky, nie pečivo.
Hranica Pekáreň vs. Sladkosti: do bakery patrí čerstvé alebo pečené pekárenské pečivo (chlieb, rožky, žemle, bagety, kaizerky, croissanty, donuty, koláče, šišky, vianočky, štrúdle, závin, muffiny, torty z pekárne). Balené, trvanlivé a cukrárenské sladkosti (mliečny rez, Vesna, Brumík, Kinder Delice, Marlenka, veterníky, zákusky, perníky a lebkuchen, piškóty, pusinky, oblátky, sušienky, mochi) sú sweets. Slané tyčinky, krekry a chlebíčky/chlebíky z ryže alebo kukurice sú sweets (slané snacky). Cesto na pizzu a iné cestá a základy na pečenie sú pantry; hotová pizza a pinsa sú ready. Hotové studené nápoje (ľadový čaj, ice coffee, Starbucks vo fľaši) sú drinks; všetko, čo sa zalieva horúcou vodou alebo mliekom (zrnková a mletá káva, instantná káva, kapsuly, čaje, instantné kakao, horúca čokoláda), je hotdrinks.

Ku každému produktu dodaj aj "k": 3 až 10 krátkych slov (malé písmená), ktoré o produkte povedia čo najviac: druh produktu tak, ako by ho človek napísal do nákupného zoznamu (pivo, mlieko, sušienky), bežné synonymá a hovorové názvy (rožky aj pečivo, kofola aj malinovka), značka, ak ju poznáš, a zásadné vlastnosti (nealko, bezlepkové, bez laktózy, vegan, bio, light, bez cukru, svetlé, tmavé, príchuť, na čo sa používa: na grilovanie, na pečenie, na raňajky). Napríklad "Wywar nealko" -> ["pivo","nealko","svetle"], "Birell" -> ["pivo","nealko"], "Coca-Cola Zero" -> ["cola","bez cukru"]. Nevymýšľaj: píš len to, čo z názvu alebo z tvojej istej znalosti produktu vyplýva.

Odpovedz IBA jedným JSON objektom, kde kľúč je číslo produktu a hodnota je objekt s typom (t), kategóriou (c) a slovami (k), napr. {"1":{"t":"biscuit","c":"sweets","k":["sušienky","čokoláda"]},"2":{"t":"fruit","c":"fruitveg","k":["ovocie","jablko"]}}. Žiadny ďalší text.`;

export const keyOf = (deal) => `${deal.n ?? ""} | ${deal.d ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();

// Počet zlyhaní spojenia/API za sebou. Pri výpadku siete alebo vyčerpanom limite sa nemá donekonečna opakovať.
let connectionFailures = 0;
let lastErrorWasParse = false;
const MAX_CONNECTION_FAILURES = 6;

const API_HEADERS = (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" });
/** Zadanie pre AI sa nemení; cache_control ho po prvom volaní číta za desatinu ceny (výsledok je rovnaký). */
const SYSTEM_BLOCKS = [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];
const listOf = (items) => items.map((it, i) => `${i + 1}. ${it.deal.n}${it.deal.d ? " | " + it.deal.d : ""}`).join("\n");
const parseAnswer = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

// Hotové odpovede z Batch API (zoznam produktov -> JSON). askClaude ich použije namiesto bežného volania.
const prefetched = new Map();
const BATCH_MIN_CHUNKS = 6;
const BATCH_WAIT_MS = (Number(process.env.AI_BATCH_WAIT_MIN) || 20) * 60_000;

/**
 * Pri veľkom počte názvov (napr. po zmene pravidiel) pošle dávky cez Message Batches API (polovičná cena, rovnaký model
 * aj zadanie). Čo sa nepodarí, dobehne bežným volaním v askClaude, takže výsledok je rovnaký, len lacnejší.
 */
async function prefetchViaBatch(apiKey, chunks) {
  if (chunks.length < BATCH_MIN_CHUNKS) return;
  const lists = chunks.map(listOf);
  try {
    const create = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: API_HEADERS(apiKey),
      body: JSON.stringify({
        requests: lists.map((list, i) => ({
          custom_id: `c${i}`,
          params: { model: MODEL, max_tokens: 8000, system: SYSTEM_BLOCKS, messages: [{ role: "user", content: list }] },
        })),
      }),
    });
    if (!create.ok) throw new Error(`HTTP ${create.status}: ${(await create.text()).slice(0, 200)}`);
    const batch = await create.json();
    console.log(`[classify] batch ${batch.id}: ${lists.length} dávok`);
    const started = Date.now();
    let info = batch;
    let cancelled = false;
    while (info.processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, 30_000));
      const r = await fetch(`https://api.anthropic.com/v1/messages/batches/${batch.id}`, { headers: API_HEADERS(apiKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status} pri čakaní na batch`);
      info = await r.json();
      if (!cancelled && Date.now() - started > BATCH_WAIT_MS) {
        console.warn("[classify] batch trvá dlho, rušíme ho a zvyšok dobehne bežne");
        await fetch(`https://api.anthropic.com/v1/messages/batches/${batch.id}/cancel`, { method: "POST", headers: API_HEADERS(apiKey) });
        cancelled = true;
      }
      if (cancelled && Date.now() - started > BATCH_WAIT_MS + 5 * 60_000) throw new Error("batch sa po zrušení neukončil");
    }
    if (!info.results_url) throw new Error("batch nemá results_url");
    const res = await fetch(info.results_url, { headers: API_HEADERS(apiKey) });
    if (!res.ok) throw new Error(`HTTP ${res.status} pri sťahovaní výsledkov`);
    let ok = 0;
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.result?.type !== "succeeded") continue;
        const i = Number(String(row.custom_id).slice(1));
        const text = row.result.message?.content?.map((c) => c.text ?? "").join("") ?? "";
        prefetched.set(lists[i], parseAnswer(text));
        ok++;
      } catch { /* táto dávka dobehne bežne */ }
    }
    console.log(`[classify] batch hotový: ${ok} z ${lists.length} dávok, zvyšok dobehne bežne`);
  } catch (err) {
    console.error(`[classify] batch zlyhal (${err.message}), všetko prebehne bežne`);
  }
}

async function askClaude(apiKey, items) {
  const list = listOf(items);
  if (prefetched.has(list)) {
    connectionFailures = 0;
    return prefetched.get(list);
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    let parseProblem = false;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM_BLOCKS, messages: [{ role: "user", content: list }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      const text = body.content?.map((c) => c.text ?? "").join("") ?? "";
      try {
        const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        connectionFailures = 0;
        return json;
      } catch (parseErr) {
        parseProblem = true;
        throw parseErr;
      }
    } catch (err) {
      console.error(`[classify] pokus ${attempt} zlyhal: ${err.message}`);
      lastErrorWasParse = parseProblem;
      if (!parseProblem) {
        // Výpadok siete, limit alebo chyba API: nemá zmysel dávku deliť, len chvíľu počkáme.
        connectionFailures++;
        if (connectionFailures >= MAX_CONNECTION_FAILURES) break;
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
    }
  }
  return null;
}

/** Načíta pamäť AI kategórií (kľúč názvu -> id kategórie). */
export async function loadCategoryCache(DATA) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, "category_cache_v2.json"), "utf8"));
  } catch {
    return {};
  }
}

/** Doplní "t" (typ) a "c" (kategóriu) ku zľavám. Vráti true, ak sa nejaký súbor zmenil. */
export async function classifyAll(index, DATA, only) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[classify] preskakujem (chýba ANTHROPIC_API_KEY)");
    return false;
  }
  const cachePath = path.join(DATA, "type_cache.json");
  const catPath = path.join(DATA, "category_cache_v2.json");
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {}
  const catCache = await loadCategoryCache(DATA);
  const kwPath = path.join(DATA, "keywords_cache.json");
  let kwCache = {};
  try {
    kwCache = JSON.parse(await fs.readFile(kwPath, "utf8"));
  } catch {}

  // 1. načítame letáky a doplníme z pamäte
  const files = [];
  const pending = new Map(); // kľúč -> [{deal, entry}…]
  for (const l of index.leaflets) {
    if (only && l.store !== only) continue;
    const file = path.join(DATA, l.file);
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const entry = { file, data, touched: false };
    files.push(entry);
    for (const deal of data.deals ?? []) {
      const key = keyOf(deal);
      if (!deal.t && cache[key]) {
        deal.t = cache[key];
        entry.touched = true;
      }
      if (catCache[key] && deal.c !== catCache[key]) {
        deal.c = catCache[key];
        entry.touched = true;
      }
      if (kwCache[key] && JSON.stringify(deal.k) !== JSON.stringify(kwCache[key])) {
        deal.k = kwCache[key];
        entry.touched = true;
      }
      if (deal.t && catCache[key] && kwCache[key]) continue;
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push({ deal, entry });
    }
  }

  // 2. nové názvy pošleme AI po dávkach
  const keys = [...pending.keys()];
  let asked = 0;
  let askedCategories = 0;
  let askedKeywords = 0;
  let changedAny = false;
  const handleChunk = async (chunk) => {
    if (connectionFailures >= MAX_CONNECTION_FAILURES) return;
    const answer = await askClaude(apiKey, chunk);
    if (!answer) {
      // Dávka zlyhala, lebo AI vrátila pokazený JSON: skúsime ju rozdeliť na polovice.
      // Pri výpadku siete alebo limite sa nedelí (nepomohlo by to).
      if (lastErrorWasParse && chunk.length > 1) {
        const half = Math.ceil(chunk.length / 2);
        await handleChunk(chunk.slice(0, half));
        await handleChunk(chunk.slice(half));
      }
      return;
    }
    chunk.forEach((it, idx) => {
      const a = answer[String(idx + 1)];
      const t = typeof a === "string" ? a : a?.t;
      const c = typeof a === "object" ? a?.c : undefined;
      if (VALID.has(t) && !cache[it.key]) {
        cache[it.key] = t;
        asked++;
      }
      if (VALID_CATEGORIES.has(c)) {
        catCache[it.key] = c;
        askedCategories++;
      }
      const k = typeof a === "object" && Array.isArray(a?.k)
        ? a.k.filter((w) => typeof w === "string" && w.trim() && w.length <= 30).map((w) => w.trim().toLowerCase()).slice(0, 10)
        : [];
      if (k.length) {
        kwCache[it.key] = k;
        askedKeywords++;
      }
      for (const { deal, entry } of pending.get(it.key)) {
        if (!deal.t && cache[it.key]) {
          deal.t = cache[it.key];
          entry.touched = true;
        }
        if (catCache[it.key] && deal.c !== catCache[it.key]) {
          deal.c = catCache[it.key];
          entry.touched = true;
        }
        if (kwCache[it.key] && JSON.stringify(deal.k) !== JSON.stringify(kwCache[it.key])) {
          deal.k = kwCache[it.key];
          entry.touched = true;
        }
      }
    });
  };
  // Priebežné ukladanie: ak beh skončí skôr (výpadok, limit), hotová práca sa nestratí.
  let savedAsked = 0;
  let savedCategories = 0;
  let savedKeywords = 0;
  const saveProgress = async () => {
    for (const f of files) {
      if (!f.touched) continue;
      await fs.writeFile(f.file, JSON.stringify(f.data), "utf8");
      f.touched = false;
      changedAny = true;
    }
    if (asked !== savedAsked) { await fs.writeFile(cachePath, JSON.stringify(cache, null, 0), "utf8"); savedAsked = asked; changedAny = true; }
    if (askedKeywords !== savedKeywords) { await fs.writeFile(kwPath, JSON.stringify(kwCache, null, 0), "utf8"); savedKeywords = askedKeywords; changedAny = true; }
    if (askedCategories !== savedCategories) { await fs.writeFile(catPath, JSON.stringify(catCache, null, 0), "utf8"); savedCategories = askedCategories; changedAny = true; }
  };
  const allChunks = [];
  for (let i = 0; i < keys.length; i += BATCH) allChunks.push(keys.slice(i, i + BATCH).map((k) => ({ key: k, deal: pending.get(k)[0].deal })));
  await prefetchViaBatch(apiKey, allChunks);
  for (let i = 0; i < keys.length; i += BATCH) {
    await handleChunk(keys.slice(i, i + BATCH).map((k) => ({ key: k, deal: pending.get(k)[0].deal })));
    if (connectionFailures >= MAX_CONNECTION_FAILURES) {
      console.error("[classify] prerušené: AI je nedostupná (sieť alebo limit). Hotová práca sa uloží, zvyšok dobehne nabudúce.");
      break;
    }
    if ((i / BATCH) % 10 === 9) await saveProgress();
  }
  if (keys.length) console.log(`[classify] názvy na zaradenie: ${keys.length}, typy od AI: ${asked}, kategórie od AI: ${askedCategories}, slová od AI: ${askedKeywords}`);

  // 3. uložíme
  await saveProgress();
  return changedAny;
}

