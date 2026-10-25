// Billa: aktuálny a budúci leták sú na stránke billa.sk ako PDF (Publitas).
// Budúci leták sa na stránke objaví pár dní pred začiatkom platnosti.

const PAGES = [
  "https://www.billa.sk/letaky-a-akcie/letaky",
  "https://www.billa.sk/letaky-a-akcie%2Fletaky?tab=letaky-a-akcie/buduci-letak",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function getHtml(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, "accept-language": "sk-SK,sk;q=0.9" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const raw = await res.text();
  // Stránka ukladá dáta ako JSON, takže znaky sú zakódované (/, <, &).
  return raw.replace(/\\u002F/gi, "/").replace(/\\u003C/gi, "<").replace(/\\u003E/gi, ">").replace(/\\u0026/gi, "&");
}

export default {
  id: "billa",
  name: "Billa",

  /** Vráti zoznam letákov, ktoré sú práve na stránke: [{ pdfUrl, validFrom?, validTo? }]. */
  async discover() {
    const found = new Map();
    for (const url of PAGES) {
      let html;
      try {
        html = await getHtml(url);
      } catch (err) {
        console.warn(`  [billa] ${err.message}`);
        continue;
      }
      const pdfs = [...new Set([...html.matchAll(/https:\/\/view\.publitas\.com\/[^"'\s<>\\]+?\.pdf[^"'\s<>\\]*/g)].map((m) => m[0]))];
      if (!pdfs.length) continue;

      // Dátumy zo stránky použijeme len ako nápovedu (hlavný zdroj je text v PDF).
      const hint = html.match(
        /Akciov[áa] ponuka plat[íi] od\s+(\d{1,2})\.\s*(\d{1,2})\.\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i
      );
      for (const pdfUrl of pdfs) {
        const entry = { pdfUrl };
        if (hint && pdfs.length === 1) {
          const p = (n) => String(n).padStart(2, "0");
          entry.validFrom = `${hint[5]}-${p(hint[2])}-${p(hint[1])}`;
          entry.validTo = `${hint[5]}-${p(hint[4])}-${p(hint[3])}`;
        }
        const key = pdfUrl.split("?")[0];
        if (!found.has(key)) found.set(key, entry);
      }
    }
    return [...found.values()];
  },
};
