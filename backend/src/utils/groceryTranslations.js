// Common household grocery vocabulary, English <-> French, so the Prices
// tab can be searched in either language. bringo.ma is a French-language
// site (category labels, product names), so an English search like "milk"
// needs to be expanded to also try "lait" and vice versa. This is a
// curated list scoped to what a family pantry app actually needs — not a
// general-purpose translator.
const SYNONYM_GROUPS = [
  ["milk", "lait"],
  ["water", "eau", "eaux"],
  ["fruit", "fruits"],
  ["vegetable", "vegetables", "legume", "legumes", "légume", "légumes"],
  ["oil", "oils", "huile", "huiles"],
  ["dairy", "laitier", "laitiers"],
  ["egg", "eggs", "oeuf", "oeufs", "œuf", "œufs"],
  ["bread", "pain"],
  ["meat", "viande"],
  ["poultry", "volaille"],
  ["chicken", "poulet"],
  ["cheese", "fromage"],
  ["butter", "beurre"],
  ["yogurt", "yoghurt", "yaourt"],
  ["juice", "jus"],
  ["coffee", "cafe", "café"],
  ["tea", "the", "thé"],
  ["sugar", "sucre"],
  ["rice", "riz"],
  ["pasta", "pate", "pates", "pâtes"],
  ["flour", "farine"],
  ["salt", "sel"],
  ["spice", "spices", "epice", "epices", "épice", "épices"],
  ["canned", "conserve", "conserves"],
  ["raspberry", "raspberries", "framboise", "framboises"],
  ["berry", "berries", "fruit rouge", "fruits rouges", "fruit-rouge", "fruits-rouges"],
  ["bakery", "boulangerie"],
  ["pastry", "pastries", "patisserie", "pâtisserie"],
  ["soup", "soupe", "potage", "potages"],
  ["beverage", "beverages", "drink", "drinks", "boisson", "boissons"],
  ["frozen", "surgele", "surgeles", "surgelé", "surgelés"],
];

const SYNONYM_MAP = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    SYNONYM_MAP.set(word, group);
  }
}

// Given a search term, returns the original term plus per-word substituted
// variants for any word with a known translation/synonym. E.g. "milk" ->
// ["milk", "lait"]; "red fruits" -> ["red fruits"] (no match, "red" and
// "fruits" together aren't in the dictionary as a phrase, but "fruits"
// alone would expand if searched by itself).
export function expandSearchVariants(term) {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return [normalized];

  const words = normalized.split(/\s+/);
  const variants = new Set([normalized]);

  words.forEach((word, idx) => {
    const group = SYNONYM_MAP.get(word);
    if (!group) return;
    for (const synonym of group) {
      if (synonym === word) continue;
      const substituted = [...words];
      substituted[idx] = synonym;
      variants.add(substituted.join(" "));
    }
  });

  return [...variants];
}
