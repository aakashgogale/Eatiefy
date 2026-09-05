import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BellRing, Volume2 } from "lucide-react";
import { Button } from "@food/components/ui/button";
import { enablePushNotificationSound, isPushSoundEnabled } from "@food/utils/firebaseMessaging";
import { isModuleAuthenticated } from "@food/utils/auth";

function isMobileDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
  const isSmallViewport = window.matchMedia?.("(max-width: 768px)")?.matches;
  const isWebView =
    Boolean(window.ReactNativeWebView) ||
    Boolean(window.flutter_inappwebview) ||
    /\bwv\b|WebView/i.test(userAgent);

  return Boolean(isMobileUserAgent || isSmallViewport || isWebView);
}

export default function PushSoundEnableButton() {
  const location = useLocation();
  const [enabled, setEnabled] = useState(() => isPushSoundEnabled());
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  
  const pathname = location.pathname.toLowerCase();
  const isAdminRoute = pathname.startsWith("/admin");
  
  const isSuppressedPath = useMemo(() => {
    return (
      pathname.includes("terms") ||
      pathname.includes("privacy") ||
      pathname.includes("support") ||
      pathname.includes("login") ||
      pathname.includes("otp")
    );
  }, [pathname]);

  const isAuthenticated = useMemo(() => {
    return (
      isModuleAuthenticated("user") ||
      isModuleAuthenticated("restaurant") ||
      isModuleAuthenticated("delivery")
    );
  }, [pathname]);

  useEffect(() => {
    const syncState = () => {
      setEnabled(isPushSoundEnabled());
      setIsMobile(isMobileDevice());
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    };

    window.addEventListener("push-sound-enabled", syncState);
    window.addEventListener("resize", syncState);

    return () => {
      window.removeEventListener("push-sound-enabled", syncState);
      window.removeEventListener("resize", syncState);
    };
  }, []);

  // Background Auto-enable and Direct browser prompt trigger
  useEffect(() => {
    if (!isAuthenticated || isSuppressedPath || isMobile || isAdminRoute) {
      return;
    }

    if (typeof Notification === "undefined") return;

    const handleAutoActivation = async () => {
      if (Notification.permission === "granted") {
        if (!enabled) {
          const success = await enablePushNotificationSound();
          if (success) setEnabled(true);
        }
      } else if (Notification.permission === "default") {
        // Automatically request browser permission on home/dashboard load
        try {
          const requestedPermission = await Notification.requestPermission();
          setPermission(requestedPermission);
          if (requestedPermission === "granted") {
            const success = await enablePushNotificationSound();
            if (success) setEnabled(true);
          }
        } catch (err) {
          console.warn("FCM Auto-permission request failed:", err);
        }
      }
    };

    // Delay slightly to let the page settle
    const timer = setTimeout(handleAutoActivation, 1500);
    return () => clearTimeout(timer);
  }, [isAuthenticated, isSuppressedPath, isMobile, isAdminRoute, enabled]);

  // Always return null to prevent rendering the custom HTML card popup UI
  return null;
}
