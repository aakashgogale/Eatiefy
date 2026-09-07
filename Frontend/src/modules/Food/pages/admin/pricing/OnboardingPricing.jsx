import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Edit, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const TABS = [
  { id: "pricing", label: "Pricing Rules" },
  { id: "offers", label: "Promotional Offers" },
  { id: "payments", label: "Onboarding Payments" },
]

const GLOBAL_ZONE = "global"

const emptyRule = () => ({
  id: "",
  zoneId: GLOBAL_ZONE,
  restaurantType: "",
  basePrice: "",
  isActive: true,
  notes: "",
})

const emptyOffer = () => ({
  id: "",
  name: "",
  zoneId: "",
  restaurantType: "",
  originalPrice: "",
  offerPrice: "",
  maxRedemptions: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
})

const money = (value, currency = "INR") => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return `${currency === "INR" ? "₹" : `${currency} `}${n.toLocaleString("en-IN")}`
}

const toDateTimeLocal = (value) => {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDate = (value) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

const statusPill = (active) =>
  active
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-600 border-slate-200"

const paymentStatusPill = (status) => {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (status === "failed") return "bg-rose-50 text-rose-700 border-rose-200"
  if (status === "cancelled") return "bg-amber-50 text-amber-700 border-amber-200"
  return "bg-slate-100 text-slate-600 border-slate-200"
}

const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-600">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
  </label>
)

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"

/**
 * Admin console for the one-time restaurant onboarding fee: zone/type pricing rules,
 * limited promotional offers, and a read-only review of collected payments.
 *
 * Everything here is configuration only — the payable amount is always recalculated
 * by the backend at checkout, and historical payments keep their own price snapshot.
 */
export default function OnboardingPricing() {
  const [tab, setTab] = useState("pricing")
  const [bootstrap, setBootstrap] = useState({ restaurantTypes: [], zones: [] })
  const [rules, setRules] = useState([])
  const [offers, setOffers] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [ruleForm, setRuleForm] = useState(emptyRule)
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [offerForm, setOfferForm] = useState(emptyOffer)
  const [showOfferForm, setShowOfferForm] = useState(false)

  const zoneNameById = useMemo(() => {
    const map = new Map()
    bootstrap.zones.forEach((zone) => map.set(zone.id, zone.name))
    return map
  }, [bootstrap.zones])

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true)
      else setLoading(true)

      const [bootstrapRes, rulesRes, offersRes, paymentsRes] = await Promise.all([
        adminAPI.getOnboardingPricingBootstrap(),
        adminAPI.getOnboardingPricingRules(),
        adminAPI.getOnboardingOffers(),
        adminAPI.getOnboardingPayments({ limit: 50 }),
      ])

      setBootstrap(bootstrapRes?.data?.data || { restaurantTypes: [], zones: [] })
      setRules(rulesRes?.data?.data?.rules || [])
      setOffers(offersRes?.data?.data?.offers || [])
      setPayments(paymentsRes?.data?.data?.payments || [])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load onboarding pricing")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ---- Pricing rules ----

  const openRuleForm = (rule = null) => {
    setRuleForm(
      rule
        ? {
            id: rule.id,
            zoneId: rule.zoneId || GLOBAL_ZONE,
            restaurantType: rule.restaurantType,
            basePrice: String(rule.basePrice ?? ""),
            isActive: rule.isActive,
            notes: rule.notes || "",
          }
        : emptyRule(),
    )
    setShowRuleForm(true)
  }

  const saveRule = async () => {
    if (!ruleForm.restaurantType) return toast.error("Select a restaurant type")
    if (ruleForm.basePrice === "" || Number(ruleForm.basePrice) < 0) {
      return toast.error("Enter a valid base price")
    }
    try {
      setSaving(true)
      const body = {
        zoneId: ruleForm.zoneId,
        restaurantType: ruleForm.restaurantType,
        basePrice: Number(ruleForm.basePrice),
        isActive: ruleForm.isActive,
        notes: ruleForm.notes,
      }
      if (ruleForm.id) await adminAPI.updateOnboardingPricingRule(ruleForm.id, body)
      else await adminAPI.createOnboardingPricingRule(body)
      toast.success(ruleForm.id ? "Pricing rule updated" : "Pricing rule created")
      setShowRuleForm(false)
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the pricing rule")
    } finally {
      setSaving(false)
    }
  }

  const toggleRule = async (rule) => {
    try {
      await adminAPI.toggleOnboardingPricingRule(rule.id, !rule.isActive)
      toast.success(rule.isActive ? "Rule disabled" : "Rule enabled")
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not update the rule")
    }
  }

  const deleteRule = async (rule) => {
    if (!window.confirm(`Delete the ${rule.restaurantTypeLabel} rule for ${rule.zoneName}?`)) return
    try {
      await adminAPI.deleteOnboardingPricingRule(rule.id)
      toast.success("Pricing rule deleted")
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not delete the rule")
    }
  }

  // ---- Offers ----

  const openOfferForm = (offer = null) => {
    setOfferForm(
      offer
        ? {
            id: offer.id,
            name: offer.name,
            zoneId: offer.zoneId || "",
            restaurantType: offer.restaurantType,
            originalPrice: String(offer.originalPrice ?? ""),
            offerPrice: String(offer.offerPrice ?? ""),
            maxRedemptions: String(offer.maxRedemptions ?? ""),
            startsAt: toDateTimeLocal(offer.startsAt),
            endsAt: toDateTimeLocal(offer.endsAt),
            isActive: offer.isActive,
          }
        : emptyOffer(),
    )
    setShowOfferForm(true)
  }

  const saveOffer = async () => {
    if (!offerForm.name.trim()) return toast.error("Give the offer a name")
    if (!offerForm.zoneId) return toast.error("Select a zone")
    if (!offerForm.restaurantType) return toast.error("Select a restaurant type")
    if (Number(offerForm.offerPrice) >= Number(offerForm.originalPrice)) {
      return toast.error("Offer price must be lower than the original price")
    }
    if (!offerForm.startsAt || !offerForm.endsAt) return toast.error("Set the start and end date")

    try {
      setSaving(true)
      const body = {
        name: offerForm.name.trim(),
        zoneId: offerForm.zoneId,
        restaurantType: offerForm.restaurantType,
        originalPrice: Number(offerForm.originalPrice),
        offerPrice: Number(offerForm.offerPrice),
        maxRedemptions: Number(offerForm.maxRedemptions),
        startsAt: new Date(offerForm.startsAt).toISOString(),
        endsAt: new Date(offerForm.endsAt).toISOString(),
        isActive: offerForm.isActive,
      }
      if (offerForm.id) await adminAPI.updateOnboardingOffer(offerForm.id, body)
      else await adminAPI.createOnboardingOffer(body)
      toast.success(offerForm.id ? "Offer updated" : "Offer created")
      setShowOfferForm(false)
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the offer")
    } finally {
      setSaving(false)
    }
  }

  const toggleOffer = async (offer) => {
    try {
      await adminAPI.toggleOnboardingOffer(offer.id, !offer.isActive)
      toast.success(offer.isActive ? "Offer disabled" : "Offer enabled")
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not update the offer")
    }
  }

  const deleteOffer = async (offer) => {
    if (!window.confirm(`Delete the offer "${offer.name}"?`)) return
    try {
      await adminAPI.deleteOnboardingOffer(offer.id)
      toast.success("Offer deleted")
      await load({ silent: true })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not delete the offer")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Restaurant Onboarding Pricing</h1>
          <p className="text-xs text-slate-500">
            One-time joining fee per zone and restaurant type, plus limited promotional offers.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => load({ silent: true })}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === item.id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ---------- Pricing rules ---------- */}
      {tab === "pricing" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              A zone rule wins over the “All zones” default. Without either, the built-in base price
              applies.
            </p>
            <Button onClick={() => openRuleForm()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add pricing rule
            </Button>
          </div>

          {showRuleForm && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  {ruleForm.id ? "Edit pricing rule" : "New pricing rule"}
                </h2>
                <button type="button" onClick={() => setShowRuleForm(false)}>
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Zone">
                  <select
                    className={inputClass}
                    value={ruleForm.zoneId}
                    onChange={(e) => setRuleForm({ ...ruleForm, zoneId: e.target.value })}
                  >
                    <option value={GLOBAL_ZONE}>All zones (default)</option>
                    {bootstrap.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Restaurant type">
                  <select
                    className={inputClass}
                    value={ruleForm.restaurantType}
                    onChange={(e) => setRuleForm({ ...ruleForm, restaurantType: e.target.value })}
                  >
                    <option value="">Select type</option>
                    {bootstrap.restaurantTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label} (default {money(type.defaultBasePrice)})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Base price (₹)">
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={ruleForm.basePrice}
                    onChange={(e) => setRuleForm({ ...ruleForm, basePrice: e.target.value })}
                  />
                </Field>
                <Field label="Status">
                  <select
                    className={inputClass}
                    value={ruleForm.isActive ? "active" : "inactive"}
                    onChange={(e) =>
                      setRuleForm({ ...ruleForm, isActive: e.target.value === "active" })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={saveRule} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save rule
                </Button>
                <Button variant="outline" onClick={() => setShowRuleForm(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Restaurant type</th>
                  <th className="px-4 py-3">Base price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No pricing rules yet — the built-in default prices apply.
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {rule.zoneId ? zoneNameById.get(rule.zoneId) || rule.zoneName : "All zones (default)"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{rule.restaurantTypeLabel}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {money(rule.basePrice, rule.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusPill(rule.isActive)}`}
                        >
                          {rule.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openRuleForm(rule)}
                            className="rounded-lg bg-blue-50 p-2 text-blue-700"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleRule(rule)}
                            className="rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700"
                          >
                            {rule.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRule(rule)}
                            className="rounded-lg bg-rose-50 p-2 text-rose-700"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Offers ---------- */}
      {tab === "offers" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Slots are consumed only by verified payments; failed or cancelled attempts are
              released automatically.
            </p>
            <Button onClick={() => openOfferForm()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add offer
            </Button>
          </div>

          {showOfferForm && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  {offerForm.id ? "Edit offer" : "New promotional offer"}
                </h2>
                <button type="button" onClick={() => setShowOfferForm(false)}>
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Offer name">
                  <input
                    className={inputClass}
                    placeholder="First 10 Family Restaurants"
                    value={offerForm.name}
                    onChange={(e) => setOfferForm({ ...offerForm, name: e.target.value })}
                  />
                </Field>
                <Field label="Zone">
                  <select
                    className={inputClass}
                    value={offerForm.zoneId}
                    onChange={(e) => setOfferForm({ ...offerForm, zoneId: e.target.value })}
                  >
                    <option value="">Select zone</option>
                    {bootstrap.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Restaurant type">
                  <select
                    className={inputClass}
                    value={offerForm.restaurantType}
                    onChange={(e) => setOfferForm({ ...offerForm, restaurantType: e.target.value })}
                  >
                    <option value="">Select type</option>
                    {bootstrap.restaurantTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Max eligible restaurants">
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={offerForm.maxRedemptions}
                    onChange={(e) => setOfferForm({ ...offerForm, maxRedemptions: e.target.value })}
                  />
                </Field>
                <Field label="Original price (₹)">
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={offerForm.originalPrice}
                    onChange={(e) => setOfferForm({ ...offerForm, originalPrice: e.target.value })}
                  />
                </Field>
                <Field label="Offer price (₹)">
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={offerForm.offerPrice}
                    onChange={(e) => setOfferForm({ ...offerForm, offerPrice: e.target.value })}
                  />
                </Field>
                <Field label="Starts at">
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={offerForm.startsAt}
                    onChange={(e) => setOfferForm({ ...offerForm, startsAt: e.target.value })}
                  />
                </Field>
                <Field label="Ends at">
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={offerForm.endsAt}
                    onChange={(e) => setOfferForm({ ...offerForm, endsAt: e.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={saveOffer} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save offer
                </Button>
                <Button variant="outline" onClick={() => setShowOfferForm(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Zone / Type</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Slots</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No promotional offers configured.
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr key={offer.id}>
                      <td className="px-4 py-3 font-medium text-slate-800">{offer.name}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {offer.zoneName || zoneNameById.get(offer.zoneId) || "—"}
                        <span className="block text-[11px] text-slate-500">
                          {offer.restaurantTypeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-400 line-through">{money(offer.originalPrice)}</span>{" "}
                        <span className="font-semibold text-emerald-700">{money(offer.offerPrice)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="font-semibold text-slate-900">{offer.usedSlots}</span> used
                        {offer.heldSlots > 0 && (
                          <span className="block text-[11px] text-amber-600">
                            {offer.heldSlots} in checkout
                          </span>
                        )}
                        <span className="block text-[11px] text-slate-500">
                          {offer.remainingSlots} of {offer.maxRedemptions} left
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-600">
                        {formatDate(offer.startsAt)}
                        <span className="block">→ {formatDate(offer.endsAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusPill(offer.isLive)}`}
                        >
                          {offer.isLive ? "Live" : offer.isActive ? "Scheduled / Exhausted" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openOfferForm(offer)}
                            className="rounded-lg bg-blue-50 p-2 text-blue-700"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleOffer(offer)}
                            className="rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700"
                          >
                            {offer.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteOffer(offer)}
                            className="rounded-lg bg-rose-50 p-2 text-rose-700 disabled:opacity-40"
                            disabled={offer.usedSlots > 0}
                            title={offer.usedSlots > 0 ? "Used offers can only be disabled" : "Delete"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Payments ---------- */}
      {tab === "payments" && (
        <section className="space-y-3">
          <p className="text-xs text-slate-500">
            Historical records keep the price that applied at payment time — later pricing changes
            never rewrite them.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Type / Zone</th>
                  <th className="px-4 py-3">Original</th>
                  <th className="px-4 py-3">Offer</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No onboarding payments yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-800">{payment.restaurantName || "—"}</span>
                        <span className="block text-[11px] text-slate-500">
                          {payment.ownerName} · {payment.ownerPhone}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {payment.restaurantTypeLabel}
                        <span className="block text-[11px] text-slate-500">{payment.zoneName || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {money(payment.originalPrice, payment.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {payment.offerPrice != null ? (
                          <>
                            {money(payment.offerPrice, payment.currency)}
                            <span className="block text-[11px] text-emerald-700">{payment.offerName}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {money(payment.finalAmount, payment.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${paymentStatusPill(payment.status)}`}
                        >
                          {payment.status}
                        </span>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {formatDate(payment.paidAt || payment.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-mono text-[11px] text-slate-700">
                          {payment.transactionReference || "—"}
                        </span>
                        {payment.confirmedVia && (
                          <span className="text-[11px] text-slate-400">via {payment.confirmedVia}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
