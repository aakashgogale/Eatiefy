const STORAGE_KEY = "food_auth_draft_v1";

/** Drafts are only meant to survive the current auth attempt, not a stale session. */
const MAX_AGE_MS = 30 * 60 * 1000;

const readAll = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    return data;
  } catch {
    return {};
  }
};

const writeAll = (data) => {
  if (typeof window === "undefined") return;
  try {
    if (!data || Object.keys(data).length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
};

/**
 * Keep the last 10 digits, so a stored full number ("+91 9876543210") and a
 * half-typed one ("98765") both normalize to what the input should show.
 */
const normalizePhone = (phone) =>
  String(phone ?? "").replace(/\D/g, "").slice(-10);

/**
 * Read the in-progress login/register input for a module.
 * Returns null when nothing was typed, or the draft has gone stale.
 */
export const readAuthDraft = (module) => {
  const entry = readAll()[module];
  if (!entry || typeof entry !== "object") return null;
  if (entry.ts && Date.now() - Number(entry.ts) > MAX_AGE_MS) return null;

  const phone = normalizePhone(entry.phone);
  if (!phone && typeof entry.isSignUp !== "boolean") return null;

  return {
    phone,
    countryCode: String(entry.countryCode || "+91"),
    isSignUp: entry.isSignUp === true,
  };
};

/**
 * Persist the in-progress login/register input so leaving the page for
 * Terms / Privacy / Support and coming back restores it untouched.
 */
export const saveAuthDraft = (module, { phone, countryCode, isSignUp } = {}) => {
  const all = readAll();
  all[module] = {
    phone: normalizePhone(phone),
    countryCode: String(countryCode || "+91"),
    isSignUp: isSignUp === true,
    ts: Date.now(),
  };
  writeAll(all);
};

/** Drop the draft once the auth flow finishes or is explicitly abandoned. */
export const clearAuthDraft = (module) => {
  const all = readAll();
  if (!(module in all)) return;
  delete all[module];
  writeAll(all);
};

/**
 * The sessionStorage key each module uses as its "an OTP is pending" flag.
 * The OTP route renders only while its key is present, so removing it is what
 * actually closes the OTP step — not the history entry.
 */
const OTP_SESSION_KEYS = {
  user: "userAuthData",
  delivery: "deliveryAuthData",
};

/** End the pending OTP step so its route can no longer open from history. */
export const clearOtpSession = (module) => {
  const key = OTP_SESSION_KEYS[module];
  if (!key || typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

/**
 * The single "Edit Phone Number" action.
 *
 * Going back to the phone page has to undo the whole OTP step, otherwise the
 * OTP page stays reachable — from the history entry Continue pushed, and from
 * the pending-OTP flag that still says a code is in flight. So this:
 *   1. keeps the phone in the draft, so the page reopens populated + editable,
 *   2. clears the pending-OTP flag, so /otp can no longer render,
 *   3. returns to the phone page's existing history entry instead of pushing a
 *      new one, so Back from there leads out of the auth flow, never to /otp.
 */
export const startPhoneEdit = ({
  module,
  navigate,
  loginPath,
  cameFromLogin = false,
  phone,
  countryCode,
  isSignUp,
} = {}) => {
  saveAuthDraft(module, { phone, countryCode, isSignUp });
  clearOtpSession(module);

  // history.state.idx is React Router's own stack position; > 0 means the entry
  // Continue pushed has a page behind it that we can safely pop back to.
  const idx =
    typeof window !== "undefined" ? Number(window.history?.state?.idx) : NaN;
  const canPopBackToLogin = cameFromLogin && Number.isFinite(idx) && idx > 0;

  if (canPopBackToLogin) {
    navigate(-1);
    return;
  }

  // No known phone-page entry behind us — overwrite the OTP entry instead of
  // stacking on top of it, so Back still cannot reach /otp.
  navigate(loginPath, { replace: true });
};
