/**
 * Map theming.
 *
 * Google Maps takes plain colour strings — it cannot read Tailwind classes or CSS
 * variables. Hard-coding hex values inside the map component is what makes a map
 * drift away from the rest of the app, so instead the palette is declared once as
 * CSS custom properties (`--map-*` in shared/styles/global.css) and resolved here
 * at runtime. Change the tokens, or the theme, and the map follows.
 *
 * Values are normalised through a canvas so any colour syntax the browser
 * understands works — hex, rgb(), and modern `oklch()` alike, which the Maps API
 * itself does not accept.
 */
import { useEffect, useMemo, useState } from 'react';

/** Cache: CSS variables only change on theme switch, and resolving hits the DOM. */
let resolveCache = new Map();

/**
 * Normalises any CSS colour string to `#rrggbb`, which the Maps API accepts.
 * @param {string} input
 * @returns {string} hex colour, or '' when the browser cannot parse `input`
 */
const normalizeColor = (input) => {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';

    // An unparseable colour leaves fillStyle untouched. Probing with two different
    // sentinels tells "invalid" apart from "legitimately equal to the sentinel".
    ctx.fillStyle = '#ff0000';
    ctx.fillStyle = value;
    const afterRed = ctx.fillStyle;
    ctx.fillStyle = '#0000ff';
    ctx.fillStyle = value;
    if (afterRed !== ctx.fillStyle) return '';

    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return '';
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return '';
  }
};

/**
 * Reads a CSS custom property from :root and normalises it.
 * @param {string} token e.g. '--map-route'
 * @param {string} fallback used when the token is missing or unparseable
 * @returns {string} hex colour
 */
export const resolveCssColor = (token, fallback) => {
  if (typeof document === 'undefined') return fallback;
  if (resolveCache.has(token)) return resolveCache.get(token);

  const raw = getComputedStyle(document.documentElement).getPropertyValue(token);
  const resolved = normalizeColor(raw) || normalizeColor(fallback) || fallback;
  resolveCache.set(token, resolved);
  return resolved;
};

/** Token → fallback. Fallbacks keep the map usable if global.css ever changes. */
const PALETTE_TOKENS = {
  surface: ['--map-surface', '#f1f3f4'],
  road: ['--map-road', '#ffffff'],
  roadStroke: ['--map-road-stroke', '#e6e8ea'],
  water: ['--map-water', '#d9e4ea'],
  park: ['--map-park', '#e6efe4'],
  label: ['--map-label', '#8a8f98'],
  labelStroke: ['--map-label-stroke', '#ffffff'],
  route: ['--map-route', '#eb590e'],
  routeCasing: ['--map-route-casing', '#ffffff'],
  routePending: ['--map-route-pending', '#9aa1ac'],
  restaurant: ['--map-restaurant', '#eb590e'],
  customer: ['--map-customer', '#24963f'],
  riderPulse: ['--map-rider-pulse', '#eb590e'],
  badge: ['--map-badge', '#1a1a1a'],
  badgeForeground: ['--map-badge-foreground', '#ffffff'],
};

/**
 * Resolves every map colour token against the document's current theme.
 * @returns {Record<keyof PALETTE_TOKENS, string>}
 */
export const getMapPalette = () =>
  Object.fromEntries(
    Object.entries(PALETTE_TOKENS).map(([key, [token, fallback]]) => [
      key,
      resolveCssColor(token, fallback),
    ]),
  );

/**
 * Builds the Google Maps style array from a resolved palette.
 * @param {ReturnType<typeof getMapPalette>} palette
 * @returns {google.maps.MapTypeStyle[]}
 */
export const buildMapStyles = (palette) => [
  { elementType: 'geometry', stylers: [{ color: palette.surface }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: palette.label }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: palette.labelStroke }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: palette.park }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: palette.road }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: palette.roadStroke }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: palette.label }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: palette.water }] },
  { featureType: 'water', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
];

/**
 * Palette + map styles for the current theme, recomputed when the theme changes.
 *
 * The app toggles dark mode by putting a `dark` class on <html>, so a class
 * mutation is the signal to re-resolve. Nothing polls.
 *
 * @returns {{ palette: ReturnType<typeof getMapPalette>, mapStyles: google.maps.MapTypeStyle[], isDark: boolean }}
 */
export const useMapTheme = () => {
  const readIsDark = () =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const [themeKey, setThemeKey] = useState(readIsDark);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const observer = new MutationObserver(() => {
      const next = readIsDark();
      setThemeKey((current) => {
        if (current === next) return current;
        resolveCache = new Map(); // tokens now resolve to the other theme's values
        return next;
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    const palette = getMapPalette();
    return { palette, mapStyles: buildMapStyles(palette), isDark: themeKey };
  }, [themeKey]);
};
