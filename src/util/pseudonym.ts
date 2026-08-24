const ADJECTIVES = [
  "Sunny",
  "Blue",
  "Moon",
  "Star",
  "Golden",
  "Quiet",
  "Bright",
  "Gentle",
  "Amber",
  "Coral",
  "Violet",
  "Silver",
  "Calm",
  "Brave",
  "Wild",
  "Mellow",
];

const NOUNS = [
  "Flower",
  "River",
  "Jumper",
  "Light",
  "Wanderer",
  "Sparrow",
  "Meadow",
  "Breeze",
  "Harbor",
  "Ember",
  "Pathway",
  "Horizon",
  "Petal",
  "Comet",
  "Willow",
  "Dawn",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generates a friendly, display-only pseudonym like "MoonLight" or "StarJumper01" on collision. */
export function generatePseudonym(suffix?: number): string {
  const base = `${pick(ADJECTIVES)}${pick(NOUNS)}`;
  return suffix !== undefined ? `${base}${String(suffix).padStart(2, "0")}` : base;
}
