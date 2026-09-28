import { useEffect, useMemo, useState } from "react"
import { BadgePercent } from "lucide-react"
import { restaurantItemOffersAPI } from "@food/api/restaurantItemOffers"

/** Offers start and stop by the clock, so an open menu re-checks every few minutes. */
const REFRESH_MS = 3 * 60 * 1000
const OBJECT_ID = /^[a-f\d]{24}$/i

/**
 * Live restaurant-run offers for a menu. Display only: checkout recalculates every
 * discount on the server, so a stale badge can never change what is charged.
 *
 * @param {Array<string|undefined|null>} candidateIds ids the page knows the restaurant by;
 *   the first valid ObjectId is used.
 * @returns {{ offers: object[], offersForItem: (itemId: string) => object[] }}
 */
export function useRestaurantItemOffers(candidateIds = []) {
  const restaurantId = candidateIds.map((id) => String(id || "").trim()).find((id) => OBJECT_ID.test(id)) || ""
  const [offers, setOffers] = useState([])

  useEffect(() => {
    if (!restaurantId) {
      setOffers([])
      return undefined
    }
    let cancelled = false
    const controller = new AbortController()
    const fetchOffers = async () => {
      try {
        const res = await restaurantItemOffersAPI.getLive(restaurantId, { signal: controller.signal })
        if (!cancelled) setOffers(res?.data?.data?.offers || [])
      } catch {
        // Offers are an extra: a failed fetch simply shows none.
        if (!cancelled) setOffers([])
      }
    }
    fetchOffers()
    const timer = setInterval(fetchOffers, REFRESH_MS)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [restaurantId])

  const offersForItem = useMemo(() => {
    const byItem = new Map()
    const menuWide = offers.filter((offer) => offer.allItems)
    offers.forEach((offer) => {
      ;(offer.itemIds || []).forEach((id) => {
        if (!byItem.has(id)) byItem.set(id, [])
        byItem.get(id).push(offer)
      })
    })
    return (itemId) => [...(byItem.get(String(itemId || "")) || []), ...menuWide]
  }, [offers])

  return { offers, offersForItem }
}

/** Small tag under a dish's price, e.g. "20% OFF". Renders nothing when no offer covers it. */
export function ItemOfferBadge({ offers = [], className = "" }) {
  if (!offers.length) return null
  const [first] = offers
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 ${className}`}
      title={offers.map((offer) => `${offer.title}: ${offer.label}`).join("\n")}
    >
      <BadgePercent className="h-3 w-3" />
      {first.label}
      {offers.length > 1 && <span className="font-semibold">+{offers.length - 1}</span>}
    </span>
  )
}

/**
 * Cart bill line under "Item Total": what the restaurant's offers saved. The saving is
 * already inside the server's item total, so this only explains it — it is never
 * subtracted again.
 */
export function CartRestaurantOfferSavings({ pricing, loading = false, currencySymbol = "₹" }) {
  const saved = Number(pricing?.restaurantOfferDiscount) || 0
  if (loading || !(saved > 0)) return null
  const before = Number(pricing?.itemTotalBeforeOffers)
  const titles = (pricing?.restaurantOffers || []).map((offer) => offer.title || offer.label).filter(Boolean)
  return (
    <div className="-mt-1.5 flex justify-between gap-3 text-xs text-[#1F6B45] dark:text-emerald-400">
      <span className="flex min-w-0 items-center gap-1">
        <BadgePercent className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{titles.length ? titles.join(", ") : "Restaurant offer"}</span>
      </span>
      <span className="shrink-0 font-medium">
        {Number.isFinite(before) && before > 0 && (
          <span className="mr-1.5 text-gray-400 line-through">
            {currencySymbol}
            {before.toFixed(2)}
          </span>
        )}
        You save {currencySymbol}
        {saved.toFixed(2)}
      </span>
    </div>
  )
}

const formatAmount = (value) => {
  const n = Number(value) || 0
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toFixed(2)
}

/**
 * Zomato-style offer status in the cart, from the server's quote:
 * "Flat ₹30 OFF applied · You save ₹30" and/or "Add ₹49 more to get Flat ₹30 OFF"
 * with a progress bar. Renders nothing when the restaurant has no live offer.
 */
export function CartRestaurantOfferProgress({ pricing, currencySymbol = "₹" }) {
  if (!pricing) return null
  const applied = Array.isArray(pricing.restaurantOffers) ? pricing.restaurantOffers : []
  const saved = Number(pricing.restaurantOfferDiscount) || 0
  const next = Array.isArray(pricing.restaurantOfferHints) ? pricing.restaurantOfferHints[0] : null
  const showApplied = applied.length > 0 && saved > 0
  if (!showApplied && !next) return null

  const itemTotal = Number(pricing.itemTotalBeforeOffers) || 0
  const progress = next?.minOrderValue > 0 ? Math.min(100, Math.max(0, (itemTotal / next.minOrderValue) * 100)) : 0

  return (
    <div className="space-y-2 px-4 pb-3 md:px-6" aria-live="polite">
      {showApplied && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-900/20">
          <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
              {applied.map((offer) => offer.label).join(" + ")} applied
            </p>
            <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
              You save {currencySymbol}
              {formatAmount(saved)}
              {applied.length === 1 && applied[0].title ? ` · ${applied[0].title}` : ""}
            </p>
          </div>
        </div>
      )}
      {next && (
        <div className="rounded-xl border border-dashed border-emerald-300 bg-white px-3 py-2.5 dark:border-emerald-800 dark:bg-transparent">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Add {currencySymbol}
            {formatAmount(next.amountNeeded)} more to get{" "}
            <span className="font-bold text-emerald-700 dark:text-emerald-400">{next.headline || next.label}</span>
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            On orders above {currencySymbol}
            {formatAmount(next.minOrderValue)}
            {next.title ? ` · ${next.title}` : ""}
          </p>
        </div>
      )}
    </div>
  )
}

/** Horizontal list of the restaurant's live offers, shown above its menu. */
export function RestaurantOffersStrip({ offers = [] }) {
  if (!offers.length) return null
  return (
    <div className="flex gap-3 overflow-x-auto pb-1" aria-label="Restaurant offers">
      {offers.map((offer) => (
        <div
          key={offer.id}
          className="flex min-w-55 shrink-0 items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-900/20"
        >
          <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{offer.label}</p>
            <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">{offer.title}</p>
            {offer.activeTimeSlot?.start && offer.activeTimeSlot?.end && (
              <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80">
                {offer.activeTimeSlot.start}–{offer.activeTimeSlot.end}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
