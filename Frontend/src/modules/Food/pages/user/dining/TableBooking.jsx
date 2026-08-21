import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, CheckCircle2, ChevronRight, UtensilsCrossed } from "lucide-react"
import { Button } from "@food/components/ui/button"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { diningAPI, restaurantAPI } from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import Loader from "@food/components/Loader"
import { toast } from "sonner"

const BOOKING_DRAFT_KEY = "food_dining_booking_draft_v1"

const buildDates = (count = 7) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + index)
    return date
  })

const formatTimeValue = (value) => {
  if (!value) return null
  if (/[ap]m/i.test(value)) return value.toUpperCase()
  const date = new Date(`2000-01-01T${String(value).padStart(5, "0")}`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
}

const parseTimeToMinutes = (value) => {
  if (!value) return null
  const raw = String(value).trim()

  const hhmmMatch = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmmMatch) {
    return Number(hhmmMatch[1]) * 60 + Number(hhmmMatch[2])
  }

  const meridiemMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (!meridiemMatch) return null

  let hour = Number(meridiemMatch[1])
  const minute = Number(meridiemMatch[2] || 0)
  const meridiem = meridiemMatch[3].toUpperCase()

  if (meridiem === "PM" && hour !== 12) hour += 12
  if (meridiem === "AM" && hour === 12) hour = 0

  return hour * 60 + minute
}

const getDayName = (date) => date.toLocaleDateString("en-US", { weekday: "long" })

const buildSlots = (timing) => {
  if (!timing || timing.isOpen === false) return []
  const opening = parseTimeToMinutes(timing.openingTime)
  const closing = parseTimeToMinutes(timing.closingTime)
  if (opening === null || closing === null) return []

  const slots = []
  let cursor = opening
  const end = closing > opening ? closing : opening + 360

  while (cursor <= end && slots.length < 20) {
    const hours = Math.floor((cursor % (24 * 60)) / 60)
    const minutes = cursor % 60
    slots.push(formatTimeValue(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`))
    cursor += 30
  }

  return slots
}

const buildFallbackTiming = (restaurant) => {
  const openingTime = String(
    restaurant?.openingTime ||
      restaurant?.diningSettings?.openingTime ||
      "11:00",
  ).trim()
  const closingTime = String(
    restaurant?.closingTime ||
      restaurant?.diningSettings?.closingTime ||
      "23:00",
  ).trim()

  return {
    isOpen: true,
    openingTime,
    closingTime,
  }
}

const getMealPeriod = (slot) => {
  if (!slot) return "all"
  const normalized = String(slot).toUpperCase()
  const match = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/)
  if (!match) return "all"

  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]

  if (meridiem === "PM" && hour !== 12) hour += 12
  if (meridiem === "AM" && hour === 12) hour = 0

  const totalMinutes = hour * 60 + minute
  if (totalMinutes < 16 * 60 + 30) return "lunch"
  return "dinner"
}

export default function TableBooking() {
  const { slug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()

  const [restaurant, setRestaurant] = useState(location.state?.restaurant || null)
  const [loading, setLoading] = useState(!location.state?.restaurant)
  const [outletTimings, setOutletTimings] = useState({})
  const [selectedGuests, setSelectedGuests] = useState(location.state?.guestCount || 2)
  const [selectedDate, setSelectedDate] = useState(() => {
    const initial = location.state?.selectedDate ? new Date(location.state.selectedDate) : new Date()
    return Number.isNaN(initial.getTime()) ? new Date() : initial
  })
  const [selectedSlot, setSelectedSlot] = useState(location.state?.selectedTime || null)
  const [selectedMealPeriod, setSelectedMealPeriod] = useState("lunch")

  useEffect(() => {
    const fetchRestaurant = async () => {
      try {
        setLoading(true)
        const response = await diningAPI.getRestaurantBySlug(slug)
        if (response?.data?.success) {
          const apiRestaurant = response?.data?.data?.restaurant || response?.data?.data
          setRestaurant(apiRestaurant || null)

          const restaurantId = apiRestaurant?._id || apiRestaurant?.id || slug
          const timingsResponse = await restaurantAPI.getOutletTimingsByRestaurantId(restaurantId)
          setOutletTimings(timingsResponse?.data?.data?.outletTimings || {})
        }
      } catch {
        setRestaurant(null)
      } finally {
        setLoading(false)
      }
    }

    if (location.state?.restaurant) {
      const restaurantId = location.state.restaurant?._id || location.state.restaurant?.id || slug
      restaurantAPI
        .getOutletTimingsByRestaurantId(restaurantId)
        .then((response) => setOutletTimings(response?.data?.data?.outletTimings || {}))
        .catch(() => setOutletTimings({}))
      setLoading(false)
      return
    }

    fetchRestaurant()
  }, [location.state?.restaurant, slug])

  const dates = useMemo(() => buildDates(7), [])
  const selectedDayTiming = useMemo(() => {
    const fromOutletTimings = outletTimings?.[getDayName(selectedDate)] || null
    if (fromOutletTimings && fromOutletTimings.isOpen !== false) {
      return fromOutletTimings
    }
    return buildFallbackTiming(restaurant)
  }, [outletTimings, selectedDate, restaurant])

  const allSlots = useMemo(() => {
    const generated = buildSlots(selectedDayTiming)
    if (generated.length > 0) return generated
    // Fallback slots if restaurant timings are not parsed
    return [
      "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "4:30 PM",
      "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM", "10:00 PM"
    ]
  }, [selectedDayTiming])

  const filteredSlots = useMemo(
    () => allSlots.filter((slot) => getMealPeriod(slot) === selectedMealPeriod),
    [allSlots, selectedMealPeriod]
  )

  useEffect(() => {
    if (!selectedSlot && filteredSlots.length > 0) {
      setSelectedSlot(filteredSlots[0])
      return
    }

    if (selectedSlot && filteredSlots.length > 0 && !filteredSlots.includes(selectedSlot)) {
      setSelectedSlot(filteredSlots[0])
      return
    }

    if (filteredSlots.length === 0) {
      setSelectedSlot(null)
    }
  }, [filteredSlots, selectedSlot])

  useEffect(() => {
    if (allSlots.length === 0) return
    const hasLunch = allSlots.some((slot) => getMealPeriod(slot) === "lunch")
    const hasDinner = allSlots.some((slot) => getMealPeriod(slot) === "dinner")

    if (selectedMealPeriod === "lunch" && !hasLunch && hasDinner) {
      setSelectedMealPeriod("dinner")
    }
    if (selectedMealPeriod === "dinner" && !hasDinner && hasLunch) {
      setSelectedMealPeriod("lunch")
    }
  }, [allSlots, selectedMealPeriod])

  if (loading) return <Loader />
  if (!restaurant) return <div className="p-6 text-center">Restaurant not found</div>

  const isDiningEnabled = restaurant?.diningSettings?.isEnabled !== false
  const maxAllowedGuests = restaurant?.diningSettings?.maxGuests || 8
  const canProceed = Boolean(isDiningEnabled && restaurant && selectedSlot && selectedDate && selectedGuests)

  const handleProceed = () => {
    if (!isDiningEnabled) {
      toast.error("Dining bookings are currently paused for this restaurant.")
      return
    }
    if (!canProceed) {
      toast.error("Please select date, time, and guests to continue.")
      return
    }

    const bookingDraft = {
      restaurant: {
        _id: restaurant?._id || restaurant?.id || restaurant?.restaurant?._id || restaurant?.restaurant?.id || null,
        id: restaurant?.id || restaurant?._id || restaurant?.restaurant?.id || restaurant?.restaurant?._id || null,
        name: restaurant?.name || restaurant?.restaurantName || "Restaurant",
        restaurantName: restaurant?.restaurantName || restaurant?.name || "Restaurant",
        profileImage: restaurant?.profileImage || restaurant?.restaurant?.profileImage || null,
        image: restaurant?.image || restaurant?.restaurant?.image || restaurant?.profileImage?.url || "",
        location: restaurant?.location || restaurant?.restaurant?.location || null,
        slug: restaurant?.slug || slug || "",
        diningSettings: restaurant?.diningSettings || restaurant?.restaurant?.diningSettings || null,
      },
      guests: selectedGuests,
      date: selectedDate,
      timeSlot: selectedSlot,
      discount: restaurant?.offer || "Flat 20% OFF",
    }

    try {
      sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
    } catch {}

    navigate("/food/user/dining/book-confirmation", { state: bookingDraft })
  }

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f6fb] pb-36">
      {/* Header with Eatiefy Brand Warm Soft Gradient */}
      <div
        style={{
          background: "linear-gradient(180deg, #FFEDD5 0%, #FFF7ED 60%, #F5F6FB 100%)",
        }}
        className="relative overflow-hidden px-4 pb-8 pt-5"
      >
        <div className="relative z-10 mx-auto max-w-md">
          <button
            onClick={goBack}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#25314a] shadow-md hover:bg-slate-50 transition-all active:scale-95"
            title="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="mt-4 text-center">
            <h1 className="text-[32px] font-black tracking-tight text-[#1E293B]">Book a table</h1>
            <p className="mt-1 text-sm font-semibold text-[#64748B]">
              {restaurant.name || restaurant.restaurantName}
            </p>
          </div>
        </div>
      </div>

      {/* Booking Form Cards Container */}
      <div className="mx-auto -mt-2 max-w-md space-y-3.5 px-4">
        {!isDiningEnabled && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 shadow-sm">
            <p className="text-sm font-bold text-amber-900">Dining bookings are paused</p>
            <p className="mt-0.5 text-xs text-amber-800">This restaurant is not currently accepting new reservations.</p>
          </section>
        )}

        {/* 1. Select Number of Guests Card */}
        <section className="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/80">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1E293B]">Select number of guests</h3>
            <span style={{ color: "#EB590E" }} className="text-xs font-extrabold">
              {maxAllowedGuests > 0 ? `${maxAllowedGuests} left` : "Available"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-2.5">
            {Array.from({ length: Math.max(6, maxAllowedGuests) }, (_, i) => i + 1).map((count) => {
              const isSelected = selectedGuests === count
              const isExceeded = count > maxAllowedGuests

              return (
                <button
                  key={`guest-btn-${count}`}
                  disabled={isExceeded}
                  onClick={() => setSelectedGuests(count)}
                  style={
                    isSelected
                      ? {
                          borderColor: "#EB590E",
                          backgroundColor: "#FFF7ED",
                          color: "#EB590E",
                          borderWidth: "2px",
                        }
                      : undefined
                  }
                  className={`h-14 rounded-2xl text-base font-bold transition-all active:scale-95 flex items-center justify-center ${
                    isExceeded
                      ? "border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed opacity-50"
                      : isSelected
                      ? "shadow-sm font-black"
                      : "border border-slate-200/80 bg-white hover:border-slate-300 text-slate-700 hover:bg-slate-50/50"
                  }`}
                >
                  {isExceeded ? "✕" : count}
                </button>
              )
            })}
          </div>
        </section>

        {/* 2. Select Date Card */}
        <section className="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/80">
          <h3 className="text-sm font-bold text-[#1E293B]">Select date</h3>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {dates.slice(0, 3).map((date, index) => {
              const isSelected = selectedDate.toDateString() === date.toDateString()
              const label =
                index === 0
                  ? "Today"
                  : index === 1
                  ? "Tomorrow"
                  : date.toLocaleDateString("en-IN", { weekday: "long" })
              const formattedDate = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })

              return (
                <button
                  key={date.toISOString()}
                  onClick={() => setSelectedDate(date)}
                  style={
                    isSelected
                      ? {
                          borderColor: "#EB590E",
                          backgroundColor: "#FFF7ED",
                          borderWidth: "2px",
                        }
                      : undefined
                  }
                  className={`rounded-2xl border py-3.5 px-2 text-center transition-all active:scale-95 ${
                    isSelected
                      ? "shadow-sm"
                      : "border-slate-200/80 bg-white hover:border-slate-300 text-slate-700"
                  }`}
                >
                  <span
                    style={isSelected ? { color: "#EB590E" } : undefined}
                    className={`block text-xs sm:text-sm ${
                      isSelected ? "font-black" : "font-bold text-slate-700"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold text-[#64748B]">
                    {formattedDate}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 3. Select Time of Day Card */}
        <section className="rounded-3xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/80">
          <h3 className="text-sm font-bold text-[#1E293B]">Select time of day</h3>

          {/* Meal Period Toggle Pills */}
          <div className="mt-3.5 flex gap-2">
            {[
              { id: "lunch", label: "Lunch" },
              { id: "dinner", label: "Dinner" },
            ].map((period) => {
              const isActive = selectedMealPeriod === period.id
              return (
                <button
                  key={period.id}
                  onClick={() => setSelectedMealPeriod(period.id)}
                  style={
                    isActive
                      ? {
                          borderColor: "#EB590E",
                          color: "#EB590E",
                          backgroundColor: "#FFFFFF",
                          borderWidth: "1.5px",
                        }
                      : undefined
                  }
                  className={`rounded-full px-5 py-2 text-xs font-bold transition-all active:scale-95 ${
                    isActive
                      ? "shadow-sm font-black"
                      : "border border-slate-200 bg-[#F8FAFC] text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {period.label}
                </button>
              )
            })}
          </div>

          {/* Time Slots Grid */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {filteredSlots.length === 0 ? (
              <div className="col-span-3 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs font-medium text-slate-500">
                No {selectedMealPeriod} slots available for the selected date.
              </div>
            ) : (
              filteredSlots.map((slot) => {
                const isSelected = selectedSlot === slot
                return (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    style={
                      isSelected
                        ? {
                            borderColor: "#EB590E",
                            backgroundColor: "#FFF7ED",
                            borderWidth: "2px",
                          }
                        : undefined
                    }
                    className={`h-12 rounded-2xl border text-center transition-all active:scale-95 flex items-center justify-center ${
                      isSelected
                        ? "text-[#0F172A] font-black shadow-sm"
                        : "border-slate-200/80 bg-white hover:border-slate-300 text-slate-700 font-bold hover:bg-slate-50/50"
                    }`}
                  >
                    <span
                      style={isSelected ? { color: "#EB590E" } : undefined}
                      className="text-xs sm:text-sm"
                    >
                      {slot}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* Fixed Bottom CTA: Proceed to Confirmation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl shadow-lg">
        <div className="mx-auto max-w-md">
          <button
            disabled={!canProceed}
            onClick={handleProceed}
            style={{
              background: canProceed
                ? "linear-gradient(135deg, #EB590E 0%, #FF6F1E 50%, #DF4A00 100%)"
                : "#CBD5E1",
            }}
            className={`h-14 w-full rounded-2xl text-base sm:text-lg font-black text-white transition-all shadow-md active:scale-95 ${
              canProceed
                ? "shadow-orange-500/25 hover:opacity-95 cursor-pointer"
                : "cursor-not-allowed"
            }`}
          >
            {!isDiningEnabled
              ? "Dining paused"
              : canProceed
              ? "Proceed to confirmation"
              : "Select time to proceed"}
          </button>
        </div>
      </div>
    </AnimatedPage>
  )
}

