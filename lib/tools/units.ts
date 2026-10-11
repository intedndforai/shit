/**
 * Unit conversion.
 *
 * Table-driven on purpose: every unit is either a factor against the category's
 * base unit or, for temperature, an affine transform. No dependencies, no
 * dynamic evaluation, and an error message that lists what the category knows.
 */

export interface ConversionResult {
  value: number;
  from: string;
  to: string;
  category: string;
  text: string;
}

export class UnitError extends Error {}

interface Category {
  name: string;
  base: string;
  /** multiplier to the base unit */
  factors: Record<string, number>;
  aliases?: Record<string, string>;
}

const CATEGORIES: Category[] = [
  {
    name: "length",
    base: "m",
    factors: {
      nm: 1e-9,
      um: 1e-6,
      mm: 0.001,
      cm: 0.01,
      dm: 0.1,
      m: 1,
      km: 1000,
      in: 0.0254,
      ft: 0.3048,
      yd: 0.9144,
      mi: 1609.344,
      nmi: 1852,
      ly: 9.4607304725808e15,
    },
    aliases: {
      meter: "m",
      meters: "m",
      metre: "m",
      metres: "m",
      kilometer: "km",
      kilometers: "km",
      kilometre: "km",
      centimetre: "cm",
      centimeter: "cm",
      millimeter: "mm",
      millimetre: "mm",
      nanometer: "nm",
      inch: "in",
      inches: "in",
      foot: "ft",
      feet: "ft",
      yard: "yd",
      yards: "yd",
      mile: "mi",
      miles: "mi",
      "nautical mile": "nmi",
      "nautical miles": "nmi",
      "light year": "ly",
      "light years": "ly",
    },
  },
  {
    name: "mass",
    base: "kg",
    factors: {
      mg: 1e-6,
      g: 0.001,
      kg: 1,
      t: 1000,
      oz: 0.028349523125,
      lb: 0.45359237,
      st: 6.35029318,
      ton: 907.18474,
      tonne: 1000,
    },
    aliases: {
      milligram: "mg",
      gram: "g",
      grams: "g",
      kilogram: "kg",
      kilograms: "kg",
      kilo: "kg",
      kilos: "kg",
      pound: "lb",
      pounds: "lb",
      lbs: "lb",
      ounce: "oz",
      ounces: "oz",
      stone: "st",
      ton_us: "ton",
      "us ton": "ton",
      metric_ton: "tonne",
      "metric ton": "tonne",
    },
  },
  {
    name: "volume",
    base: "l",
    factors: {
      ml: 0.001,
      cl: 0.01,
      dl: 0.1,
      l: 1,
      m3: 1000,
      tsp: 0.00492892159375,
      tbsp: 0.01478676478125,
      floz: 0.0295735295625,
      cup: 0.2365882365,
      pt: 0.473176473,
      qt: 0.946352946,
      gal: 3.785411784,
      "imp gal": 4.54609,
    },
    aliases: {
      milliliter: "ml",
      millilitre: "ml",
      liter: "l",
      liters: "l",
      litre: "l",
      litres: "l",
      "cubic meter": "m3",
      "cubic metre": "m3",
      teaspoon: "tsp",
      teaspoons: "tsp",
      tablespoon: "tbsp",
      tablespoons: "tbsp",
      "fluid ounce": "floz",
      "fluid ounces": "floz",
      cups: "cup",
      pint: "pt",
      pints: "pt",
      quart: "qt",
      quarts: "qt",
      gallon: "gal",
      gallons: "gal",
    },
  },
  {
    name: "time",
    base: "s",
    factors: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31557600 },
    aliases: {
      millisecond: "ms",
      milliseconds: "ms",
      second: "s",
      seconds: "s",
      sec: "s",
      minute: "min",
      minutes: "min",
      hour: "h",
      hours: "h",
      day: "d",
      days: "d",
      week: "wk",
      weeks: "wk",
      year: "yr",
      years: "yr",
    },
  },
  {
    name: "area",
    base: "m2",
    factors: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 10000, acre: 4046.8564224, ft2: 0.09290304, mi2: 2589988.110336 },
    aliases: {
      "square meter": "m2",
      "square meters": "m2",
      "square metre": "m2",
      hectare: "ha",
      hectares: "ha",
      acres: "acre",
      "square foot": "ft2",
      "square feet": "ft2",
      "square mile": "mi2",
      "square miles": "mi2",
    },
  },
  {
    name: "speed",
    base: "mps",
    factors: { mps: 1, kph: 1 / 3.6, mph: 0.44704, knot: 0.5144444444444445, fps: 0.3048 },
    aliases: {
      "m/s": "mps",
      "meters per second": "mps",
      "metres per second": "mps",
      "km/h": "kph",
      kph: "kph",
      kmh: "kph",
      "kilometers per hour": "kph",
      "miles per hour": "mph",
      mph: "mph",
      knots: "knot",
      "feet per second": "fps",
    },
  },
  {
    name: "data",
    base: "b",
    factors: {
      b: 1,
      kb: 1000,
      mb: 1e6,
      gb: 1e9,
      tb: 1e12,
      kib: 1024,
      mib: 1048576,
      gib: 1073741824,
      tib: 1099511627776,
    },
    aliases: {
      byte: "b",
      bytes: "b",
      kilobyte: "kb",
      kilobytes: "kb",
      megabyte: "mb",
      megabytes: "mb",
      gigabyte: "gb",
      gigabytes: "gb",
      terabyte: "tb",
      terabytes: "tb",
      kibibyte: "kib",
      mebibyte: "mib",
      gibibyte: "gib",
      tebibyte: "tib",
    },
  },
  {
    name: "energy",
    base: "j",
    factors: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, btu: 1055.05585262, ftlb: 1.3558179483314004 },
    aliases: {
      joule: "j",
      joules: "j",
      kilojoule: "kj",
      kilojoules: "kj",
      calorie: "cal",
      calories: "cal",
      kilocalorie: "kcal",
      kilocalories: "kcal",
      "watt hour": "wh",
      "kilowatt hour": "kwh",
      "kilowatt-hour": "kwh",
      "btu": "btu",
      "foot pound": "ftlb",
      "foot-pound": "ftlb",
    },
  },
];

/** Temperature is affine, so it does not fit the factor table. */
const TEMPERATURE_ALIASES: Record<string, string> = {
  c: "c",
  celsius: "c",
  centigrade: "c",
  "°c": "c",
  f: "f",
  fahrenheit: "f",
  "°f": "f",
  k: "k",
  kelvin: "k",
};

function temperatureToCelsius(value: number, unit: string): number {
  if (unit === "c") return value;
  if (unit === "f") return (value - 32) / 1.8;
  return value - 273.15;
}

function celsiusTo(value: number, unit: string): number {
  if (unit === "c") return value;
  if (unit === "f") return value * 1.8 + 32;
  return value + 273.15;
}

function normalise(raw: string, category: Category): string | null {
  const key = raw.trim().toLowerCase();
  if (category.factors[key]) return key;
  const alias = category.aliases?.[key];
  if (alias && category.factors[alias]) return alias;
  return null;
}


/** Best-effort category detection: only used to explain a failed lookup. */
function categoriesContaining(unit: string): Category[] {
  const key = unit.trim().toLowerCase();
  return CATEGORIES.filter((category) => Boolean(normalise(key, category)));
}

export function convertUnits(value: number, fromRaw: string, toRaw: string): ConversionResult {
  if (!Number.isFinite(value)) throw new UnitError("`value` must be a finite number.");

  const fromKey = fromRaw.trim().toLowerCase();
  const toKey = toRaw.trim().toLowerCase();

  const fromTemperature = TEMPERATURE_ALIASES[fromKey];
  const toTemperature = TEMPERATURE_ALIASES[toKey];
  if (fromTemperature && toTemperature) {
    const converted = celsiusTo(temperatureToCelsius(value, fromTemperature), toTemperature);
    return {
      value: converted,
      from: fromTemperature,
      to: toTemperature,
      category: "temperature",
      text: `${value} °${fromTemperature.toUpperCase()} = ${round(converted)} °${toTemperature.toUpperCase()}`,
    };
  }

  const fromCategories = categoriesContaining(fromKey);
  const category = fromCategories.find((candidate) => normalise(toKey, candidate));
  if (!category) {
    if (!fromCategories.length) {
      throw new UnitError(`Unknown unit “${fromRaw}”. ${describeKnown()}`);
    }
    const category2 = fromCategories[0];
    throw new UnitError(
      `“${toRaw}” is not a ${category2.name} unit. ${category2.name} knows: ${Object.keys(category2.factors).join(", ")}.`
    );
  }

  const from = normalise(fromKey, category);
  const to = normalise(toKey, category);
  if (!from || !to) throw new UnitError(`Could not resolve ${fromRaw} → ${toRaw}.`);

  const converted = (value * category.factors[from]) / category.factors[to];
  return {
    value: converted,
    from,
    to,
    category: category.name,
    text: `${value} ${from} = ${round(converted)} ${to}`,
  };
}

function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e15)) return Number(value.toExponential(6));
  const decimals = magnitude < 1 ? 6 : magnitude < 1000 ? 4 : 2;
  return Number(value.toFixed(decimals));
}

export function describeKnown(): string {
  const names = CATEGORIES.map((category) => `${category.name} (${Object.keys(category.factors).slice(0, 6).join(", ")}, …)`);
  return `Known categories: ${names.join("; ")}; temperature (c, f, k).`;
}

export function knownUnits(): string[] {
  return [
    ...CATEGORIES.flatMap((category) => Object.keys(category.factors)),
    ...Object.keys(TEMPERATURE_ALIASES),
  ];
}