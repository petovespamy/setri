// AI zaradenie zliav do typov produktov (sušienky, citróny, psie granule…).
// Claude prečíta CELÝ názov produktu, nielen jednotlivé slová, a vyberie typ zo zoznamu v productTypes.mjs.
// Výsledok sa uloží ku každej zľave ako "t" a do data/type_cache.json, takže sa každý názov posiela AI len raz.
// Ak nie je nastavený ANTHROPIC_API_KEY, preskočí sa (appka vtedy použije svoje slovné pravidlá).
import fs from "node:fs/promises";
import path from "node:path";
import { PRODUCT_TYPES } from "./productTypes.mjs";

const MODEL = process.env.CLASSIFY_MODEL || "claude-haiku-5-5";
const BATCH = 60;
const VALID = new Set([...PRODUCT_TYPES.map((t) => t.id), "other"]);

const SYSTEM = `Si expert na slovenské obchody a ich letáky. Dostaneš číslovaný zoznam produktov z letákov (názov | podrobnosť).
Pre každý produkt urči, ČO TO CELÉ JE, a vyber práve jeden typ zo zoznamu.

Pravidlá:
- Rozhoduj podľa celého názvu a podľa toho, čo produkt reálne je. Príchuť alebo prísada nie je typ: "Citrónové sušienky" sú sušienky, "Čokoládový jogurt" je jogurt, "Pes granule" sú krmivo.
- Značka (aj privátna: Clever, K-Classic, Tesco, Pilos…) ti pomáha, ale sama typ neurčuje.
- Ak nič zo zoznamu nesedí, použi "other".

Typy (id – názov – nadkategória):
${PRODUCT_TYPES.map((t) => `${t.id} – ${t.label} – ${t.parent}`).join("\n")}
other – nič z uvedeného

Odpovedz IBA jedným JSON objektom, kde kľúč je číslo produktu a hodnota je id typu, napr. {"1":"biscuit","2":"fruit"}. Žiadny ďalší text.`;

const keyOf = (deal) => `${deal.n ?? ""} | ${deal.d ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();

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

/** Doplní "t" ku zľavám, ktoré ho ešte nemajú. Vráti true, ak sa nejaký súbor zmenil. */
export async function classifyAll(index, DATA, only) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[classify] preskakujem (chýba ANTHROPIC_API_KEY)");
    return false;
  }
  const cachePath = path.join(DATA, "type_cache.json");
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {}

  // 1. načítame letáky a doplníme z pamäte
  const files = [];
  const pending = new Map(); // kľúč -> [deal, deal…]
  for (const l of index.leaflets) {
    if (only && l.store !== only) continue;
    const file = path.join(DATA, l.file);
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    files.push({ file, data, touched: false });
    for (const deal of data.deals ?? []) {
      if (deal.t) continue;
      const key = keyOf(deal);
      if (cache[key]) {
        deal.t = cache[key];
        files.at(-1).touched = true;
      } else {
        if (!pending.has(key)) pending.set(key, []);
        pending.get(key).push({ deal, entry: files.at(-1) });
      }
    }
  }

  // 2. nové názvy pošleme AI po dávkach
  const keys = [...pending.keys()];
  let asked = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH).map((k) => ({ key: k, deal: pending.get(k)[0].deal }));
    const answer = await askClaude(apiKey, chunk);
    if (!answer) continue;
    chunk.forEach((it, idx) => {
      let t = answer[String(idx + 1)];
      if (!VALID.has(t)) return;
      cache[it.key] = t;
      asked++;
      for (const { deal, entry } of pending.get(it.key)) {
        deal.t = t;
        entry.touched = true;
      }
    });
  }
  if (keys.length) console.log(`[classify] nové názvy: ${keys.length}, zaradených AI: ${asked}`);

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
  return changed;
}
