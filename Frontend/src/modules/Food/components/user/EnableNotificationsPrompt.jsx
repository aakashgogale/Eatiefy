import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import { isModuleAuthenticated } from "@food/utils/auth";
import {
  enableWebPushFromUserGesture,
  getWebPushPromptState,
} from "@food/utils/firebaseMessaging";

const DISMISS_KEY = "user_push_prompt_dismissed_at";
const DISMISS_FOR_MS = 3 * 24 * 60 * 60 * 1000;

function wasRecentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * Asks the customer to turn on notifications with a real tap. iOS only honours
 * the permission request when it comes from a user gesture, so the automatic
 * request on page load never worked there. Nothing is rendered in the Flutter
 * shell (native push) or once the permission is already decided.
 */
export default function EnableNotificationsPrompt() {
  const { pathname } = useLocation();
  const [state, setState] = useState("unsupported");
  const [dismissed, setDismissed] = useState(() => wasRecentlyDismissed());
  const [busy, setBusy] = useState(false);

  const lower = pathname.toLowerCase();
  const isUserArea =
    !lower.includes("/restaurant") &&
    !lower.includes("/delivery") &&
    !lower.startsWith("/admin") &&
    !lower.includes("login") &&
    !lower.includes("otp") &&
    !lower.includes("auth");

  useEffect(() => {
    setState(getWebPushPromptState());
  }, [pathname]);

  if (!isUserArea || dismissed || !isModuleAuthenticated("user")) return null;
  if (state !== "default" && state !== "ios-needs-install") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    setDismissed(true);
  };

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await enableWebPushFromUserGesture("user");
    } catch {
      /* permission/registration errors leave the prompt state unchanged */
    } finally {
      setBusy(false);
      setState(getWebPushPromptState());
    }
  };

  const needsInstall = state === "ios-needs-install";

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed inset-x-3 z-[60] flex items-center gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-black/10"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)" }}
    >
      <BellRing className="h-6 w-6 shrink-0 text-[#D91F3A]" aria-hidden="true" />
      <p className="flex-1 text-sm text-gray-800">
        {needsInstall
          ? "To get order updates and offers on iPhone: tap Share, then “Add to Home Screen”, and open Eatiefy from there."
          : "Get order updates and offers as notifications."}
      </p>
      {!needsInstall && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="rounded-full bg-[#D91F3A] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Enabling…" : "Enable"}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-full p-1 text-gray-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
