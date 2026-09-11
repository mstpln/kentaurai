export const STL_CLASS_OPTIONS = Object.freeze([
  ['class_iii', 'Klass III'],
  ['class_ii', 'Klass II'],
  ['class_i', 'Klass I'],
  ['bronze', 'Bronsdivisionen'],
  ['silver', 'Silverdivisionen'],
  ['gold', 'Gulddivisionen'],
  ['mares_division', 'Stodivisionen'],
  ['diamond_mares', 'Diamantstoet'],
  ['coldblood_division', 'Kallblodsdivisionen']
]);

export const RACE_TYPE_OPTIONS = Object.freeze([
  ['mares', 'Stolopp'],
  ['coldblood', 'Kallblodslopp'],
  ['lane_ladder', 'Spårtrappa'],
  ['apprentice', 'Lärlingslopp'],
  ['amateur', 'Amatörlopp'],
  ['monte', 'Montélopp'],
  ['young_horse', 'Unghästlopp'],
  ['age_group', 'Årgångslopp'],
  ['stayer', 'Stayerlopp / långlopp'],
  ['fast_class', 'Snabblopp'],
  ['advantage', 'Fördelslopp / Fördel ston'],
  ['p21', 'P21-lopp'],
  ['grassroots', 'Breddlopp'],
  ['double_class', 'Dubbelklasslopp']
]);

const STL_PATTERNS = Object.freeze({
  class_iii: [/\bklass\s*(iii|3)\b/i, /\bclass\s*(iii|3)\b/i],
  class_ii: [/\bklass\s*(ii|2)\b/i, /\bclass\s*(ii|2)\b/i],
  class_i: [/\bklass\s*(i|1)\b/i, /\bclass\s*(i|1)\b/i],
  bronze: [/bronsdivision/i, /bronze\s*division/i],
  silver: [/silverdivision/i, /silver\s*division/i],
  gold: [/gulddivision/i, /gold\s*division/i],
  mares_division: [/stodivision/i, /sto\s*division/i, /mares?\s*division/i],
  diamond_mares: [/diamantsto/i, /diamond\s*mares?/i],
  coldblood_division: [/kallblodsdivision/i, /cold\s*blood\s*division/i]
});

const TYPE_PATTERNS = Object.freeze({
  mares: [/\bstolopp\b/i, /\bsto\s*lopp\b/i, /\bmares?\s*race\b/i],
  coldblood: [/\bkallblodslopp\b/i, /\bcold\s*blood\s*race\b/i],
  lane_ladder: [/spårtrappa/i, /spartrappa/i, /lane\s*ladder/i],
  apprentice: [/lärlingslopp/i, /larlingslopp/i, /\blärling\b/i, /\blarling\b/i, /apprentice/i],
  amateur: [/amatörlopp/i, /amatorlopp/i, /\bamatör\b/i, /\bamator\b/i, /amateur/i],
  monte: [/montélopp/i, /montelopp/i, /\bmonté\b/i, /\bmonte\b/i],
  young_horse: [/unghästlopp/i, /unghastlopp/i, /unghästserie/i, /unghastserie/i, /young\s*horse/i],
  age_group: [/årgångslopp/i, /argangslopp/i, /[2345][ -]?årings/i, /[2345][ -]?arings/i, /age\s*group/i],
  stayer: [/stayerlopp/i, /\bstayer\b/i, /långlopp/i, /langlopp/i],
  fast_class: [/snabblopp/i, /fast\s*class/i],
  advantage: [/fördelslopp/i, /fordelslopp/i, /fördel\s*ston/i, /fordel\s*ston/i, /advantage/i],
  p21: [/\bp21(?:-lopp)?\b/i],
  grassroots: [/breddlopp/i, /breddplus/i, /grassroots/i],
  double_class: [/dubbelklasslopp/i, /dubbelklass/i, /double\s*class/i]
});

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [value];
  }
  return [value];
}

function textCorpus(raceName, mainClass, classFlags) {
  return [raceName, mainClass, ...arrayValue(classFlags)]
    .filter((value) => value != null && value !== '')
    .map(String)
    .join(' | ');
}

export function normalizeStlClass(value) {
  if (value == null || value === '' || value === 'all') return null;
  const raw = String(value).trim();
  if (STL_CLASS_OPTIONS.some(([key]) => key === raw)) return raw;
  for (const [key, label] of STL_CLASS_OPTIONS) {
    if (label.toLowerCase() === raw.toLowerCase()) return key;
  }
  return null;
}

export function normalizeRaceType(value) {
  if (value == null || value === '' || value === 'all') return null;
  const raw = String(value).trim();
  if (RACE_TYPE_OPTIONS.some(([key]) => key === raw)) return raw;
  for (const [key, label] of RACE_TYPE_OPTIONS) {
    if (label.toLowerCase() === raw.toLowerCase()) return key;
  }
  return null;
}

export function classifyRace({ raceName = null, mainClass = null, classFlags = null, stlClass = null, raceTypes = null } = {}) {
  const corpus = textCorpus(raceName, mainClass, classFlags);
  const explicitStl = normalizeStlClass(stlClass);
  let detectedStl = explicitStl;
  if (!detectedStl) {
    detectedStl = STL_CLASS_OPTIONS.find(([key]) => STL_PATTERNS[key].some((pattern) => pattern.test(corpus)))?.[0] || null;
  }

  const explicitTypes = arrayValue(raceTypes).map(normalizeRaceType).filter(Boolean);
  const detectedTypes = new Set(explicitTypes);
  for (const [key] of RACE_TYPE_OPTIONS) {
    if (TYPE_PATTERNS[key].some((pattern) => pattern.test(corpus))) detectedTypes.add(key);
  }

  return {
    raceClass: mainClass || null,
    stlClass: detectedStl,
    raceTypes: [...detectedTypes]
  };
}

export function matchesRaceClassification(race, { stlClass = null, raceType = null } = {}) {
  const wantedStl = normalizeStlClass(stlClass);
  const wantedType = normalizeRaceType(raceType);
  if (!wantedStl && !wantedType) return true;
  const classified = classifyRace(race);
  if (wantedStl && classified.stlClass !== wantedStl) return false;
  if (wantedType && !classified.raceTypes.includes(wantedType)) return false;
  return true;
}
