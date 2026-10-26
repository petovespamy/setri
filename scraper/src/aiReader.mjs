// AI čítanie letákov: strany PDF sa premenia na obrázky a Claude z nich vypíše zľavy.
// Použitie: readFlyerWithAI(pdfBuffer) -> { deals, usage, pages, failedPages }, toAppDeals(deals) -> zľavy v tvare pre appku.
// Potrebuje ANTHROPIC_API_KEY a nainštalovaný `pdftoppm` (balík poppler-utils).
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { guessCategory } from "./categorize.mjs";

export const AI_READ_MODEL = process.env.AI_READ_MODEL || process.env.AI_TEST_MODEL || "claude-sonnet-5-5";

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
- Ak sú pri produkte dve ceny (napr. "cena za 1 ks pri kúpe 2 ks" a "cena za 1 ks pri kúpe 1 ks"), vypíš ako price tú akciovú a do condition napíš podmienku.
- Cena "za 1 kg" alebo "za 100 g" je cena produktu; jednotku uveď v detail (napr. "cena za 1 kg").
- Nič nehádaj ani nepočítaj. Čo na obrázku nevidíš, daj null. Nevynechávaj zľavy a nevymýšľaj nové.
- Ak ide o titulnú stranu alebo stranu bez zliav, vráť prázdne pole.
Odpovedz IBA JSON poľom objektov, žiadny ďalší text.`;

async function readPage(apiKey, jpegBase64, model) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          system: SYSTEM,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
              { type: "text", text: "Vypíš zľavy z tejto strany letáku." },
            ],
          }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      const text = body.content?.map((c) => c.text ?? "").join("") ?? "";
      const deals = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      return { deals, usage: body.usage ?? {} };
    } catch (err) {
      console.error(`  [ai] pokus ${attempt} zlyhal: ${err.message}`);
    }
  }
  return null;
}

/** Prečíta celé PDF. Vráti surové zľavy z AI (s číslom strany), spotrebu tokenov a počet zlyhaných strán. */
export async function readFlyerWithAI(pdfBuffer, { apiKey = process.env.ANTHROPIC_API_KEY, model = AI_READ_MODEL, maxPages = 200 } = {}) {
  if (!apiKey) throw new Error("Chýba ANTHROPIC_API_KEY.");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-read-"));
  try {
    const pdfPath = path.join(tmp, "flyer.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);
    execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-scale-to", "1568", pdfPath, path.join(tmp, "p")]);
    const files = (await fs.readdir(tmp)).filter((f) => f.startsWith("p") && f.endsWith(".jpg")).sort().slice(0, maxPages);

    const deals = [];
    const usage = { input: 0, output: 0 };
    let failedPages = 0;
    for (const [i, f] of files.entries()) {
      const out = await readPage(apiKey, (await fs.readFile(path.join(tmp, f))).toString("base64"), model);
      if (!out) { failedPages++; continue; }
      usage.input += out.usage.input_tokens ?? 0;
      usage.output += out.usage.output_tokens ?? 0;
      for (const d of out.deals) deals.push({ ...d, page: i + 1 });
      console.log(`  [ai] strana ${i + 1}/${files.length}: ${out.deals.length} zliav`);
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
