// Zaraďovanie produktov do kategórií podľa názvu (spoločné pre všetky obchody).
//
// Pravidlá sa skúšajú ODSHORA NADOL a vyhráva prvé, ktoré sedí. Preto platí:
//   1. najprv výnimky a špecifické veci (sviečky, čistiace prostriedky, krmivo…),
//   2. potom potraviny od najšpecifickejších po najvšeobecnejšie.
// Každé slovo sa hľadá od začiatku slova (nie uprostred) a "$w" znamená "tu slovo končí".
// Vďaka tomu "sviečka" nesedí na "sviečková" (hovädzie mäso) ani "krém" na "krémová polievka".

const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

const rule = (id, src) => [id, new RegExp(`${START}(?:${src.replaceAll("$w", END)})`, "iu")];

export const CATEGORY_RULES = [
  // ───────── výnimky, ktoré by inak zapadli do zlej kategórie ─────────
  rule("fruitveg", "rybíz"),
  rule("pantry", "(?:arašidov|mandľov|orieškov|lieskovoorieškov)\\p{L}*\\s+(?:masl|krém)|džem|marmelád|zaváran|kompót|lekvár"),
  rule("drinks", "bezalkohol|nealkohol|vitamín\\p{L}*\\s+(?:nápoj|sirup)|vitamíny\\s+(?:nápoj|sirup)|multivitamín\\p{L}*\\s+nápoj|birell"),
  rule("fruitveg", "halloween\\s+tekvic|tekvic\\p{L}*\\s+(?:halloween|maslov|hokkaido|špagetov)"),
  rule("seasonal", "tekvic\\p{L}*\\s+ozdobn|ozdobn\\p{L}*\\s+tekvic|vyrezáv"),
  rule("frozen", "zmrzlin|nanuk|ice\\s+cream|sorbet|viennetta"),
  rule("sweets", "lízank|vankúšik|toffifee|merci$w|mon\\s+cheri|ferrero"),
  rule("nonfood", "kozmetick\\p{L}*\\s+tašk"),
  rule("fruitveg", "(?:bio\\s+)?(?:bazalk|koriander|ligurček|mäta|mäty|pažítk|petržlen|tymián|rozmarín|oregano|šalvia|medovk|jedl\\p{L}*\\s+kvet)"),
  rule("drugstore", "corega|ušné|ušn(?:ý|é)|zubn\\p{L}*|medzizubn|ústn\\p{L}*\\s+vod|vlhčen\\p{L}*\\s+(?:toaletn|utierk|obrúsk)|kozmetick\\p{L}*\\s+(?:utierk|vreckovk)|papierov\\p{L}*\\s+vreckovk|vreckovk"),

  // ───────── sezónne veci a dekorácie ─────────
  rule(
    "seasonal",
    [
      "sviečk(?:a|y|u|e|ou|ám|ami|ách)?$w", // nie "sviečková" (hovädzie)
      "sviec$w|sviece$w|kahan(?:ec|ce|ca|cov|cu|ci)?$w|kahanc\\p{L}*",
      "svietnik|lampión|lucern|aromalamp|difuz[ée]r|vonn\\p{L}*\\s+(?:vosk|sviec)|vosk\\p{L}*\\s+(?:sviec|tavn)",
      "náhrob|hrobov|hrob$w|dušičk|zádušn|pietn",
      "vianočn\\p{L}*\\s+(?:ozdob|stromček|svetl|svetel|dekor|výzdob|osvetlen|reťaz|guľ|veniec|hviezd|zvonč|kalendár|obal|taška|papier|pohľadnic|škatuľ|trh)",
      "adventn\\p{L}*\\s+(?:veniec|kalendár|svietnik)",
      "veľkonočn\\p{L}*\\s+(?:dekor|ozdob|výzdob|košík|kraslic|vajíč\\p{L}*\\s+dekor)",
      "veniec|venček|vence$w|stromček|stromčeky|ozdob(?:y|a|u|ách|ami)$w|dekorác|dekoratív|girland|výzdob|kraslic",
      "darčekov\\p{L}*\\s+(?:taška|tašky|papier|obal|krabic|stuha|stužk)|balic\\p{L}*\\s+papier|baliaci\\s+papier",
      "pyrotechn|petard|ohňostroj|prskavk|bengálsk|rímsk\\p{L}*\\s+sviec",
      "kvetin|kvetináč|chryzantém|orchide|tulipán|narcis|hyacint|vres$w|vresy|ruž(?:a|e|u)$w|izbov\\p{L}*\\s+rastlin|rastlin(?:a|y|u|ách)$w|zemin(?:a|y|u)?$w|substrát|hnojiv|záhradn|semen(?:á|a|o)$w|umelé?\\s+kvet|črepníkov|lampáš",
    ].join("|")
  ),

  // ───────── domáce zvieratá ─────────
  rule(
    "pets",
    "pre\\s+(?:psov|psy|mačky|mačk|psa|mačku|zvierat|vtáky|hlodavc|rybičk)|granul(?:y|e|á)?$w|krmiv|kŕmn|whiskas|pedigree|sheba|purina|brit$w|trixie|kitekat|chappi|stelivo|dreamies|propesko|maškrty\\s+pre|felix\\s+(?:mačk|fantastic|pre)"
  ),

  // ───────── domácnosť: čistenie, pranie, papier, odpad ─────────
  rule(
    "household",
    [
      "prací\\p{L}*|prac(?:ie|í|ia)\\s+(?:gél|gel|prášok|kapsul|tablet|prostriedok|dávk)|pran[íi]e?$w|praní$w|pracích",
      "aviváž|avivaz|perwoll|coccolino|lenor|silan|woolite|vanish|calgon",
      "čistiac\\p{L}*|čistič\\p{L}*|čistí$w|odmasťovač|odstraňovač|dezinfek\\p{L}*|osviežovač\\p{L}*|odpudzovač|insekticíd|pasca\\s+na|hmyz",
      "toaletn(?:ý|ého|ému|om|ým)\\s+papier|toaletný|wc$w|wc\\s+(?:blok|záves|gél|čist)",
      "utierk\\p{L}*|obrúsk\\p{L}*|papierov\\p{L}*\\s+(?:utierk|obrúsk)|kuchynsk\\p{L}*\\s+(?:utierk|papier)",
      "savo$w|persil|ariel|jar$w|fairy|domestos|mr\\.?\\s*proper|ajax|cif$w|finish|somat|bref|sidolux|pronto|sanytol|perex",
      "prášok\\s+do|tablety\\s+(?:do|na)|umývačk|na\\s+riad$w|na\\s+umývanie|na\\s+okná|na\\s+podlah",
      "(?:vrecia|vrecká|sáčky|vrecko)\\s+(?:na|do)\\s+(?:odpad|smeti|kôš|koš|zmrazen|vysáv|potrav)",
      "alobal|alu\\s*fóli|potravinov\\p{L}*\\s+fóli|priľnav\\p{L}*\\s+fóli|pergamen|papier\\s+na\\s+pečen|papier\\s+na\\s+pečeni",
      "špongi|hubk|handr|mop$w|metl|vedro|zmeták|vysávač\\p{L}*\\s+(?:sáčk|vrec)|gumen\\p{L}*\\s+rukav|zápalk|zapaľovač|žiarovk|batéri|monočlánk|tužkov",
      "zmäkčovač|odvápňovač|soľ\\s+do\\s+umývačk|leštidl|osviežova|frosch|briochin|ceresit|aditív|benzín|vlhkosti",
    ].join("|")
  ),

  // ───────── drogéria: hygiena, kozmetika, zdravie ─────────
  rule(
    "drugstore",
    [
      "šampón|šampon|kondicionér|balzam\\s+na\\s+(?:vlasy|fúzy|pery)|maska\\s+na\\s+(?:vlasy|tvár)",
      "sprchov\\p{L}*|pena\\s+do\\s+kúpeľa|kúpeľov",
      "colgate|sensodyne|parodontax|elmex|oral-b|bieliac\\p{L}*\\s+(?:pero|sérum|prúžk)|zubn\\p{L}*|medzizubn|ústn\\p{L}*\\s+vod|corega|fixačn\\p{L}*\\s+krém|blend-a-dent|sudocrem",
      "dezodorant|antiperspirant|deodorant",
      "krém\\s+(?:na|pre|proti|po|pod)\\s|osviežujúc\\p{L}*\\s+krém|nivea|garnier|indulona|astrid|dove$w|pleť\\p{L}*|pleťov|telov\\p{L}*|na\\s+ruky|na\\s+tvár",
      "mydlo|mydl\\p{L}*",
      "tampón|vložky|hygienick\\p{L}*|dámska\\s+hygiena|intímn|inkontinen",
      "vreckovk|kozmetick\\p{L}*|vlhčen\\p{L}*\\s+(?:utierk|obrúsk)|toaletn\\p{L}*\\s+vod|kolínska|parfum|toaletná\\s+voda",
      "holiac\\p{L}*|žiletk|holen|strojček|náhradn\\p{L}*\\s+hlavic|po\\s+holení|pred\\s+holením",
      "vlasov\\p{L}*|lak\\s+na\\s+(?:vlasy|nechty)|farba\\s+na\\s+vlasy|púder|make-?up|mascara|riasenk|rúž$w|očné\\s+tiene|odlíčovač|lakový",
      "vata|vatov|vatové|tyčinky\\s+do\\s+uší|náplast|obväz",
      "vitamíny$w|vitamín\\s+[a-ek]$w|doplnok\\s+stravy|výživov\\p{L}*\\s+doplnok|ušné|nosové|kvapky|sprej\\s+na\\s+hrdlo|pastilky|multivitamín|horčík|kalcium|omega",
      "antibakteriál|dezinfek",
    ].join("|")
  ),

  // ───────── deti a bábätká ─────────
  rule(
    "baby",
    "plienk|plienkov|bábät|dojčen|príkrm|pampers|huggies|sunar|hipp$w|nutrilon|bebivita|nutramigen|detsk\\p{L}*\\s+(?:výživ|kaš|mlie|hygien|plienk|cereál|mokr|krém|olej|púder)|kojen|dudlík|fľaš\\p{L}*\\s+(?:dojčen|kojen)|babysmilk|ovocn\\p{L}*\\s+kapsičk|kapsičk\\p{L}*\\s+ovoc|ovko|mliečn\\p{L}*\\s+výživ"
  ),

  // ───────── ostatný tovar (textil, náradie, elektro, hračky, riad) ─────────
  rule(
    "nonfood",
    [
      "hračk|stavebnic|puzzle|lego|bábik|plyšov|stolov\\p{L}*\\s+hra|spoločensk\\p{L}*\\s+hra|kočík|bicykel|kolobežk|lopt(?:a|y|u)$w|športov|stan$w|spací\\s+vak",
      "oblečen|tričk|bunda|bundy|nohavic|tepláky|mikina|sveter|šaty|pyžam|bielizeň|spodn\\p{L}*\\s+prád|plavk|čiapk|šál$w|ponožk|pančuch|rukavic|topánk|papuč|čižm|tenisk",
      "uterák|osušk|posteľn|obliečk|plachta|vankúš(?:e|ov|om|mi)?$w|paplón|prikrývk|deka$w|deky$w|záves|koberec|rohož",
      "vŕtačk|skrutkovač|kladivo|píl(?:a|y|u)$w|náradie|akumulát|brúsk|rebrík|kosačk|trimmer|vysokotlak|hadica|polievač|aku$w",
      "kávovar|mixér|toastovač|vysávač|žehlič|rýchlovarn|varn\\p{L}*\\s+kanvic|ventilátor|ohrievač|sušič|fén$w|zastrihávač|slúchadl|reproduktor|telefón|notebook|televíz|monitor|kábel|nabíjač|powerbank|hodinky|budík|váha$w|váhy$w|lampa$w|lampy$w|svietidl|led\\s+(?:pás|svetl|žiarov)",
      "hrniec|hrnce|hrnček|hrnčeky|panvic|riad(?:y|u|om)$w|taniere?|príbor|nôž$w|nože$w|doska\\s+na|kuchynsk\\p{L}*\\s+(?:doska|náradie|riad|váha|robot)|termosk|fľaš\\p{L}*\\s+(?:na|termo)|krabič\\p{L}*\\s+na\\s+(?:jedlo|obed|desiat)|pokrievk|cedidl|strúhadl|pekáč|formy?\\s+na",
      "batoh|kufor|cestovn\\p{L}*\\s+(?:taška|kufor)|dáždnik|školsk|zošit|peračník|aktovk|pastelk|farbičk|perá$w|pero$w|papiernict|kancelár",
      "kozmetick\\p{L}*\\s+tašk|taška$w|tašky$w|parkside|crivit|livarno|livergy|silvercrest|ernesto|esmara|lupilu|brikety|kukla",
    ].join("|")
  ),

  // ───────── alkohol ─────────
  rule(
    "alcohol",
    "pivo|piva$w|pivn|pilsner|plzeň|kozel|zlatý\\s+bažant|šariš|corgoň|heineken|staropramen|budvar|radegast|krušovic|krombacher|lager|víno|vína$w|vín$w|vodka|vodky|whisk\\p{L}*|rum$w|rumu$w|likér\\p{L}*|becherovka|gin$w|prosecco|šumivé\\s+víno|sekt|champagne|brandy|borovič|slivovic|guinness|radler|koňak|vermut|aperol|cider|pálenk|tatratea|fernet|jägermeister|medovin|destilát|tequila|bourbon|absint|burčiak|žitná|gambrinus|smädný\\s+mních|topvar|hubert|pergola|túžba|virex|moletto|sklepy|vinárstv|rizling|rulandsk|tramín|pálava|veltlín|frizzante|rosato|cabernet|merlot|primitivo|sauvignon|chardonnay|blanc$w|rýnsky|frankovka|portugal|château|chateau|liehovin|um\\s+40|tuzemsk|alk\\.|bobuľov\\p{L}*\\s+výber|ríbezľov\\p{L}*\\s+víno|nicolaus|svätovavrinec|laurent|medovin|nilio|hedonya|winery|tokaj|ostrožovič|extra\\s+brut|brut$w|negroamaro|alibernet|leánka|müštik|muštík|pinot|noir$w"
  ),

  // ───────── mrazené ─────────
  rule("frozen", "zmrzlin|mrazen|nanuk|zmrzk|mrazič|ice\\s+cream|sorbet|viennetta|mccain|hranolč|hranolk|churros|nanuk|lahodn\\p{L}*\\s+krém|\\p{L}*zmrazen"),

  // ───────── trvanlivé špeciality, ktoré by sa inak chytili na ovocie/mäso ─────────
  rule(
    "pantry",
    "konzerv|kečup|pretlak|passata|pelati|sterilizovan|nakladan|kyslá\\s+kapusta|v\\s+(?:náleve|oleji|vlastnej\\s+šťave)|tuniak|sardink|makrel|olivy|olív|oliv|kapary|horčic|majonéz|tatárska|dresing|dresink"
  ),

  // ───────── hotové jedlá, ktoré by sa chytili na pečivo/údeniny ─────────
  rule("ready", "pizza|pinsa|sendvič|wrap$w|wraps|lasagn|knedľ|knedl|polievk"),

  // ───────── pečivo ─────────
  rule(
    "bakery",
    "bageta|bagetka|bagety|chlieb|chleb\\p{L}*|rožok|rožky|pečivo|pečiv|croissant|dalamán|koláč|buchta|buchty|vianočk|šiška|šišky|slimák|mriežka|žemľ|žemle|toast|rolád|makovník|záv(?:in|ij)|štrúdľ|pagáč|lángoš|veka$w|bábovk|tort(?:a|y|u|ičk)|donut|muffin|palacink|lievanc|perník|medovník|tortilla|pita$w|focaccia|ciabatta|obložen|kaiserk|kaizerk|pletenk|baguette|tortill|toust|grissin|sucháry|makovk"
  ),

  // ───────── mäso a ryby ─────────
  rule(
    "meat",
    "kurča|kurčat|kuracie|kurací|kuriat|bravčov|hovädz|ryb(?:a|y|ie|í|ách|ou|u)?$w|rybí|losos|kapor|steak|krkovič|stehn|rezne|rezeň|mäso|mäsov|pstruh|morčac|krevety|panenk|držky|treska|filé|filet|karbonát|kačic|kačk|husac|hus$w|jahňac|králi|bôčik|rebrá|rebierka|sviečkov|plece|pliecko|karé|oškvark|vývar|kačaci|prsia|sliepk|hydinov|burger|zabíjačk|mangalic|wagyu"
  ),

  // ───────── údeniny a lahôdky ─────────
  rule(
    "deli",
    "šunk|saláma|salám|klobás|párky|párok|údený|údená|údené|údenin|pečienka|slanin|lahôd|tlačenk|špek|mortadel|prosciutto|paštét|uzeniny|sekaná|hurka|jaternic|huspenin|nárez|kabanos|hummus|cigáro|salame|spianata|pancetta|guanciale|coppa|prosciutto|antipasto|piacentin|bresaola|nduja|uherák"
  ),

  // ───────── mliečne výrobky a vajcia ─────────
  rule(
    "dairy",
    "mlieko|mlieka$w|mliek\\p{L}*|maslo$w|masla$w|masle$w|maslom|jogurt|syr(?:$w|y|a|u|om|ov|ový|ové|ová|ík|iky|ček)|tvaroh|syrokrém|smotan|vajc|parenic|eidam|cheddar|mozzarel|kefír|bryndz|termix|nátierk|mascarpone|žervé|skyr|puding|margarín|ricotta|parmezán|gouda|camembert|brie$w|hermelín|niva$w|feta$w|acidko|cmar|šľahačk|danone|activia|jogobella|müller|zott|rajo$w|cottage|philadelphia|leerdammer|lučina|blok$w|džiugas|alpro|sójov\\p{L}*\\s+(?:fermentov|jogurt)|pribináč|pareni|flora$w|rama$w|tehla|encián|žinčic|milkana|křup|tofu|manouri|hrudka|podpecník|ovčí|ovčia|kunín|dezert"
  ),

  // ───────── nápoje ─────────
  rule(
    "drinks",
    "nápoj|džús|jus$w|voda$w|vody$w|vodu$w|minerál|cola|limonád|sirup|energetick|kofola|nektár|čaj$w|čaje$w|čajov|čajové|ľadový|fanta|pepsi|sprite|mirinda|7up|red\\s*bull|monster|rauch|top\\s+topic|káva|kávy|kávu|kávové|kávovin|espresso|cappuccino|latte|smoothie|ice\\s+tea|ice\\s+coffee|mattoni|rajec|budiš|studienka|kombucha|tonic|sóda|soda$w|šťav|nealko|instantn\\p{L}*\\s+káv|zrnkov\\p{L}*\\s+káv|mlet\\p{L}*\\s+káv|protein\\s+drink|magnesia|oravská|hell$w|birell|happy\\s+day|relax$w|cappy|molecola|caffe|caffé|kávov|samahan|bubble\\s+tea|bonaqua|coca|pellegrino|rio\\s+up|vitamin\\s+well|zero$w|cold\\s+press|rio$w"
  ),

  // ───────── sladkosti a snacky ─────────
  rule(
    "sweets",
    "čokolád|cukrík|cukrovink|guľky|tyčink|keks|sušienk|oplátk|bonbón|chips|snack|žuvač|marcipán|praclík|arašid|sladkost|nutella|lupienky|popcorn|karamel|zmes\\s+orech|orieš|orech|mandle|kešu|pistác|lieskov|sušené\\s+ovocie|hrozienk|gumi|lízank|nugát|pralin|bonboniér|marshmallow|čipsy|raffaello|milka|kinder|haribo|orion|piškót|sladidl|slané\\s+(?:tyčink|pochutin)|cukrovin|oblát|horalk|fidorka|kexy|kexík|krek|trubičk|pusink|pom-?bär|lay.?s$w|pringles|chrumk|placky|želé|karička|črievk|brumík|bebe|slonia|nestlé\\s+mini|napoleonk|spekulatius|florentín|škoricov\\p{L}*\\s+hviezd|oreo|kit\\s*kat|kitkat|chupa|milky|chocolate|choco|čoko|bar$w|bary$w|sour\\s+busters|zvieratká|halloween|encián|tami$w|opavia|sedita|jojo|bits|lízank|excellence|lindor|čok\\.|cocoa|nuxor|nougat|tablet$w|powerlogy|lino\\s+lada|toffifee|merci$w"
  ),

  // ───────── hotové jedlá ─────────
  rule("ready", "hotov|pizza|pinsa|knedľ|knedl|halušk|polievk|sendvič|wrap|sushi|lasagn|rizot|pirohy|krokety|hranolky|šalát\\p{L}*\\s+(?:hotov|so\\s+)|nugget"),

  // ───────── ovocie a zelenina ─────────
  rule(
    "fruitveg",
    "banán|malin|jablk|hrozno|mandarín|citrón|gaštan|hurmik|zázvor|rajč|brokol|zemiak|cvikl|cibu|karfiol|karot|mrkv|cesnak|šampiň|hrib|tekvic|zelenin|ovoc|ovocn|uhork|paprik|kapust|šalát|avokád|pomaranč|hruš|broskyn|kiwi|ananás|slivky|slivy|špenát|zeler|bylink|petržlen|reďkov|kaleráb|fazuľk|hráš|baklažán|cuket|jahod|čučoried|ríbezl|marhuľ|čerešn|višn|melón|dyňa|dyne|grep|limet|mango|papája|datl|figy|granátov|kokos|pór$w|ružičk|kel$w|špargľ|artičok|chren|šalotk|hlávk|nektarínk|brusnic|egreš|hrušk|paradajk|pomelo|fig(?:a|y)$w|passion|maracuj|pitahaya|jackfruit|patizón|hub(?:y|a)$w|hliv|hríb|suchohríb|ringlot|černic|blumy|ríbezľ|cherry|grapefruit|mikro|microgreens|korálovec|chef\\s+mix|húb|húby"
  ),

  // ───────── trvanlivé potraviny (všeobecné) ─────────
  rule(
    "pantry",
    "olej|oleje|múka|múky|cestovin|špagety|ryž|rýž|cukor|soľ$w|med$w|cest(?:o|a)$w|strukov|vločk|kukuric|omáčk|ocot|instantn|müsli|cereáli|kakao|fazuľ|šošovic|cícer|korenie|korenin|škorica|vanilk|droždie|prášok\\s+do\\s+pečiva|zákvas|krupic|kuskus|bulgur|quinoa|ovsen|kaš(?:a|e|u)$w|knäckebrot|sucháry|strúhank|poleva|kondenzovan|ochucovadl|vegeta|bujón|polievkov\\p{L}*\\s+kocka|cini$w|granola|corn\\s+flakes|kellogg|cheerios|krupičk|pohánk|semienk|šprot|tresčia|fazul|niťovk|rezanc|makarón|tortell|ravioli|gnocchi|farbiv|aróm|wasabi|blue\\s+elephant|tom\\s+kha|kari$w|curry|maggi|príchuť|mäspoma|základ\\s+na\\s+varenie|dr\\.?\\s*oetker|spaghetti|linguine|tagliatelle|penne|fusilli|mafalde|bucatini|orecchiette|pappardelle|gramigna|paccheri|tortiglioni|papillons|busiate|fiocchetti|pici$w|morelli|fettuccin|rigatoni|farfalle|tempura|hrach|hrachor|kápia|feferón|lečo|cacao"
  ),

  // ───────── posledná záchrana: fľaša 0,7 – 0,75 l bez iného zaradenia je takmer iste víno alebo destilát ─────────
  rule("alcohol", "0[,.]7[05]?\\s*l$w"),
];

/** Odhadne kategóriu produktu podľa slov v názve (spoločné pre viac obchodov). */
export function guessCategory(text) {
  const key = String(text ?? "").toLowerCase();
  for (const [id, re] of CATEGORY_RULES) if (re.test(key)) return id;
  return undefined;
}

/** Kategórie, ktorým veríme viac ako členeniu obchodu (napr. Kauflandu): sviečky nie sú "drogéria". */
export const STRONG = new Set(["seasonal", "nonfood", "household", "drugstore", "pets", "baby", "alcohol"]);

/**
 * Nová kategória pre už uložený produkt.
 * Obchody, ktoré nám samy dávajú kategóriu (Kaufland), prepíšeme len pri "silných" kategóriách.
 */
export function recategorize(storeId, name, detail, old) {
  const g = guessCategory(`${name} ${detail ?? ""}`);
  if (storeId === "kaufland") return STRONG.has(g) ? g : old ?? g;
  return g;
}

