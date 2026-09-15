import mongoose from 'mongoose';
import { config } from '../../../../config/env.js';

/**
 * Hard ceiling on how long a delivery request may ever stay acceptable.
 *
 * Nothing - not a config override, not a legacy row written before `expiresAt`
 * existed, not a queue that never ran - may produce an offer that outlives this
 * window. Ten minutes, measured from the moment the offer was created.
 */
export const MAX_OFFER_VALIDITY_MS = 10 * 60 * 1000;

/** Configured offer lifetime, clamped so it can never exceed the hard ceiling. */
export const OFFER_TTL_MS = Math.min(
  Math.max(Number(config.deliveryOfferTtlSeconds) || 60, 5) * 1000,
  MAX_OFFER_VALIDITY_MS,
);

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** When the offer was created. `createdAt` is authoritative; `at` is the legacy name. */
export function offerCreatedAt(offer) {
  return toDate(offer?.createdAt) || toDate(offer?.at);
}

/**
 * The instant this offer stops being acceptable.
 *
 * Rows written before `expiresAt` shipped used to be treated as non-expiring,
 * which is exactly how a request from hours ago survives a logout, a refresh and
 * a reinstall and still shows up in the rider's feed. They now fall back to
 * creation + TTL, and every offer - new or legacy - is additionally capped at
 * creation + MAX_OFFER_VALIDITY_MS.
 */
export function offerExpiresAt(offer) {
  const createdAt = offerCreatedAt(offer);
  if (!createdAt) return new Date(0); // undatable offer => already dead
  const hardCap = new Date(createdAt.getTime() + MAX_OFFER_VALIDITY_MS);
  const declared = toDate(offer?.expiresAt) || new Date(createdAt.getTime() + OFFER_TTL_MS);
  return declared < hardCap ? declared : hardCap;
}

/** True while the offer is still pending AND inside its validity window. */
export function isOfferLive(offer, now = new Date()) {
  if (!offer || offer.action !== 'offered') return false;
  return offerExpiresAt(offer) > now;
}

/**
 * `$elemMatch` for "this partner holds a live offer on this order".
 *
 * Mirrors isOfferLive() in the database so the available-orders query and the
 * atomic accept guard agree with the in-memory sweep. Legacy rows without
 * `expiresAt` are matched through their creation stamp rather than waved
 * through, and every branch is additionally floored at now - 10 minutes.
 */
export function liveOfferElemMatch(partnerId, now = new Date()) {
  const ttlFloor = new Date(now.getTime() - OFFER_TTL_MS);
  const hardFloor = new Date(now.getTime() - MAX_OFFER_VALIDITY_MS);
  // `{ field: null }` matches both an explicit null and a missing field, which
  // is what lets the fallbacks below cover rows written before these stamps.
  const createdWithinCap = [
    { createdAt: { $gt: hardFloor } },
    { createdAt: null, at: { $gt: hardFloor } },
  ];
  const notExpired = [
    { expiresAt: { $gt: now } },
    { expiresAt: null, createdAt: { $gt: ttlFloor } },
    { expiresAt: null, createdAt: null, at: { $gt: ttlFloor } },
  ];

  return {
    partnerId: new mongoose.Types.ObjectId(String(partnerId)),
    action: 'offered',
    $and: [{ $or: createdWithinCap }, { $or: notExpired }],
  };
}

/** The live offer this partner holds on the order, or null. */
export function findLiveOfferForPartner(orderLike, partnerId, now = new Date()) {
  const offers = orderLike?.dispatch?.offeredTo || [];
  return (
    offers.find(
      (offer) => String(offer?.partnerId || '') === String(partnerId) && isOfferLive(offer, now),
    ) || null
  );
}

/**
 * Flip every offer on this order that has outlived its window to `timeout`.
 *
 * Mutates the passed document (caller saves), and returns the partner ids whose
 * offers just died so they can be told to drop the card and stop ringing.
 */
export function expireStaleOffers(orderLike, now = new Date()) {
  const expired = [];
  for (const offer of orderLike?.dispatch?.offeredTo || []) {
    if (offer?.action !== 'offered') continue;
    if (offerExpiresAt(offer) > now) continue;
    offer.action = 'timeout';
    if (offer.partnerId) expired.push(String(offer.partnerId));
  }
  return expired;
}
