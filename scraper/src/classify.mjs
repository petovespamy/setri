// AI zaradenie zliav do typov produktov (sušienky, citróny, psie granule…) a do kategórií vo Feede.
// Claude prečíta CELÝ názov produktu, nielen jednotlivé slová, a vyberie typ zo zoznamu v productTypes.mjs
// a kategóriu zo zoznamu CATEGORIES nižšie.
// Typ sa uloží ku každej zľave ako "t" (cache: data/type_cache.json), kategória ako "c" (cache: data/category_cache.json),
// takže sa každý názov posiela AI len raz. Ak AI kategóriu nedá, ostáva kategória zo slovných pravidiel (categorize.mjs).
// Ak nie je nastavený ANTHROPIC_API_KEY, preskočí sa (appka vtedy použije svoje slovné pravidlá).
import fs from "node:fs/promises";
import path from "node:path";
import { PRODUCT_TYPES } from "./productTypes.mjs";

const MODEL = process.env.CLASSIFY_MODEL || "claude-haiku-5-5";
const BATCH = 60;
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
  ["drinks", "Nápoje (voda, džúsy, malinovky, energetické nápoje, káva, čaj, nealko pivo)"],
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

Odpovedz IBA jedným JSON objektom, kde kľúč je číslo produktu a hodnota je objekt s typom (t) a kategóriou (c), napr. {"1":{"t":"biscuit","c":"sweets"},"2":{"t":"fruit","c":"fruitveg"}}. Žiadny ďalší text.`;

export const keyOf = (deal) => `${deal.n ?? ""} | ${deal.d ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();

async function askClaude(apiKey, items) {
  const list = items.map((it, i) => `${i + 1}. ${it.deal.n}${it.deal.d ? " | " + it.deal.d : ""}`).join("\n");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: list }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      const text = body.content?.map((c) => c.text ?? "").join("") ?? "";
      const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      return json;
    } catch (err) {
      console.error(`[classify] pokus ${attempt} zlyhal: ${err.message}`);
    }
  }
  return null;
}

/** Načíta pamäť AI kategórií (kľúč názvu -> id kategórie). */
export async function loadCategoryCache(DATA) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, "category_cache.json"), "utf8"));
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
  const catPath = path.join(DATA, "category_cache.json");
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {}
  const catCache = await loadCategoryCache(DATA);

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
      if (deal.t && catCache[key]) continue;
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push({ deal, entry });
    }
  }

  // 2. nové názvy pošleme AI po dávkach
  const keys = [...pending.keys()];
  let asked = 0;
  let askedCategories = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH).map((k) => ({ key: k, deal: pending.get(k)[0].deal }));
    const answer = await askClaude(apiKey, chunk);
    if (!answer) continue;
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
      for (const { deal, entry } of pending.get(it.key)) {
        if (!deal.t && cache[it.key]) {
          deal.t = cache[it.key];
          entry.touched = true;
        }
        if (catCache[it.key] && deal.c !== catCache[it.key]) {
          deal.c = catCache[it.key];
          entry.touched = true;
        }
      }
    });
  }
  if (keys.length) console.log(`[classify] názvy na zaradenie: ${keys.length}, typy od AI: ${asked}, kategórie od AI: ${askedCategories}`);

  // 3. uložíme
  let changed = false;
  for (const f of files) {
    if (!f.touched) continue;
    await fs.writeFile(f.file, JSON.stringify(f.data), "utf8");
    changed = true;
  }
  if (asked) {
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 0), "utf8");
    changed = true;
  }
  if (askedCategories) {
    await fs.writeFile(catPath, JSON.stringify(catCache, null, 0), "utf8");
    changed = true;
  }
  return changed;
}
