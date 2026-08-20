import React, { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { adminAPI } from "@/services/api"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { toast } from "sonner"
import {
  Loader2,
  Save,
  Award,
  TrendingUp,
  Wallet,
  Receipt,
  Sparkles,
  Info,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
  ReceiptText,
  CheckCircle2,
  Sliders,
} from "lucide-react"

const THEME = "#E2AD4B"
const GST_RATE = 0.18

const formatMoney = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const PLAN_META = {
  starter: {
    label: "Starter",
    badge: "Entry Tier",
    description: "For new or lower order volume restaurants",
    icon: Award,
    accent: "text-slate-800",
    bgGradient: "from-slate-50 to-slate-100/60",
    borderColor: "border-slate-200",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    ring: "focus-within:ring-slate-400",
    badgeBg: "bg-slate-100 text-slate-700",
  },
  growth: {
    label: "Growth",
    badge: "Popular",
    description: "For scaling mid-range GMV restaurants",
    icon: Sparkles,
    accent: "text-amber-700",
    bgGradient: "from-amber-50/70 to-orange-50/40",
    borderColor: "border-amber-200",
    chip: "bg-amber-100/80 text-amber-800 border-amber-200",
    ring: "focus-within:ring-amber-400",
    badgeBg: "bg-amber-500 text-white shadow-xs",
  },
  premium: {
    label: "Premium",
    badge: "High GMV",
    description: "For established high turnover restaurants",
    icon: TrendingUp,
    accent: "text-emerald-700",
    bgGradient: "from-emerald-50/60 to-teal-50/30",
    borderColor: "border-emerald-200",
    chip: "bg-emerald-100/80 text-emerald-800 border-emerald-200",
    ring: "focus-within:ring-emerald-400",
    badgeBg: "bg-emerald-600 text-white shadow-xs",
  },
}

const MoneyInput = ({ id, value, onChange, placeholder = "0", className = "" }) => (
  <div className={`relative ${className}`}>
    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
      ₹
    </span>
    <Input
      id={id}
      type="number"
      min="0"
      placeholder={placeholder}
      className="h-11 rounded-xl border-slate-200 bg-white pl-8 font-medium text-slate-900 shadow-xs transition-all focus-visible:ring-2 focus-visible:ring-amber-500/25 focus-visible:border-amber-400"
      value={value === "" ? "" : value}
      onChange={onChange}
    />
  </div>
)

const SubscriptionSettings = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [featureEnabled, setFeatureEnabled] = useState(true)
  const [gstRate, setGstRate] = useState(0.18)
  const [settings, setSettings] = useState({
    starterPrice: 999,
    growthPrice: 1999,
    premiumPrice: 2999,
    starterMinGmv: 0,
    starterMaxGmv: 30000,
    growthMinGmv: 30000.01,
    growthMaxGmv: 60000,
    premiumMinGmv: 60000.01,
    onboardingFee: 0,
  })

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getRestaurantSubscriptionSettings()
      try {
        const featureRes = await adminAPI.getFeatureSettings()
        const featureRows = Array.isArray(featureRes?.data?.data) ? featureRes.data.data : []
        const feature = featureRows.find((row) => row.key === "restaurant_subscription")
        if (feature) setFeatureEnabled(Boolean(feature.isEnabled))
      } catch (_featureError) {
        setFeatureEnabled(true)
      }
      if (res.data?.success && res.data.data) {
        const data = res.data.data
        if (data.gstRate != null) {
          setGstRate(Number(data.gstRate) || 0.18)
        }
        setSettings({
          starterPrice: Number(data?.starterPrice ?? 999),
          growthPrice: Number(data?.growthPrice ?? 1999),
          premiumPrice: Number(data?.premiumPrice ?? 2999),
          starterMinGmv: Number(data?.starterMinGmv ?? 0),
          starterMaxGmv: Number(data?.starterMaxGmv ?? 30000),
          growthMinGmv: Number(data?.growthMinGmv ?? 30000.01),
          growthMaxGmv: Number(data?.growthMaxGmv ?? 60000),
          premiumMinGmv: Number(data?.premiumMinGmv ?? 60000.01),
          onboardingFee: Number(data?.onboardingFee ?? 0),
        })
      }
    } catch (error) {
      console.error("Error fetching settings:", error)
      toast.error("Failed to load subscription settings.")
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const payload = {
        starterPrice: Number(settings.starterPrice) || 0,
        growthPrice: Number(settings.growthPrice) || 0,
        premiumPrice: Number(settings.premiumPrice) || 0,
        starterMinGmv: Number(settings.starterMinGmv) || 0,
        starterMaxGmv: Number(settings.starterMaxGmv) || 0,
        growthMinGmv: Number(settings.growthMinGmv) || 0,
        growthMaxGmv: Number(settings.growthMaxGmv) || 0,
        premiumMinGmv: Number(settings.premiumMinGmv) || 0,
        onboardingFee: Number(settings.onboardingFee) || 0,
      }
      const res = await adminAPI.updateRestaurantSubscriptionSettings(payload)
      if (res.data?.success) {
        const updated = res.data.data
        if (updated) {
          setSettings({
            starterPrice: Number(updated.starterPrice ?? payload.starterPrice),
            growthPrice: Number(updated.growthPrice ?? payload.growthPrice),
            premiumPrice: Number(updated.premiumPrice ?? payload.premiumPrice),
            starterMinGmv: Number(updated.starterMinGmv ?? payload.starterMinGmv),
            starterMaxGmv: Number(updated.starterMaxGmv ?? payload.starterMaxGmv),
            growthMinGmv: Number(updated.growthMinGmv ?? payload.growthMinGmv),
            growthMaxGmv: Number(updated.growthMaxGmv ?? payload.growthMaxGmv),
            premiumMinGmv: Number(updated.premiumMinGmv ?? payload.premiumMinGmv),
            onboardingFee: Number(updated.onboardingFee ?? payload.onboardingFee),
          })
          if (updated.gstRate != null) {
            setGstRate(Number(updated.gstRate) || 0.18)
          }
        }
        toast.success("Subscription settings updated and saved successfully!")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      toast.error(error?.response?.data?.message || "Failed to update subscription settings.")
    } finally {
      setSaving(false)
    }
  }

  const updateSetting = (key, rawValue) => {
    setSettings((prev) => ({
      ...prev,
      [key]: rawValue === "" ? "" : Math.max(0, Number(rawValue) || 0),
    }))
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-amber-500" />
        <p className="text-sm font-medium text-slate-500">Loading subscription settings...</p>
      </div>
    )
  }

  const plans = [
    {
      key: "starter",
      priceKey: "starterPrice",
      minKey: "starterMinGmv",
      maxKey: "starterMaxGmv",
      hasMax: true,
    },
    {
      key: "growth",
      priceKey: "growthPrice",
      minKey: "growthMinGmv",
      maxKey: "growthMaxGmv",
      hasMax: true,
    },
    {
      key: "premium",
      priceKey: "premiumPrice",
      minKey: "premiumMinGmv",
      hasMax: false,
    },
  ]

  const onboardingFeeBase = Math.max(0, Number(settings.onboardingFee) || 0)
  const onboardingFeeGst =
    onboardingFeeBase > 0 ? Math.round(onboardingFeeBase * gstRate * 100) / 100 : 0
  const onboardingFeeTotal = onboardingFeeBase + onboardingFeeGst

  const gstPercentage = Math.round(gstRate * 100)

  return (
    <div className="min-h-screen bg-slate-50/70 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        
        {/* Page Top Header Bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 text-white shadow-sm shadow-amber-500/20">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  Restaurant Subscription Settings
                </h1>
                {featureEnabled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="h-3 w-3" />
                    Feature Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200/60">
                    <ShieldAlert className="h-3 w-3" />
                    Feature Disabled
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 sm:text-sm mt-0.5">
                Configure monthly plan pricing, GMV thresholds, and onboarding fees (with 18% GST).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              onClick={() => navigate("/admin/food/restaurants/subscription-history")}
              className="h-10 rounded-xl border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900"
            >
              <ReceiptText className="mr-1.5 h-4 w-4 text-slate-500" />
              Subscription Billing
            </Button>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-10 cursor-pointer rounded-xl border-0 bg-gradient-to-r from-amber-500 to-amber-600 px-5 text-xs font-semibold text-white shadow-sm shadow-amber-500/25 transition-all hover:from-amber-600 hover:to-amber-700 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-1.5 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Feature disabled alert banner */}
        {!featureEnabled && (
          <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-900 shadow-xs">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-sm">Restaurant Subscription is currently turned OFF</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Restaurants are operating on commission mode until enabled. You can toggle this feature in Super Powers.
                </p>
              </div>
            </div>
            <Link
              to="/admin/food/feature-settings"
              className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-3.5 py-1.5 text-xs font-bold text-amber-800 shadow-xs border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <Sliders className="h-3.5 w-3.5" />
              Open Feature Settings
            </Link>
          </div>
        )}

        {/* Section 1: One-Time Onboarding Fee */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/40 via-white to-transparent px-6 py-4.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100/70 text-amber-700">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">One-Time Onboarding Fee</h2>
                  <p className="text-xs text-slate-500">
                    Collected once when a restaurant completes their registration onboarding step.
                  </p>
                </div>
              </div>
              <div>
                {Number(settings.onboardingFee) > 0 ? (
                  <span className="rounded-full bg-emerald-50 border border-emerald-200/60 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Active • {formatMoney(onboardingFeeTotal)} incl. GST
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                    ₹0 (Free Onboarding)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-12 lg:items-center">
            <div className="space-y-3 lg:col-span-6">
              <Label htmlFor="onboardingFee" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Base Fee Amount (before GST)
              </Label>
              <MoneyInput
                id="onboardingFee"
                value={settings.onboardingFee}
                onChange={(e) => updateSetting("onboardingFee", e.target.value)}
                placeholder="0"
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] font-medium text-slate-400">Quick presets:</span>
                {[0, 499, 999, 1499].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => updateSetting("onboardingFee", amt)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                      Number(settings.onboardingFee) === amt
                        ? "border-amber-400 bg-amber-50 text-amber-800 font-semibold"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {amt === 0 ? "₹0 (Free)" : `₹${amt}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 lg:col-span-6">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Live Restaurant Invoice Preview
              </p>
              {onboardingFeeBase > 0 ? (
                <div className="mt-2.5 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Base Onboarding Fee</span>
                    <span className="font-semibold text-slate-800">{formatMoney(onboardingFeeBase)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST ({gstPercentage}%)</span>
                    <span className="font-semibold text-slate-800">{formatMoney(onboardingFeeGst)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200/80 pt-2 font-bold text-slate-900">
                    <span className="text-amber-800">Total Collected at Onboarding</span>
                    <span className="text-sm text-amber-700 font-bold">{formatMoney(onboardingFeeTotal)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-500">
                  <p className="font-medium text-slate-700">No onboarding fee is charged.</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Restaurants will skip the onboarding payment gateway step directly into review.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Monthly Subscription Plans */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Monthly Postpaid Subscription Tiers</h2>
              <p className="text-xs text-slate-500">
                Invoices are generated at the end of each calendar month according to the restaurant's actual monthly GMV.
              </p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => {
              const meta = PLAN_META[plan.key]
              const Icon = meta.icon
              const planPrice = Number(settings[plan.priceKey]) || 0
              const planGst = Math.round(planPrice * gstRate * 100) / 100
              const planTotal = planPrice + planGst

              return (
                <article
                  key={plan.key}
                  className={`flex flex-col overflow-hidden rounded-2xl border ${meta.borderColor} bg-white shadow-xs transition-all hover:shadow-md`}
                >
                  {/* Card Header */}
                  <div className={`border-b border-slate-100 bg-gradient-to-b ${meta.bgGradient} p-4.5`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${meta.chip}`}>
                          <Icon className={`h-4.5 w-4.5 ${meta.accent}`} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900">{meta.label}</h3>
                          <p className="text-[11px] text-slate-500">{meta.description}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.badgeBg}`}>
                        {meta.badge}
                      </span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="flex flex-1 flex-col justify-between gap-5 p-5">
                    
                    {/* Monthly Price */}
                    <div className="space-y-1.5">
                      <Label htmlFor={plan.priceKey} className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Monthly Base Price
                      </Label>
                      <MoneyInput
                        id={plan.priceKey}
                        value={settings[plan.priceKey]}
                        onChange={(e) => updateSetting(plan.priceKey, e.target.value)}
                        placeholder="0"
                      />
                      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                        <span>Invoice Total (+{gstPercentage}% GST):</span>
                        <span className="font-bold text-slate-800">{formatMoney(planTotal)}</span>
                      </div>
                    </div>

                    {/* GMV Threshold Range */}
                    <div className="space-y-2.5 border-t border-slate-100 pt-4">
                      <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Monthly GMV Threshold Range
                      </Label>
                      
                      <div className={`grid gap-2.5 ${plan.hasMax ? "grid-cols-2" : "grid-cols-1"}`}>
                        <div className="space-y-1">
                          <span className="text-[10px] font-medium text-slate-500">Min GMV</span>
                          <MoneyInput
                            id={plan.minKey}
                            value={settings[plan.minKey]}
                            onChange={(e) => updateSetting(plan.minKey, e.target.value)}
                            placeholder="0"
                          />
                        </div>

                        {plan.hasMax && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-medium text-slate-500">Max GMV</span>
                            <MoneyInput
                              id={plan.maxKey}
                              value={settings[plan.maxKey]}
                              onChange={(e) => updateSetting(plan.maxKey, e.target.value)}
                              placeholder="0"
                            />
                          </div>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400">
                        {plan.hasMax
                          ? `Applies when monthly sales fall between ${formatMoney(settings[plan.minKey])} and ${formatMoney(settings[plan.maxKey])}.`
                          : `Applies to all monthly sales exceeding ${formatMoney(settings[plan.minKey])}.`}
                      </p>
                    </div>

                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* Section 3: Postpaid Billing Workflow Guide */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-3 text-slate-800">
            <HelpCircle className="h-4.5 w-4.5 text-amber-500" />
            <h3 className="text-sm font-bold">How Postpaid Subscription Billing Works</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white mb-2">
                1
              </span>
              <h4 className="font-bold text-slate-800 mb-1">Calendar-Month Closing</h4>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                At the end of every calendar month, the system sums delivered order GMV for each active restaurant.
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white mb-2">
                2
              </span>
              <h4 className="font-bold text-slate-800 mb-1">Automated Tier Matching</h4>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                The restaurant is matched to the appropriate plan tier (Starter, Growth, or Premium) based on GMV thresholds.
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white mb-2">
                3
              </span>
              <h4 className="font-bold text-slate-800 mb-1">Invoice Settlement</h4>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                Plan fee + 18% GST is invoiced. The amount is locked/deducted from their restaurant wallet or settled manually.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom Save Bar */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs text-slate-500">
            Ensure GMV ranges do not overlap between tiers before saving.
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-10 cursor-pointer rounded-xl border-0 bg-gradient-to-r from-amber-500 to-amber-600 px-6 text-xs font-semibold text-white shadow-sm shadow-amber-500/25 transition-all hover:from-amber-600 hover:to-amber-700 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>

      </div>
    </div>
  )
}

export default SubscriptionSettings
