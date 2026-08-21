import { useMemo, useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  Calendar,
  Users,
  MapPin,
  Ticket,
  ChevronRight,
  Edit2,
  ShieldCheck,
  Info,
  X,
  Check,
  Clock,
  Sparkles,
  Phone,
  UserCheck,
  AlertCircle
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { diningAPI, authAPI } from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { toast } from "sonner"
import Loader from "@food/components/Loader"

const BOOKING_DRAFT_KEY = "food_dining_booking_draft_v1"

const PRESET_REQUEST_CHIPS = [
  { id: "window", label: "🪟 Window Table" },
  { id: "quiet", label: "🤫 Quiet Corner" },
  { id: "celebration", label: "🎂 Birthday / Anniversary" },
  { id: "highchair", label: "👶 Baby High Chair" },
  { id: "nonsmoking", label: "🚭 Non-Smoking Area" },
  { id: "candlelight", label: "🕯️ Romantic Setup" },
]

export default function TableBookingConfirmation() {
  const location = useLocation()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()

  const fallbackDraft = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [])

  const resolvedState = location.state || fallbackDraft || {}
  const { restaurant, guests, date, timeSlot, discount } = resolvedState

  // State
  const [specialRequest, setSpecialRequest] = useState("")
  const [draftRequestText, setDraftRequestText] = useState("")
  const [selectedChips, setSelectedChips] = useState([])

  const [user, setUser] = useState(null)
  const [guestName, setGuestName] = useState("")
  const [guestPhone, setGuestPhone] = useState("")

  const [editNameInput, setEditNameInput] = useState("")
  const [editPhoneInput, setEditPhoneInput] = useState("")

  const [loading, setLoading] = useState(true)
  const [bookingInProgress, setBookingInProgress] = useState(false)

  // Modals / Sheets
  const [showSpecialRequestModal, setShowSpecialRequestModal] = useState(false)
  const [showModificationModal, setShowModificationModal] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [showEditDetailsModal, setShowEditDetailsModal] = useState(false)

  useEffect(() => {
    if (!restaurant) {
      navigate("/food/user/dining")
      return
    }

    const fetchUser = async () => {
      try {
        const response = await authAPI.getCurrentUser()
        if (response.data.success) {
          const userData =
            response?.data?.data?.user ||
            response?.data?.data ||
            response?.data?.user ||
            null
          setUser(userData)
          const resolvedName = userData?.name || "Guest"
          const resolvedPhone = userData?.phone || userData?.mobile || "6261745842"
          setGuestName(resolvedName)
          setGuestPhone(resolvedPhone)
          setEditNameInput(resolvedName)
          setEditPhoneInput(resolvedPhone)
        }
      } catch (error) {
        setGuestName("Guest User")
        setGuestPhone("6261745842")
        setEditNameInput("Guest User")
        setEditPhoneInput("6261745842")
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [restaurant, navigate])

  const toggleChip = (chipLabel) => {
    if (selectedChips.includes(chipLabel)) {
      setSelectedChips(selectedChips.filter((c) => c !== chipLabel))
    } else {
      setSelectedChips([...selectedChips, chipLabel])
    }
  }

  const handleSaveSpecialRequest = () => {
    const combined = [
      ...selectedChips,
      draftRequestText.trim()
    ].filter(Boolean).join(" • ")

    setSpecialRequest(combined)
    setShowSpecialRequestModal(false)
    if (combined) {
      toast.success("Special request added!")
    }
  }

  const handleClearSpecialRequest = (e) => {
    e.stopPropagation()
    setSpecialRequest("")
    setSelectedChips([])
    setDraftRequestText("")
    toast.info("Special request removed")
  }

  const handleSaveGuestDetails = () => {
    const trimmedName = editNameInput.trim()
    const trimmedPhone = editPhoneInput.trim()

    if (!trimmedName) {
      toast.error("Please enter a valid guest name")
      return
    }
    if (!trimmedPhone || trimmedPhone.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid 10-digit phone number")
      return
    }

    setGuestName(trimmedName)
    setGuestPhone(trimmedPhone)
    setShowEditDetailsModal(false)
    toast.success("Guest details updated")
  }

  const handleModifyBooking = () => {
    setShowModificationModal(false)
    const restaurantSlug = restaurant?.slug || restaurant?._id || restaurant?.id
    navigate(`/food/user/dining/book/${restaurantSlug}`)
  }

  const handleBooking = async () => {
    try {
      setBookingInProgress(true)
      const restaurantId =
        restaurant?._id ||
        restaurant?.id ||
        restaurant?.restaurant?._id ||
        restaurant?.restaurant?.id ||
        restaurant?.restaurantId ||
        null

      if (!restaurantId) {
        toast.error("Unable to proceed. Restaurant ID is missing.")
        return
      }

      const response = await diningAPI.createBooking({
        restaurant: restaurantId,
        restaurantRef: restaurant,
        userRef: user,
        customerName: guestName,
        customerPhone: guestPhone,
        guests,
        date,
        timeSlot,
        specialRequest,
      })

      if (response.data.success) {
        toast.success("Table booked successfully!")
        try {
          sessionStorage.removeItem(BOOKING_DRAFT_KEY)
        } catch {}
        navigate("/food/user/dining/book-success", {
          state: { booking: response.data.data },
        })
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to confirm booking")
    } finally {
      setBookingInProgress(false)
    }
  }

  if (loading) return <Loader />

  const bookingDate = new Date(date)
  const formattedDate = Number.isNaN(bookingDate.getTime())
    ? "Today"
    : bookingDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })

  return (
    <AnimatedPage className="bg-slate-50 min-h-screen pb-28">
      {/* Header with Eatiefy Orange Theme */}
      <div
        style={{
          background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
        }}
        className="text-white px-4 py-4 sticky top-0 z-40 shadow-md"
      >
        <div className="flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-1.5 hover:bg-white/15 rounded-full transition-all active:scale-95"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <p className="font-bold text-sm leading-tight text-white/95">
            Reach the restaurant 15 minutes before your booking time for a hassle-free experience
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {/* Booking Summary Card */}
        <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="bg-orange-50 p-2.5 rounded-2xl flex-shrink-0">
              <Calendar className="w-5 h-5 text-[#EB590E]" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-base">
                {formattedDate} at {timeSlot}
              </p>
              <div className="flex items-center gap-1.5 text-slate-500 text-xs font-semibold mt-0.5">
                <Users className="w-3.5 h-3.5" />
                <span>{guests} guests reserved</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3.5 pt-3.5 border-t border-dashed border-slate-200">
            <div className="bg-orange-50 p-2.5 rounded-2xl flex-shrink-0">
              <MapPin className="w-5 h-5 text-[#EB590E]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-slate-900 text-sm truncate">
                {restaurant.name || restaurant.restaurantName}
              </p>
              <p className="text-slate-500 text-xs mt-0.5 line-clamp-1">
                {typeof restaurant.location === "string"
                  ? restaurant.location
                  : restaurant.location?.formattedAddress ||
                    restaurant.location?.address ||
                    `${restaurant.location?.city || ""}${
                      restaurant.location?.area ? ", " + restaurant.location.area : ""
                    }`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-3.5 border-t border-dashed border-slate-200 text-purple-600">
            <Ticket className="w-4 h-4" />
            <span className="font-extrabold text-xs tracking-wide">
              {discount || "10% Instant Cashback with Eatiefy"}
            </span>
          </div>
        </div>

        {/* 1. Add Special Request Card */}
        <button
          onClick={() => {
            setDraftRequestText(specialRequest ? specialRequest.split(" • ").slice(-1)[0] : "")
            setShowSpecialRequestModal(true)
          }}
          className="w-full bg-white rounded-3xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-orange-200 group"
        >
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            <div className="bg-slate-100 p-2.5 rounded-2xl group-hover:bg-orange-50 transition-colors flex-shrink-0">
              <Info className="w-5 h-5 text-slate-600 group-hover:text-[#EB590E]" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="font-extrabold text-slate-800 text-sm block">
                {specialRequest ? "Special Request Added" : "Add special request"}
              </span>
              {specialRequest ? (
                <p className="text-xs text-[#EB590E] font-medium truncate mt-0.5">
                  {specialRequest}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 font-medium">
                  Window seat, celebration, baby chair & more
                </p>
              )}
            </div>
          </div>

          {specialRequest ? (
            <div
              role="button"
              tabIndex={0}
              onClick={handleClearSpecialRequest}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleClearSpecialRequest(e)}
              className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-rose-500 transition-colors"
              title="Remove request"
            >
              <X className="w-4 h-4" />
            </div>
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-[#EB590E] transition-colors" />
          )}
        </button>

        {/* 2 & 3. Preferences Section (Modification & Cancellation) */}
        <div className="pt-2">
          <div className="flex items-center gap-4 mb-3">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
              Guest Preferences
            </span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <div className="space-y-2.5">
            {/* Modification Available Card */}
            <button
              onClick={() => setShowModificationModal(true)}
              className="w-full bg-white rounded-3xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-orange-200 group"
            >
              <div className="flex items-start gap-3.5">
                <div className="text-[#EB590E] mt-0.5 p-2 rounded-2xl bg-orange-50/70">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-extrabold text-slate-800 text-sm">Modification available</p>
                  <p className="text-xs text-slate-400 mt-0.5">Valid till {timeSlot}, {formattedDate}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#EB590E] transition-colors" />
            </button>

            {/* Cancellation Available Card */}
            <button
              onClick={() => setShowCancellationModal(true)}
              className="w-full bg-white rounded-3xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 flex items-center justify-between text-left transition-all active:scale-[0.99] hover:border-orange-200 group"
            >
              <div className="flex items-start gap-3.5">
                <div className="text-rose-500 mt-0.5 p-2 rounded-2xl bg-rose-50">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-extrabold text-slate-800 text-sm">Cancellation available</p>
                  <p className="text-xs text-slate-400 mt-0.5">Valid till {timeSlot}, {formattedDate}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-rose-500 transition-colors" />
            </button>
          </div>
        </div>

        {/* 4. Pricing & Bill Summary */}
        <div className="pt-2">
          <div className="flex items-center gap-4 mb-3">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
              Bill & Reservation Charges
            </span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 space-y-3">
            {restaurant?.diningSettings?.pricingModel === "fixed_fee" ? (
              <>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>Table Reservation Fee</span>
                  <span className="font-bold text-slate-900">₹{restaurant?.diningSettings?.bookingFee || 100}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>Pay at Restaurant (Food Bill)</span>
                  <span className="font-semibold text-slate-500">{restaurant?.diningSettings?.costForTwo || restaurant?.costForTwo || "₹600 for two"}</span>
                </div>
                <div className="pt-2 border-t border-dashed border-slate-200 flex justify-between items-center">
                  <span className="text-xs font-black text-slate-900">Total Due for Booking</span>
                  <span className="text-sm font-black text-[#EB590E]">₹{restaurant?.diningSettings?.bookingFee || 100}</span>
                </div>
              </>
            ) : restaurant?.diningSettings?.pricingModel === "cover_charge" ? (
              <>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>Cover Charge (₹{restaurant?.diningSettings?.coverChargePerPerson || 500} × {guests} Guests)</span>
                  <span className="font-bold text-slate-900">₹{(restaurant?.diningSettings?.coverChargePerPerson || 500) * guests}</span>
                </div>
                <p className="text-[11px] text-emerald-600 font-semibold bg-emerald-50 p-2 rounded-xl border border-emerald-100">
                  ✓ 100% cover charge is adjusted against your final food & drinks bill at the restaurant.
                </p>
                <div className="pt-2 border-t border-dashed border-slate-200 flex justify-between items-center">
                  <span className="text-xs font-black text-slate-900">Total Cover Amount</span>
                  <span className="text-sm font-black text-[#EB590E]">₹{(restaurant?.diningSettings?.coverChargePerPerson || 500) * guests}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>Table Reservation Fee</span>
                  <span className="font-bold text-emerald-600 uppercase">FREE (₹0)</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>Estimated Cost</span>
                  <span className="font-semibold text-slate-500">{restaurant?.diningSettings?.costForTwo || restaurant?.costForTwo || "₹600 for two"}</span>
                </div>
                <div className="pt-2 border-t border-dashed border-slate-200 flex justify-between items-center">
                  <span className="text-xs font-black text-slate-900">Total Payable Now</span>
                  <span className="text-sm font-black text-emerald-600">₹0 (Free Booking)</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 5. Your Details Card (Editable) */}
        <div className="pt-2">
          <div className="flex items-center gap-4 mb-3">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
              Your Details
            </span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-full bg-orange-100/80 text-[#EB590E] font-black text-sm flex items-center justify-center">
                {guestName.charAt(0).toUpperCase() || "G"}
              </div>
              <div>
                <p className="font-extrabold text-slate-900 text-sm">{guestName}</p>
                <p className="text-xs text-slate-400 mt-0.5 font-medium">{guestPhone}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setEditNameInput(guestName)
                setEditPhoneInput(guestPhone)
                setShowEditDetailsModal(true)
              }}
              className="text-[#EB590E] text-xs font-black px-3 py-1.5 rounded-xl hover:bg-orange-50 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Terms and Conditions */}
        <div className="pt-2">
          <div className="flex items-center gap-4 mb-3">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
              Terms and Conditions
            </span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100/90">
            <ul className="space-y-3.5">
              {[
                "Please arrive 15 minutes prior to your reservation time.",
                "Booking valid for the specified number of guests entered during reservation.",
                "Cover charges upon entry are subject to the discretion of the restaurant.",
                "House rules are to be observed at all times.",
                "Special requests will be accommodated at the restaurant's discretion.",
                "Offers can be availed only by paying via Eatiefy.",
                "Cover charges cannot be refunded if slot is cancelled within 30 minutes of slot start time.",
                "Additional service charges on the bill are at the restaurant's discretion.",
              ].map((term, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 flex-shrink-0"></div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">{term}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Sticky Action Button: Confirm Your Seat */}
      <div className="fixed bottom-0 left-0 w-full bg-white/95 backdrop-blur-md border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-40">
        <div className="mx-auto max-w-md">
          <Button
            onClick={handleBooking}
            disabled={bookingInProgress}
            style={{
              background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 50%, #DF4A00 100%)",
            }}
            className="w-full h-14 text-white font-extrabold text-base sm:text-lg rounded-2xl shadow-xl shadow-orange-500/25 hover:opacity-95 transition-all active:scale-[0.98]"
          >
            {bookingInProgress ? "Confirming Seat..." : "Confirm your seat"}
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. SPECIAL REQUEST MODAL SHEET */}
      {/* ========================================================================= */}
      {showSpecialRequestModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#EB590E]" />
                <h3 className="text-base font-black text-slate-900">Add Special Request</h3>
              </div>
              <button
                onClick={() => setShowSpecialRequestModal(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Select popular preferences or write custom requests for the restaurant team:
            </p>

            {/* Preset Chips */}
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESET_REQUEST_CHIPS.map((chip) => {
                const isSelected = selectedChips.includes(chip.label)
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => toggleChip(chip.label)}
                    className={`px-3 py-2 rounded-2xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 ${
                      isSelected
                        ? "bg-orange-50 border-2 border-[#EB590E] text-[#EB590E]"
                        : "bg-slate-50 border border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                    {chip.label}
                  </button>
                )
              })}
            </div>

            {/* Custom Notes Textarea */}
            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Custom Note / Dietary Requirements
              </label>
              <textarea
                value={draftRequestText}
                onChange={(e) => setDraftRequestText(e.target.value)}
                placeholder="e.g. Non-spicy food, extra baby chair, anniversary greeting on dessert..."
                rows={3}
                className="w-full rounded-2xl border border-slate-200 p-3 text-xs text-slate-800 focus:border-[#EB590E] focus:ring-1 focus:ring-[#EB590E] outline-none resize-none bg-slate-50"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowSpecialRequestModal(false)}
                className="flex-1 rounded-2xl h-12 text-slate-600 font-bold"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveSpecialRequest}
                style={{
                  background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
                }}
                className="flex-1 rounded-2xl h-12 text-white font-bold shadow-lg shadow-orange-500/20"
              >
                Apply Request
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MODIFICATION POLICY MODAL */}
      {/* ========================================================================= */}
      {showModificationModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-[#EB590E]" />
                <h3 className="text-base font-black text-slate-900">Modification Policy</h3>
              </div>
              <button
                onClick={() => setShowModificationModal(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 py-2">
              <div className="p-4 rounded-2xl bg-orange-50/60 border border-orange-200/80 space-y-1">
                <p className="text-xs font-black text-[#EB590E] uppercase tracking-wider">Free Modification Window</p>
                <p className="text-xs text-slate-700 font-medium leading-relaxed">
                  You can modify your guest count, reservation date, or time slot up to <strong>1 hour before</strong> your scheduled booking time ({timeSlot}) without any charges.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                <p className="text-xs font-bold text-slate-800">Need to change right now?</p>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Tap below to go back to the table slot selector and choose different guests, date or timing.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowModificationModal(false)}
                className="flex-1 rounded-2xl h-12 text-slate-600 font-bold"
              >
                Keep Current Slot
              </Button>
              <Button
                onClick={handleModifyBooking}
                style={{
                  background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
                }}
                className="flex-1 rounded-2xl h-12 text-white font-bold shadow-lg shadow-orange-500/20"
              >
                Change Date / Time
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. CANCELLATION POLICY MODAL */}
      {/* ========================================================================= */}
      {showCancellationModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-black text-slate-900">100% Free Cancellation</h3>
              </div>
              <button
                onClick={() => setShowCancellationModal(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 py-2">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 space-y-1">
                <p className="text-xs font-black text-emerald-800 uppercase tracking-wider">Zero Penalty Policy</p>
                <p className="text-xs text-emerald-950 font-medium leading-relaxed">
                  Cancel anytime up to <strong>30 minutes before</strong> your booking time ({timeSlot}) for a 100% full refund with zero cancellation fee.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Clock className="w-4 h-4 text-[#EB590E]" />
                  <span>Instant Refund Processing</span>
                </div>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Any cover charge or advance payment will be instantly reversed to your original payment method / Eatiefy wallet.
                </p>
              </div>
            </div>

            <Button
              onClick={() => setShowCancellationModal(false)}
              style={{
                background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
              }}
              className="w-full rounded-2xl h-12 text-white font-bold shadow-lg shadow-orange-500/20"
            >
              I Understand
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. EDIT GUEST DETAILS MODAL */}
      {/* ========================================================================= */}
      {showEditDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#EB590E]" />
                <h3 className="text-base font-black text-slate-900">Edit Guest Details</h3>
              </div>
              <button
                onClick={() => setShowEditDetailsModal(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              The restaurant host will call this number for table coordination & entry:
            </p>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={editNameInput}
                  onChange={(e) => setEditNameInput(e.target.value)}
                  placeholder="Enter guest name"
                  className="w-full rounded-2xl border border-slate-200 px-3.5 py-3 text-xs font-bold text-slate-900 focus:border-[#EB590E] focus:ring-1 focus:ring-[#EB590E] outline-none bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mobile Number
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    +91
                  </span>
                  <input
                    type="tel"
                    maxLength={10}
                    value={editPhoneInput}
                    onChange={(e) => setEditPhoneInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="10-digit mobile number"
                    className="w-full rounded-2xl border border-slate-200 pl-11 pr-3.5 py-3 text-xs font-bold text-slate-900 focus:border-[#EB590E] focus:ring-1 focus:ring-[#EB590E] outline-none bg-slate-50"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <Button
                variant="outline"
                onClick={() => setShowEditDetailsModal(false)}
                className="flex-1 rounded-2xl h-12 text-slate-600 font-bold"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveGuestDetails}
                style={{
                  background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
                }}
                className="flex-1 rounded-2xl h-12 text-white font-bold shadow-lg shadow-orange-500/20"
              >
                Save Details
              </Button>
            </div>
          </div>
        </div>
      )}
    </AnimatedPage>
  )
}
