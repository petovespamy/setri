// Zoznam obchodov, ktoré program sleduje. Nový obchod: pridaj súbor stores/<id>.mjs a sem jeden riadok.
import billa from "./billa.mjs";
import kaufland from "./kaufland.mjs";
import lidl from "./lidl.mjs";
import tesco from "./tesco.mjs";
import coop from "./coop.mjs";
import kraj from "./kraj.mjs";
import drogerie101 from "./drogerie101.mjs";
import yeme from "./yeme.mjs";

export const stores = [billa, kaufland, lidl, tesco, coop, kraj, drogerie101, yeme];
