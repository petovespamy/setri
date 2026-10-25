// Teta drogérie: akcie (letak=true) sú priamo v HTML e-shopu, bez PDF. Berieme ich každý deň nanovo,
// platnosť nastavíme na pár dní dopredu (keby jeden deň zlyhalo sťahovanie).
import { crawlTeta } from "../tetaParser.mjs";
import { guessCategory } from "../parseFlyer.mjs";

const pad = (n) => String(n).padStart(2, "0");
const UNIT = /\s(\d+(?:[.,]\d+)?(?:x\d+)?\s?(?:ml|g|kg|l|ks|cl|m)\b.*)$/i;

function bratislavaToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bratislava" });
}
function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const fmt = (n) => n.toFixed(2).replace(".", ",");

export default {
  id: "teta",
  name: "Teta",

  async fetchLeaflets() {
    const products = await crawlTeta();
    const today = bratislavaToday();
    const deals = products
      .filter((p) => p.price > 0)
      .map((p) => {
        const m = p.name.match(UNIT);
        const name = (m && m.index > 3 ? p.name.slice(0, m.index) : p.name).trim();
        const parts = [];
        if (m && m.index > 3) parts.push(m[1].trim());
        if (p.club && p.club < p.price) parts.push(`Teta klub ${fmt(p.club)} €${p.clubNote ? ` (${p.clubNote.replace(/^\*/, "")})` : ""}`);
        if (p.onlineOnly) parts.push("iba online");
        const deal = { n: name.slice(0, 60), p: p.price };
        const detail = parts.join(", ");
        if (detail) deal.d = detail.slice(0, 70);
        if (p.old && p.old > p.price) {
          deal.o = p.old;
          deal.x = Math.round((1 - p.price / p.old) * 100);
        }
        const category = guessCategory(p.name);
        if (category) deal.c = category;
        return deal;
      });
    return [
      {
        source: `https://www.tetadrogerie.sk/produkty/?letak=true#${today}`,
        validFrom: today,
        validTo: addDays(today, 2),
        deals,
      },
    ];
  },
};
