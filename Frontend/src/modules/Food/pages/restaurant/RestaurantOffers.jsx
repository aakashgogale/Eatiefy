import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, BadgePercent, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { restaurantItemOffersAPI } from "@food/api/restaurantItemOffers"

const DAYS = [
  { value: "Monday", short: "Mon" },
  { value: "Tuesday", short: "Tue" },
  { value: "Wednesday", short: "Wed" },
  { value: "Thursday", short: "Thu" },
  { value: "Friday", short: "Fri" },
  { value: "Saturday", short: "Sat" },
  { value: "Sunday", short: "Sun" },
]

const APPLICABLE_OPTIONS = [
  { value: "entire_menu", label: "Entire menu" },
  { value: "category", label: "Categories" },
  { value: "specific_items", label: "Specific items" },
]

const STATUS = {
  pending_approval: { label: "Pending Admin Approval", className: "border-amber-200 bg-amber-50 text-amber-700" },
  rejected: { label: "Rejected by Admin", className: "border-rose-200 bg-rose-50 text-rose-700" },
  live: { label: "Live", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  scheduled: { label: "Scheduled", className: "border-sky-200 bg-sky-50 text-sky-700" },
  off_hours: { label: "Outside its hours", className: "border-amber-200 bg-amber-50 text-amber-700" },
  expired: { label: "Expired", className: "border-slate-200 bg-slate-100 text-slate-500" },
  paused: { label: "Off", className: "border-slate-200 bg-slate-100 text-slate-500" },
}

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#2E7D52]"

/** Date -> value for <input type="datetime-local"> in the device's time. */
const toLocalInput = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

const emptyForm = () => {
  const now = new Date()
  return {
    id: "",
    title: "",
    description: "",
    applicableTo: "entire_menu",
    itemIds: [],
    categoryIds: [],
    discountType: "percentage",
    discountValue: "",
    minOrderValue: "",
    validFrom: toLocalInput(now),
    validTill: toLocalInput(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    activeDays: [],
    slotStart: "",
    slotEnd: "",
    isActive: true,
  }
}

const formFromOffer = (offer) => ({
  id: offer.id,
  title: offer.title || "",
  description: offer.description || "",
  applicableTo: offer.applicableTo,
  itemIds: offer.itemIds || [],
  categoryIds: offer.categoryIds || [],
  discountType: offer.discountType,
  discountValue: String(offer.discountValue ?? ""),
  minOrderValue: offer.minOrderValue ? String(offer.minOrderValue) : "",
  validFrom: toLocalInput(offer.validFrom),
  validTill: toLocalInput(offer.validTill),
  activeDays: offer.activeDays || [],
  slotStart: offer.activeTimeSlot?.start || "",
  slotEnd: offer.activeTimeSlot?.end || "",
  isActive: offer.isActive !== false,
})

/** First problem with the form, or "" — the server re-validates everything. */
const validateForm = (form) => {
  if (form.title.trim().length < 3) return "Title must be at least 3 characters"
  const value = Number(form.discountValue)
  if (!(value > 0)) return "Enter a discount value above 0"
  if (form.discountType === "percentage" && value > 100) return "Percentage discount cannot be more than 100"
  if (form.minOrderValue !== "" && !(Number(form.minOrderValue) >= 0)) return "Minimum order value cannot be negative"
  if (form.applicableTo === "specific_items" && form.itemIds.length === 0) return "Select at least one item"
  if (form.applicableTo === "category" && form.categoryIds.length === 0) return "Select at least one category"
  const from = new Date(form.validFrom)
  const till = new Date(form.validTill)
  if (Number.isNaN(from.getTime()) || Number.isNaN(till.getTime())) return "Set valid from and valid till"
  if (till <= from) return "Valid till must be after valid from"
  if (Boolean(form.slotStart) !== Boolean(form.slotEnd)) return "Set both start and end time, or leave both empty"
  if (form.slotStart && form.slotStart === form.slotEnd) return "Start and end time cannot be the same"
  return ""
}

const toPayload = (form) => ({
  title: form.title.trim(),
  description: form.description.trim(),
  applicableTo: form.applicableTo,
  itemIds: form.applicableTo === "specific_items" ? form.itemIds : [],
  categoryIds: form.applicableTo === "category" ? form.categoryIds : [],
  discountType: form.discountType,
  discountValue: Number(form.discountValue),
  minOrderValue: form.minOrderValue === "" ? 0 : Number(form.minOrderValue),
  validFrom: new Date(form.validFrom).toISOString(),
  validTill: new Date(form.validTill).toISOString(),
  activeDays: form.activeDays,
  activeTimeSlot: { start: form.slotStart, end: form.slotEnd },
  isActive: form.isActive,
})

const describeTargets = (offer, options) => {
  if (offer.applicableTo === "entire_menu") return "Entire menu"
  if (offer.applicableTo === "category") {
    const names = offer.categoryIds.map((id) => options.categories.find((c) => c.id === id)?.name).filter(Boolean)
    return names.length ? `Categories: ${names.join(", ")}` : `${offer.categoryIds.length} categories`
  }
  const names = offer.itemIds.map((id) => options.items.find((i) => i.id === id)?.name).filter(Boolean)
  return names.length <= 2 && names.length ? `Items: ${names.join(", ")}` : `${offer.itemIds.length} items`
}

const describeSchedule = (offer) => {
  const parts = [`${formatDateTime(offer.validFrom)} – ${formatDateTime(offer.validTill)}`]
  if (offer.activeDays?.length) {
    parts.push(offer.activeDays.map((day) => DAYS.find((d) => d.value === day)?.short || day).join(", "))
  }
  if (offer.activeTimeSlot?.start && offer.activeTimeSlot?.end) {
    parts.push(`${offer.activeTimeSlot.start}–${offer.activeTimeSlot.end}`)
  }
  return parts.join(" · ")
}

const errorMessage = (error, fallback) => error?.response?.data?.message || fallback

/**
 * Restaurant dashboard: create and manage menu offers. Discounts are applied at
 * checkout by the server, funded from the restaurant's own item price.
 */
export default function RestaurantOffers() {
  const goBack = useRestaurantBackNavigation()
  const [offers, setOffers] = useState([])
  const [options, setOptions] = useState({ items: [], categories: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState({})
  const busyRef = useRef(new Set())
  const loadSeqRef = useRef(0)
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [itemSearch, setItemSearch] = useState("")

  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeqRef.current
    if (silent) setRefreshing(true)
    else setLoading(true)
    setLoadError("")
    try {
      const [offersRes, optionsRes] = await Promise.all([
        restaurantItemOffersAPI.list({ limit: 100 }),
        restaurantItemOffersAPI.getOptions(),
      ])
      if (seq !== loadSeqRef.current) return
      setOffers(offersRes?.data?.data?.offers || [])
      setOptions({
        items: optionsRes?.data?.data?.items || [],
        categories: optionsRes?.data?.data?.categories || [],
      })
    } catch (error) {
      if (seq !== loadSeqRef.current) return
      setLoadError(errorMessage(error, "Could not load your offers"))
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const replaceOffer = (offer) => setOffers((prev) => prev.map((item) => (item.id === offer.id ? offer : item)))
  const dropOffer = (id) => setOffers((prev) => prev.filter((item) => item.id !== id))

  /** One action per offer at a time; the row is settled from the server's reply. */
  const runRowAction = async (id, action, request, onSuccess) => {
    if (busyRef.current.has(id)) return
    busyRef.current.add(id)
    setBusy((prev) => ({ ...prev, [id]: action }))
    try {
      onSuccess(await request())
    } catch (error) {
      if (error?.response?.status === 404) {
        dropOffer(id)
        toast.error("This offer no longer exists")
      } else {
        toast.error(errorMessage(error, "Something went wrong. Please try again."))
      }
    } finally {
      busyRef.current.delete(id)
      setBusy(({ [id]: _done, ...rest }) => rest)
    }
  }

  const toggleOffer = (offer) =>
    runRowAction(offer.id, "toggle", () => restaurantItemOffersAPI.setActive(offer.id, !offer.isActive), (res) => {
      const updated = res?.data?.data?.offer
      if (updated) replaceOffer(updated)
      toast.success(updated?.isActive ? "Offer turned on" : "Offer turned off")
    })

  const deleteOffer = (offer) => {
    if (!window.confirm(`Delete the offer "${offer.title}"?`)) return
    runRowAction(offer.id, "delete", () => restaurantItemOffersAPI.remove(offer.id), () => {
      dropOffer(offer.id)
      toast.success("Offer deleted")
    })
  }

  const openCreate = () => {
    setForm(emptyForm())
    setItemSearch("")
    setShowForm(true)
  }

  const openEdit = (offer) => {
    setForm(formFromOffer(offer))
    setItemSearch("")
    setShowForm(true)
  }

  const closeForm = () => {
    if (!saving) setShowForm(false)
  }

  const saveOffer = async (event) => {
    event?.preventDefault()
    const problem = validateForm(form)
    if (problem) {
      toast.error(problem)
      return
    }
    const editingId = form.id
    if (editingId && busyRef.current.has(editingId)) return
    setSaving(true)
    if (editingId) busyRef.current.add(editingId)
    try {
      const payload = toPayload(form)
      const res = editingId
        ? await restaurantItemOffersAPI.update(editingId, payload)
        : await restaurantItemOffersAPI.create(payload)
      const saved = res?.data?.data?.offer
      if (saved) {
        if (editingId) replaceOffer(saved)
        else setOffers((prev) => [saved, ...prev])
      }
      toast.success(
        editingId
          ? "Offer updated and submitted for Admin approval"
          : "Offer created and submitted for Admin approval",
      )
      setShowForm(false)
    } catch (error) {
      if (editingId && error?.response?.status === 404) {
        dropOffer(editingId)
        setShowForm(false)
      }
      toast.error(errorMessage(error, "Could not save the offer"))
    } finally {
      if (editingId) busyRef.current.delete(editingId)
      setSaving(false)
    }
  }

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))
  const toggleInList = (field, value) =>
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(value) ? prev[field].filter((v) => v !== value) : [...prev[field], value],
    }))

  const visibleItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase()
    if (!term) return options.items
    return options.items.filter(
      (item) => item.name.toLowerCase().includes(term) || (item.categoryName || "").toLowerCase().includes(term),
    )
  }, [itemSearch, options.items])

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={goBack} className="rounded-full p-1 hover:bg-slate-100" aria-label="Go back">
            <ArrowLeft className="h-5 w-5 text-slate-700" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900">Offers</h1>
            <p className="text-xs text-slate-500">Discounts on your menu, applied automatically at checkout after Admin approval.</p>
          </div>
          <button
            type="button"
            onClick={() => load({ silent: true })}
            disabled={refreshing || loading}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">How offers work</p>
          <p className="mt-2 text-sm text-slate-600">
            When you create or edit an offer, it goes to <strong>Admin for approval</strong>. Once approved, customers see live offers on your menu, and the discount is taken off at checkout automatically.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          disabled={loading || Boolean(loadError)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          <Plus className="h-5 w-5" />
          Add offer
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-rose-900">Could not load offers</p>
            <p className="mt-2 text-sm text-rose-700">{loadError}</p>
            <button
              type="button"
              onClick={() => load()}
              className="mt-5 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white active:scale-95"
            >
              Try again
            </button>
          </div>
        ) : offers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <BadgePercent className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-lg font-semibold text-slate-900">No offers yet</p>
            <p className="mt-2 text-sm text-slate-500">Create an offer to attract more orders.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {offers.map((offer) => {
              const action = busy[offer.id]
              const status = STATUS[offer.status] || STATUS.paused
              const isPending = offer.approvalStatus === "pending"
              const isRejected = offer.approvalStatus === "rejected"
              return (
                <li
                  key={offer.id}
                  aria-busy={Boolean(action)}
                  className={`rounded-2xl border border-slate-200 bg-white p-4 ${action === "delete" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{offer.title}</p>
                      <p className="mt-0.5 text-sm font-bold text-[#2E7D52]">{offer.label}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  {offer.description && <p className="mt-2 text-sm text-slate-600">{offer.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">{describeTargets(offer, options)}</p>
                  <p className="mt-1 text-xs text-slate-500">{describeSchedule(offer)}</p>

                  {isPending && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-800">
                      ⏳ <strong>Pending Admin Approval:</strong> This offer will automatically become available to customers once approved by Admin.
                    </div>
                  )}

                  {isRejected && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                      ❌ <strong>Rejection Reason:</strong> {offer.rejectionReason || "Offer was rejected by admin. You can edit and resubmit."}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={offer.isActive}
                        aria-label={offer.isActive ? "Turn offer off" : "Turn offer on"}
                        onClick={() => toggleOffer(offer)}
                        disabled={Boolean(action)}
                        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${offer.isActive ? "bg-[#2E7D52]" : "bg-slate-300"}`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${offer.isActive ? "left-[22px]" : "left-0.5"}`}
                        />
                      </button>
                      {action === "toggle" ? <Loader2 className="h-4 w-4 animate-spin" /> : offer.isActive ? "On" : "Off"}
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(offer)}
                        disabled={Boolean(action)}
                        className="rounded-xl bg-blue-50 p-2 text-blue-700 disabled:opacity-40"
                        title="Edit offer"
                        aria-label="Edit offer"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOffer(offer)}
                        disabled={Boolean(action)}
                        className="rounded-xl bg-rose-50 p-2 text-rose-700 disabled:opacity-40"
                        title="Delete offer"
                        aria-label="Delete offer"
                      >
                        {action === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40"
              onClick={closeForm}
            />
            <motion.form
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              onSubmit={saveOffer}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit offer" : "New offer"}</h2>
                <button type="button" onClick={closeForm} className="rounded-full p-1 hover:bg-slate-100" aria-label="Close">
                  <X className="h-5 w-5 text-slate-600" />
                </button>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Title
                  <input
                    className={inputClass}
                    value={form.title}
                    maxLength={80}
                    placeholder="e.g. 20% off on all pizzas"
                    onChange={(e) => setField("title", e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Description <span className="font-normal text-slate-400">(optional)</span>
                  <textarea
                    className={inputClass}
                    rows={2}
                    maxLength={300}
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                  />
                </label>

                <div>
                  <p className="text-sm font-medium text-slate-700">Applies to</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {APPLICABLE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setField("applicableTo", option.value)}
                        className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                          form.applicableTo === option.value
                            ? "border-[#2E7D52] bg-[#2E7D52]/10 text-[#1B5E3F]"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {form.applicableTo === "category" && (
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      Categories <span className="font-normal text-slate-400">({form.categoryIds.length} selected)</span>
                    </p>
                    {options.categories.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">Your approved dishes have no categories yet.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {options.categories.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => toggleInList("categoryIds", category.id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              form.categoryIds.includes(category.id)
                                ? "border-[#2E7D52] bg-[#2E7D52] text-white"
                                : "border-slate-300 text-slate-600"
                            }`}
                          >
                            {category.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {form.applicableTo === "specific_items" && (
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      Items <span className="font-normal text-slate-400">({form.itemIds.length} selected)</span>
                    </p>
                    <div className="relative mt-2">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        className={`${inputClass} mt-0 pl-9`}
                        placeholder="Search dishes"
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                      />
                    </div>
                    <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                      {visibleItems.length === 0 ? (
                        <p className="py-4 text-center text-sm text-slate-500">No dishes found</p>
                      ) : (
                        visibleItems.map((item) => (
                          <label key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={form.itemIds.includes(item.id)}
                              onChange={() => toggleInList("itemIds", item.id)}
                              className="h-4 w-4 accent-[#2E7D52]"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{item.name}</span>
                            <span className="text-xs text-slate-500">₹{item.price}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-slate-700">Discount</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { value: "percentage", label: "Percentage (%)" },
                      { value: "flat", label: "Flat amount (₹)" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setField("discountType", option.value)}
                        className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                          form.discountType === option.value
                            ? "border-[#2E7D52] bg-[#2E7D52]/10 text-[#1B5E3F]"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {form.discountType === "percentage"
                      ? "Taken off the price of each eligible dish."
                      : "Taken off the eligible dishes once per order."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-medium text-slate-700">
                    {form.discountType === "percentage" ? "Discount (%)" : "Discount (₹)"}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className={inputClass}
                      value={form.discountValue}
                      onChange={(e) => setField("discountValue", e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Min. order (₹) <span className="font-normal text-slate-400">(optional)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className={inputClass}
                      value={form.minOrderValue}
                      onChange={(e) => setField("minOrderValue", e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Valid from
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={form.validFrom}
                      onChange={(e) => setField("validFrom", e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Valid till
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={form.validTill}
                      onChange={(e) => setField("validTill", e.target.value)}
                    />
                  </label>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Days <span className="font-normal text-slate-400">({form.activeDays.length ? "selected days only" : "every day"})</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DAYS.map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleInList("activeDays", day.value)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          form.activeDays.includes(day.value)
                            ? "border-[#2E7D52] bg-[#2E7D52] text-white"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {day.short}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Time slot <span className="font-normal text-slate-400">(optional — empty means all day)</span>
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <input
                      type="time"
                      aria-label="Start time"
                      className={`${inputClass} mt-0`}
                      value={form.slotStart}
                      onChange={(e) => setField("slotStart", e.target.value)}
                    />
                    <input
                      type="time"
                      aria-label="End time"
                      className={`${inputClass} mt-0`}
                      value={form.slotEnd}
                      onChange={(e) => setField("slotEnd", e.target.value)}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">An end before the start runs overnight (e.g. 22:00–02:00).</p>
                </div>

                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700">
                  Offer is on
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setField("isActive", e.target.checked)}
                    className="h-5 w-5 accent-[#2E7D52]"
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-3 pb-2">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-slate-300 py-3 font-medium text-slate-700 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || Boolean(form.id && busy[form.id])}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2E7D52] py-3 font-semibold text-white disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {form.id ? "Save changes" : "Create offer"}
                </button>
              </div>
            </motion.form>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
