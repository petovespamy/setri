// Čítanie PDF letáku 101 drogerie. Rozloženie: mriežka 3 stĺpcov. Text produktu (písmo 8: značka, druh, balenie)
// je hore v bunke, cena je dole: celé číslo (písmo 22) + desatinné (písmo ~12.8), vedľa nej pôvodná cena
// (písmo 8) a nad ňou "-NN%".
import { guessCategory } from "./parseFlyer.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
const UNIT_PRICE = /€\s*\/\s*1\s*(l|kg|ks|g|m|ml)\b/i;
const UNIT = /\b\d+(?:[.,]\d+)?\s?(?:ml|g|kg|l|ks|cl|m|ml)\b/i;

const titleFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function parsePage(raw) {
  const seen = new Set();
  const items = raw.filter((i) => {
    const k = `${i.s}|${i.x}|${i.y}|${i.fs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ints = items.filter((i) => /^\d{1,2}$/.test(i.s) && i.fs >= 20);
  const out = [];
  for (const a of ints) {
    const dec = items.find(
      (i) => /^\d{2}$/.test(i.s) && i.fs >= 10 && i.fs < 18 && i.x - a.x >= 6 && i.x - a.x <= 24 && i.y - a.y >= -14 && i.y - a.y <= 2
    );
    if (!dec) continue;
    const price = Number(`${a.s}.${dec.s}`);

    // text produktu: stĺpec je určený najbližším začiatkom textu naľavo od ceny
    const win = items.filter((i) => i.fs >= 7.4 && i.fs <= 8.6 && i.y >= a.y - 170 && i.y <= a.y - 60 && i.x <= a.x + 2 && i.x >= a.x - 48);
    if (!win.length) continue;
    const colX = Math.max(...win.map((i) => i.x));
    const lines = win.filter((i) => Math.abs(i.x - colX) <= 2).sort((p, q) => p.y - q.y);

    const old = items
      .filter((i) => /^\d{1,3},\d{2}$/.test(i.s) && i.fs >= 7 && i.fs <= 9 && i.x - a.x >= -2 && i.x - a.x <= 36 && i.y - a.y >= -6 && i.y - a.y <= 20)
      .map((i) => Number(i.s.replace(",", ".")))
      .find((v) => v > price);
    const disc = items.find((i) => /^-\s?\d{1,2}\s?%$/.test(i.s) && i.x - a.x >= -22 && i.x - a.x <= 38 && i.y - a.y >= -50 && i.y - a.y <= -4);

    const raw = clean(
      lines
        .map((l) => l.s)
        .filter((s) => !UNIT_PRICE.test(s))
        .join(" ")
        .replace(/\d[\d, ]*\s?€\s?\/\s?1\s?\p{L}+/gu, "")   // "0,170 €/1 PD"
        .replace(/\d[\d, ]*\s?\/\s?1\s?(l|kg|ks)\b/gi, "")   // "11,987 /1 l"
        .replace(/\s\*/g, "")
    );
    out.push({ raw, price, old: old ?? null, disc: disc ? Math.abs(parseInt(disc.s.replace(/\D/g, ""), 10)) : null });
  }
  return out;
}

function splitNameDetail(raw) {
  const m = raw.match(UNIT);
  if (m && m.index > 2) {
    // názov = všetko pred prvým údajom o balení; sprchovací gél 1 l -> názov "sprchovací gél", detail "1 l"
    return { name: raw.slice(0, m.index).trim(), detail: raw.slice(m.index).trim() };
  }
  return { name: raw, detail: "" };
}

/** Strany z PDF -> zľavy v tvare, ktorý číta appka. */
export function parseDrogerie(pages) {
  const byKey = new Map();
  for (const pg of pages) {
    for (const r of parsePage(pg.items)) {
      const { name: rawName, detail } = splitNameDetail(r.raw);
      const name = titleFirst(rawName.replace(/\s+/g, " "));
      if (name.length < 4 || !(r.price > 0) || /€|^\d|pranie\b/i.test(name)) continue;
      const category = guessCategory(`${name} ${detail}`);
      const deal = { n: name.slice(0, 60), p: r.price };
      if (detail) deal.d = detail.slice(0, 70);
      if (r.old && r.old > r.price) deal.o = r.old;
      const disc = r.disc || (r.old && r.old > r.price ? Math.round((1 - r.price / r.old) * 100) : null);
      if (disc) deal.x = disc;
      if (category) deal.c = category;
      const key = `${name}|${detail}`;
      const prev = byKey.get(key);
      if (!prev || deal.p < prev.p) byKey.set(key, deal);
    }
  }
  return [...byKey.values()];
}

/** Platnosť z prvej strany: "Platí od stredy 21. 10." + "do utorka 3. 11. 2026". */
export function drogerieValidity(pages) {
  const text = (pages[0]?.items ?? []).map((i) => i.s).join(" ");
  const to = text.match(/do\s+\p{L}+\s+(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/u);
  const from = text.match(/od\s+\p{L}+\s+(\d{1,2})\.\s?(\d{1,2})\./u);
  if (!to || !from) return null;
  const p = (n) => String(n).padStart(2, "0");
  const year = Number(to[3]);
  const fromYear = Number(from[2]) > Number(to[2]) ? year - 1 : year;
  return { validFrom: `${fromYear}-${p(from[2])}-${p(from[1])}`, validTo: `${year}-${p(to[2])}-${p(to[1])}` };
}
