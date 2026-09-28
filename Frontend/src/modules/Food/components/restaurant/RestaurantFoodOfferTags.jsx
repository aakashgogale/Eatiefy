import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BadgePercent } from "lucide-react"
import { restaurantItemOffersAPI } from "@food/api/restaurantItemOffers"

/** Where each offer stands, as the restaurant sees it on a dish. Expired/rejected ones are not shown. */
const STATUS_TAGS = {
  live: { text: "Live", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  pending_approval: { text: "Awaiting approval", className: "bg-amber-50 text-amber-700 border-amber-100" },
  scheduled: { text: "Scheduled", className: "bg-sky-50 text-sky-700 border-sky-100" },
  off_hours: { text: "Outside its hours", className: "bg-sky-50 text-sky-700 border-sky-100" },
  paused: { text: "Off", className: "bg-slate-50 text-slate-500 border-slate-200" },
}

const coversFood = (offer, food) => {
  if (offer.applicableTo === "entire_menu") return true
  if (offer.applicableTo === "specific_items") return (offer.itemIds || []).includes(String(food?.id || ""))
  if (offer.applicableTo === "category") return Boolean(food?.categoryId) && (offer.categoryIds || []).includes(String(food.categoryId))
  return false
}

/**
 * The restaurant's own offers, for tagging dishes on its dashboard. Display only:
 * whether an offer reaches customers is decided by admin approval and at checkout.
 *
 * @returns {(food: { id: string, categoryId?: string }) => object[]} offers covering a dish
 */
export function useOwnRestaurantOffers() {
  const [offers, setOffers] = useState([])

  useEffect(() => {
    let cancelled = false
    restaurantItemOffersAPI
      .list({ limit: 100 })
      .then((res) => {
        if (!cancelled) setOffers((res?.data?.data?.offers || []).filter((offer) => STATUS_TAGS[offer.status]))
      })
      .catch(() => {
        // Tags are informational; without them the inventory works exactly as before.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return useCallback((food) => offers.filter((offer) => coversFood(offer, food)), [offers])
}

/** Offer chips under a dish, e.g. "20% OFF · Live"; tapping opens the Offers page. */
export function RestaurantFoodOfferTags({ offers = [] }) {
  const navigate = useNavigate()
  if (!offers.length) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {offers.map((offer) => {
        const tag = STATUS_TAGS[offer.status]
        return (
          <button
            key={offer.id}
            type="button"
            onClick={() => navigate("/food/restaurant/offers")}
            title={offer.title}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-wider shadow-sm ${tag.className}`}
          >
            <BadgePercent className="h-3 w-3" />
            {offer.label} · {tag.text}
          </button>
        )
      })}
    </div>
  )
}
