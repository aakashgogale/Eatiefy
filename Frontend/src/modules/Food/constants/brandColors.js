/**
 * Eatiefy brand palette, taken from the logo: gold lettering on deep forest
 * green, with leaf-green accents.
 *
 * The partner apps previously used unrelated crimson and navy schemes. Keeping
 * the values here means both auth flows stay in sync and a future rebrand is a
 * one-file change instead of a hunt through hard-coded hexes.
 */
export const BRAND = {
  // Forest greens — used for the hero panels.
  deepest: "#0B261A",
  deeper: "#0C2A1D",
  deep: "#0F3323",
  dark: "#14472F",
  mid: "#175136",
  base: "#1B5E3F",

  // Gold — the logo's lettering, used for wordmarks and primary actions.
  gold: "#C9962F",
  goldDark: "#A8761D",
  goldLight: "#E8C87A",

  // Leaf green — secondary accent.
  leaf: "#4C9A3F",
  leafLight: "#6BBF59",
};

export default BRAND;
