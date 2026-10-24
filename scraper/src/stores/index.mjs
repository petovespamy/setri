// Zoznam obchodov, ktoré program sleduje. Nový obchod: pridaj súbor stores/<id>.mjs a sem jeden riadok.
import billa from "./billa.mjs";
import kaufland from "./kaufland.mjs";

export const stores = [billa, kaufland];
