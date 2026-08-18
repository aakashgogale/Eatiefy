import { API_BASE_URL } from "@food/api/config";

const defaultBackendOrigin = (API_BASE_URL || "").replace(/\/api\/v1\/?$/i, "").replace(/\/api\/?$/i, "");
const ASSET_BASE_URL = String(
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ASSET_BASE_URL) ||
    "https://omettofood.com"
).replace(/\/$/, "");

const rewriteUploadsUrl = (absoluteUrl) => {
  try {
    const parsed = new URL(absoluteUrl);
    const match = parsed.pathname.match(/\/uploads\/(.+)$/i);
    if (!match) return absoluteUrl;
    const filename = match[1];
    if (!filename || filename.includes("..")) return absoluteUrl;
    return `${ASSET_BASE_URL}/uploads/${filename}${parsed.search || ""}`;
  } catch {
    return absoluteUrl;
  }
};

/**
 * Common utility functions for the Food module
 */

/**
 * Normalizes an image URL to handle relative paths and always load /uploads from the live server.
 */
export const normalizeImageUrl = (imageUrl, backendOrigin = "") => {
  if (typeof imageUrl !== "string") return "";
  const trimmed = imageUrl.trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed;

  const appProtocol = typeof window !== "undefined" ? window.location?.protocol : "";
  const originToUse = backendOrigin || defaultBackendOrigin || ASSET_BASE_URL;

  let normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^(https?):\/(?!\/)/i, "$1://")
    .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

  if (/^\/\//.test(normalized)) normalized = `${appProtocol || "https:"}${normalized}`;

  if (/^(https?:)?\/\//i.test(normalized)) {
    return rewriteUploadsUrl(normalized);
  }

  if (/uploads\//i.test(normalized) || normalized.startsWith("/uploads")) {
    const filename = normalized.replace(/^.*\/uploads\//i, "").replace(/^\/+/, "");
    if (filename && !filename.includes("..")) {
      return `${ASSET_BASE_URL}/uploads/${filename}`;
    }
  }

  const absolutePath = normalized.startsWith("/")
    ? `${originToUse}${normalized}`
    : `${originToUse}/${normalized.replace(/^\.?\/*/, "")}`;
  return rewriteUploadsUrl(absolutePath);
};

/**
 * Extracts a list of image URLs from a source (string, array of strings, or object with image properties)
 */
export const extractImages = (source, backendOrigin = "") => {
  if (!source) return [];
  const normalize = (val) => {
    if (!val) return "";
    if (typeof val === "string") return normalizeImageUrl(val, backendOrigin);
    if (typeof val === "object") {
      const src = val.url || val.secure_url || val.imageUrl || val.image || val.src || "";
      return typeof src === "string" ? normalizeImageUrl(src, backendOrigin) : "";
    }
    return "";
  };

  const candidates = Array.isArray(source) ? source.map(normalize) : [normalize(source)];
  return candidates.filter(Boolean);
};

/**
 * Calculates distance between two coordinates in kilometers using Haversine formula
 */
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Formats distance for display
 */
export const formatDistance = (distanceInKm) => {
  if (distanceInKm === null || distanceInKm === undefined) return "1.2 km";
  if (distanceInKm >= 1) {
    return `${distanceInKm.toFixed(1)} km`;
  } else {
    return `${Math.round(distanceInKm * 1000)} m`;
  }
};

/**
 * Slugifies a string for use in URLs or as identifiers
 */
export const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * Removes Google Plus Codes (e.g. RW52+FGM, W2XM+VCP) from address strings
 */
export const removePlusCode = (addressStr) => {
  if (!addressStr || typeof addressStr !== 'string') return addressStr;
  return addressStr
    // Remove the plus code and optional trailing commas/spaces
    .replace(/\b[A-Z0-9]{2,8}\+[A-Z0-9]{2,5}[,\s]*/ig, '')
    // Also remove if it's at the very beginning without a word boundary
    .replace(/^[A-Z0-9]{2,8}\+[A-Z0-9]{2,5}[,\s]*/ig, '')
    .trim()
    // Clean up any leading or trailing commas that might be left over
    .replace(/^,\s*/, '')
    .replace(/,\s*,/g, ', ')
    .replace(/,\s*$/, '');
};
