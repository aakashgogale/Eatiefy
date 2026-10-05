import {
  resolveMediaUrl,
  normalizeImageUrl as sharedNormalizeImageUrl,
  extractImages as sharedExtractImages,
  resolveImageSrc,
} from "@/shared/utils/mediaUrl.js";

/**
 * Common utility functions for the Food module
 */

/**
 * Normalizes an image URL to handle relative paths, Cloudinary, and live server uploads.
 */
export const normalizeImageUrl = (imageUrl, backendOrigin = "") => {
  return sharedNormalizeImageUrl(imageUrl, backendOrigin || undefined);
};

/**
 * Extracts a list of image URLs from a source (string, array of strings, or object with image properties)
 */
export const extractImages = (source, backendOrigin = "") => {
  return sharedExtractImages(source, backendOrigin || undefined);
};

export { resolveMediaUrl, resolveImageSrc };

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
