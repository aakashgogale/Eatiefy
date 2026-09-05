import { useEffect, useRef, useState } from "react";
import { Settings, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { adminAPI } from "@food/api";
import { Card, CardHeader, CardTitle, CardContent } from "@food/components/ui/card";
import { Label } from "@food/components/ui/label";
import { Switch } from "@food/components/ui/switch";
import { DINING_ENABLED } from "@food/config/featureFlags";

const CUSTOMIZATION_TOGGLES = [
  {
    key: "cod_enabled",
    label: "Global COD",
    description:
      "Global toggle for COD visibility (Applies to Delivery, NOT Takeaway).",
    defaultValue: true,
  },
  {
    key: "takeaway_cod_enabled",
    label: "Takeaway COD",
    description:
      "Controls Cash on Delivery (COD) visibility for takeaway orders.",
    defaultValue: true,
  },
  {
    key: "delivery_cod_enabled",
    label: "Delivery COD",
    description:
      "Controls Cash on Delivery (COD) visibility for delivery orders.",
    defaultValue: true,
  },
  ...(DINING_ENABLED
    ? [
        {
          key: "dining_cod_enabled",
          label: "Dining COD",
          description:
            "Controls Cash on Delivery (COD) visibility for dining orders.",
          defaultValue: true,
        },
      ]
    : []),
  {
    key: "wallet_payment_enabled",
    label: "Wallet Payment",
    description:
      "Controls visibility of wallet payment method at checkout.",
    defaultValue: true,
  },
  {
    key: "online_payment_enabled",
    label: "Online Payment",
    description:
      "Controls visibility of Razorpay online payment at checkout.",
    defaultValue: true,
  },
  {
    key: "default_location_enabled",
    label: "Default Location Mode",
    description:
      "Bypasses device location permissions and sets default location to Indore for all users.",
    defaultValue: false,
  },
  {
    key: "cod_blocking_feature_enabled",
    label: "Global COD Blocked",
    description:
      "Global toggle to enable/disable the automatic COD blocking feature (blocks COD for users with 4 consecutive COD cancellations).",
    defaultValue: true,
  },
  {
    key: "maintenance_mode_enabled",
    label: "Under Maintenance",
    description:
      "When ON, user / restaurant / delivery apps show the Under Maintenance screen. Admin panel stays available. Default is OFF.",
    defaultValue: false,
  },
];

const getAdminToastOffsetPx = () => {
  try {
    if (typeof window === "undefined") return 0;
    if (window.innerWidth < 1024) return 0;

    const raw = localStorage.getItem("admin_sidebar_state");
    const isCollapsed = raw ? Boolean(JSON.parse(raw)?.isCollapsed) : false;
    return isCollapsed ? 40 : 160; 
  } catch {
    return 0;
  }
};

export default function CustomizationSettings() {
  const [loading, setLoading] = useState(true);
  const [savingByKey, setSavingByKey] = useState({});
  const loadToastShownRef = useRef(false);
  const inFlightReqRef = useRef({}); 
  const unlockTimersRef = useRef({}); 
  const [settings, setSettings] = useState(() => {
    const initial = {};
    for (const t of CUSTOMIZATION_TOGGLES) initial[t.key] = t.defaultValue;
    return initial;
  });

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        setLoading(true);
        const res = await adminAPI.getCustomizationSettings();
        if (!cancelled) {
          const next = {};
          const data = res?.data?.data || {};
          for (const t of CUSTOMIZATION_TOGGLES) {
            next[t.key] = data[t.key] !== undefined ? data[t.key] : t.defaultValue;
          }
          setSettings(next);
        }
      } catch (_error) {
        if (!cancelled) {
          if (!loadToastShownRef.current) {
            loadToastShownRef.current = true;
            toast.error("Failed to load customization settings", {
              duration: 2000,
              style: {
                width: "fit-content",
                maxWidth: "calc(100vw - 32px)",
                marginLeft: `${getAdminToastOffsetPx()}px`,
              },
            });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSettings();
    return () => {
      cancelled = true;
      try {
        for (const k of Object.keys(unlockTimersRef.current || {})) {
          if (unlockTimersRef.current[k]) clearTimeout(unlockTimersRef.current[k]);
        }
      } catch {}
    };
  }, []);

  const handleToggle = async (key, checked) => {
    const prevValue = settings[key];
    setSettings((prev) => ({ ...prev, [key]: checked }));

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    inFlightReqRef.current[key] = requestId;
    setSavingByKey((prev) => ({ ...prev, [key]: true }));

    if (unlockTimersRef.current[key]) clearTimeout(unlockTimersRef.current[key]);
    unlockTimersRef.current[key] = setTimeout(() => {
      if (inFlightReqRef.current[key] === requestId) {
        inFlightReqRef.current[key] = null;
        setSavingByKey((prev) => ({ ...prev, [key]: false }));
      }
    }, 6000);

    const meta = CUSTOMIZATION_TOGGLES.find((t) => t.key === key);
    const label = meta?.label || key;

    toast.success(`${label} ${checked ? "ON" : "OFF"}`, {
      duration: 2000,
      style: {
        width: "fit-content",
        maxWidth: "calc(100vw - 32px)",
        marginLeft: `${getAdminToastOffsetPx()}px`,
      },
    });

    try {
      await adminAPI.updateCustomizationSettings({ [key]: checked });
      if (key === "maintenance_mode_enabled") {
        try {
          const raw = localStorage.getItem("ometto_customization_settings");
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem(
            "ometto_customization_settings",
            JSON.stringify({ ...parsed, maintenance_mode_enabled: checked === true })
          );
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent("maintenanceModeChanged", {
            detail: { enabled: checked === true },
          })
        );
      }
    } catch (_error) {
      setSettings((prev) => ({ ...prev, [key]: prevValue }));
      toast.error("Failed to update setting", {
        duration: 2000,
        style: {
          width: "fit-content",
          maxWidth: "calc(100vw - 32px)",
          marginLeft: `${getAdminToastOffsetPx()}px`,
        },
      });
    } finally {
      if (inFlightReqRef.current[key] === requestId) {
        inFlightReqRef.current[key] = null;
        setSavingByKey((prev) => ({ ...prev, [key]: false }));
      }
      if (unlockTimersRef.current[key]) {
        clearTimeout(unlockTimersRef.current[key]);
        unlockTimersRef.current[key] = null;
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="inline-flex items-center">
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
            <Settings className="w-7 h-7 text-neutral-800 dark:text-neutral-200" />
            Customization Settings
          </h1>
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 mt-1">Control global customization toggles for the platform.</p>
      </div>

      <Card className="dark:bg-[#1a1a1a] dark:border-neutral-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />
            <CardTitle className="dark:text-white">Manage All Toggles Here</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {CUSTOMIZATION_TOGGLES.map((t) => (
              <div
                key={t.key}
                className="flex items-start justify-between gap-3 p-3 border rounded-lg bg-neutral-50/50 dark:bg-neutral-900/50 dark:border-neutral-800"
              >
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold dark:text-neutral-200">{t.label}</Label>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-snug">{t.description}</p>
                </div>
                <div className="shrink-0 pt-0.5">
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
                  ) : (
                    <Switch
                      checked={settings[t.key] === true}
                      onCheckedChange={(checked) => handleToggle(t.key, checked)}
                      disabled={savingByKey[t.key] === true}
                      className="scale-90 data-[state=checked]:bg-[#16a34a] data-[state=unchecked]:bg-zinc-400 shadow-sm"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
