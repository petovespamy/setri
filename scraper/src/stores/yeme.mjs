// YEME: akcie ("Hrdinovia") sú priamo na stránke e-shopu, bez PDF letáku. Berieme ich každý deň nanovo,
// platnosť nastavíme na pár dní dopredu (keby jeden deň zlyhalo sťahovanie).
import { crawlHeroes } from "../yemeParser.mjs";
import { guessCategory } from "../parseFlyer.mjs";

const pad = (n) => String(n).padStart(2, "0");

function bratislavaToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bratislava" }); // YYYY-MM-DD
}
function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const titleFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function unitText(unit) {
  const u = unit.replace(/\s+/g, "");
  if (!u) return "";
  if (/^(ks|kg|l)$/i.test(u)) return `1 ${u}`;
  return u.replace(/^(\d+)(g|ml|kg|l)$/i, "$1 $2");
}

export default {
  id: "yeme",
  name: "YEME",

  async fetchLeaflets() {
    const products = await crawlHeroes();
    const today = bratislavaToday();
    const deals = products
      .filter((p) => p.price > 0)
      .map((p) => {
        const name = titleFirst(p.title);
        const deal = { n: name.slice(0, 60), p: p.price };
        const detail = [unitText(p.unit), p.supplier].filter(Boolean).join(", ");
        if (detail) deal.d = detail.slice(0, 70);
        if (p.old && p.old > p.price) {
          deal.o = p.old;
          deal.x = Math.round((1 - p.price / p.old) * 100);
        }
        const category = guessCategory(`${name} ${detail}`);
        if (category) deal.c = category;
        return deal;
      });
    return [
      {
        source: `https://www.yeme.sk/hrdinovia#${today}`,
        validFrom: today,
        validTo: addDays(today, 2),
        deals,
      },
    ];
  },
};
