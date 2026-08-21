import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Calendar, Clock, Users, Search, MessageSquare, CheckCircle2, Clock4, UploadCloud, ImagePlus, ChevronDown, ChevronUp, Sparkles, MapPin, Phone, Info, X, ArrowLeft } from "lucide-react"
import { diningAPI, restaurantAPI } from "@food/api"
import Loader from "@food/components/Loader"
import { Badge } from "@food/components/ui/badge"
import { toast } from "sonner"
const debugError = (...args) => { }

const getRestaurantFromResponse = (response) =>
    response?.data?.data?.restaurant ||
    response?.data?.restaurant ||
    response?.data?.data ||
    null

const normalizeImageEntry = (entry) => {
    if (!entry) return null
    if (typeof entry === "string") {
        const url = entry.trim()
        return url ? { url, publicId: null } : null
    }
    const url = String(entry?.url || "").trim()
    if (!url) return null
    return {
        url,
        publicId: entry?.publicId || null,
    }
}

const getProfilePhotoUrl = (restaurant) => {
    const candidate = restaurant?.profileImage
    if (!candidate) return ""
    if (typeof candidate === "string") return candidate.trim()
    return String(candidate?.url || "").trim()
}

const getCoverImages = (restaurant) => {
    const base = Array.isArray(restaurant?.coverImages) ? restaurant.coverImages : []
    return base
        .map(normalizeImageEntry)
        .filter(Boolean)
}

const getMenuImages = (restaurant) => {
    const base = Array.isArray(restaurant?.menuImages) ? restaurant.menuImages : []

    return base
        .map(normalizeImageEntry)
        .filter(Boolean)
}

const getBookerName = (booking) =>
    String(
        booking?.user?.name ||
        booking?.customerName ||
        booking?.bookedBy?.name ||
        booking?.name ||
        "Guest"
    ).trim()

const getBookerPhone = (booking) =>
    String(
        booking?.user?.phone ||
        booking?.phone ||
        booking?.phoneNumber ||
        booking?.mobile ||
        booking?.bookedBy?.phone ||
        ""
    ).trim()


export default function DiningReservations() {
    const navigate = useNavigate()
    const [bookings, setBookings] = useState([])
    const [loading, setLoading] = useState(true)
    const [restaurant, setRestaurant] = useState(null)
    const [searchTerm, setSearchTerm] = useState("")
    const [restaurantPhoto, setRestaurantPhoto] = useState("")
    const [restaurantPhotos, setRestaurantPhotos] = useState([])
    const [menuPhotos, setMenuPhotos] = useState([])
    const [uploadingRestaurantPhoto, setUploadingRestaurantPhoto] = useState(false)
    const [uploadingMenuPhotos, setUploadingMenuPhotos] = useState(false)
    const [removingRestaurantPhoto, setRemovingRestaurantPhoto] = useState(false)
    const [removingMenuPhoto, setRemovingMenuPhoto] = useState(false)
    const [uploadMessage, setUploadMessage] = useState("")
    const [uploadError, setUploadError] = useState("")
    const [activeSection, setActiveSection] = useState("reservations")
    const [activeView, setActiveView] = useState("priority")
    const [showMediaPanel, setShowMediaPanel] = useState(false)
    const [diningEnabled, setDiningEnabled] = useState(false)
    const [maxGuestsLimit, setMaxGuestsLimit] = useState(6)
    const [pricingModel, setPricingModel] = useState("free")
    const [bookingFee, setBookingFee] = useState(0)
    const [coverChargePerPerson, setCoverChargePerPerson] = useState(0)
    const [costForTwo, setCostForTwo] = useState("")
    const [offerBadge, setOfferBadge] = useState("")
    const [mealPeriods, setMealPeriods] = useState(["breakfast", "lunch", "dinner"])
    const [savingDiningSettings, setSavingDiningSettings] = useState(false)
    const [diningSettingsMessage, setDiningSettingsMessage] = useState("")
    const [diningSettingsError, setDiningSettingsError] = useState("")
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)
    const [submittingApply, setSubmittingApply] = useState(false)
    const [applyForm, setApplyForm] = useState({
        coverImage: "",
        costForTwo: "",
        offer: "",
        diningType: "family-dining",
        pricingModel: "free",
        bookingFee: 0,
        coverChargePerPerson: 0,
        maxGuests: 6,
        notes: "",
    })

    const syncRestaurantMediaState = (restaurantData) => {
        setRestaurant(restaurantData || null)
        const coverImages = getCoverImages(restaurantData)
        const profileImage = getProfilePhotoUrl(restaurantData)
        setRestaurantPhotos(coverImages)
        setRestaurantPhoto(coverImages[0]?.url || profileImage)
        setMenuPhotos(getMenuImages(restaurantData))
        setDiningEnabled(Boolean(restaurantData?.diningSettings?.isEnabled))
        setMaxGuestsLimit(Math.max(1, parseInt(restaurantData?.diningSettings?.maxGuests, 10) || 6))
        setPricingModel(restaurantData?.diningSettings?.pricingModel || "free")
        setBookingFee(Number(restaurantData?.diningSettings?.bookingFee || 0))
        setCoverChargePerPerson(Number(restaurantData?.diningSettings?.coverChargePerPerson || 0))
        setCostForTwo(restaurantData?.diningSettings?.costForTwo || restaurantData?.costForTwo || "")
        setOfferBadge(restaurantData?.diningSettings?.offer || restaurantData?.offer || "")
        setMealPeriods(Array.isArray(restaurantData?.diningSettings?.mealPeriods) && restaurantData.diningSettings.mealPeriods.length > 0 ? restaurantData.diningSettings.mealPeriods : ["breakfast", "lunch", "dinner"])
        setApplyForm({
            coverImage: restaurantData?.diningSettings?.coverImage || coverImages[0]?.url || "",
            costForTwo: restaurantData?.diningSettings?.costForTwo || restaurantData?.costForTwo || "",
            offer: restaurantData?.diningSettings?.offer || restaurantData?.offer || "",
            diningType: restaurantData?.diningSettings?.diningType || "family-dining",
            pricingModel: restaurantData?.diningSettings?.pricingModel || "free",
            bookingFee: Number(restaurantData?.diningSettings?.bookingFee || 0),
            coverChargePerPerson: Number(restaurantData?.diningSettings?.coverChargePerPerson || 0),
            maxGuests: restaurantData?.diningSettings?.maxGuests || 6,
            notes: restaurantData?.diningSettings?.notes || "",
        })
    }

    const handleApplySubmit = async (e) => {
        if (e) e.preventDefault()
        setSubmittingApply(true)
        try {
            const response = await restaurantAPI.submitDiningRequest(applyForm)
            const updated = getRestaurantFromResponse(response)
            if (updated) {
                syncRestaurantMediaState(updated)
            }
            setIsApplyModalOpen(false)
            toast.success("Dining activation request submitted for Admin review! 🍽️")
        } catch (err) {
            toast.error(err?.response?.data?.message || "Failed to submit dining request")
        } finally {
            setSubmittingApply(false)
        }
    }

    useEffect(() => {
        const fetchAll = async () => {
            try {
                // First get the current restaurant
                const resResponse = await restaurantAPI.getCurrentRestaurant()
                if (resResponse.data.success) {
                    const resData = getRestaurantFromResponse(resResponse)

                    const restaurantId = resData?._id || resData?.id

                    if (restaurantId) {
                        syncRestaurantMediaState(resData)
                        // Then get its bookings
                        const bookingsResponse = await diningAPI.getRestaurantBookings(resData)
                        if (bookingsResponse.data.success) {
                            setBookings(Array.isArray(bookingsResponse.data.data) ? bookingsResponse.data.data : [])
                        }
                    } else {
                        debugError("Restaurant ID not found in response:", resData)
                    }
                }
            } catch (error) {
                debugError("Error fetching reservations:", error)
            } finally {
                setLoading(false)
            }
        }
        fetchAll()
    }, [])

    const handleRestaurantPhotoUpload = async (event) => {
        const files = Array.from(event.target.files || [])
        if (files.length === 0) return

        setUploadError("")
        setUploadMessage("")
        setUploadingRestaurantPhoto(true)

        try {
            await restaurantAPI.uploadCoverImages(files)
            const refreshedResponse = await restaurantAPI.getCurrentRestaurant()
            const refreshedRestaurant = getRestaurantFromResponse(refreshedResponse)
            syncRestaurantMediaState(refreshedRestaurant)
            setUploadMessage(`Uploaded ${files.length} restaurant photo(s) successfully.`)
        } catch (error) {
            debugError("Error uploading restaurant photo:", error)
            setUploadError(error?.response?.data?.message || "Failed to upload restaurant photos.")
        } finally {
            setUploadingRestaurantPhoto(false)
            event.target.value = ""
        }
    }

    const handleMenuPhotosUpload = async (event) => {
        const files = Array.from(event.target.files || [])
        if (files.length === 0) return

        setUploadError("")
        setUploadMessage("")
        setUploadingMenuPhotos(true)

        try {
            await restaurantAPI.uploadMenuImages(files)
            const refreshedResponse = await restaurantAPI.getCurrentRestaurant()
            syncRestaurantMediaState(getRestaurantFromResponse(refreshedResponse))
            setUploadMessage(`Uploaded ${files.length} menu photo(s) successfully.`)
        } catch (error) {
            debugError("Error saving menu photos:", error)
            setUploadError(error?.response?.data?.message || "Failed to upload menu photos.")
        } finally {
            setUploadingMenuPhotos(false)
            event.target.value = ""
        }
    }

    const handleRemoveRestaurantPhoto = async (photoUrl) => {
        if (!photoUrl || removingRestaurantPhoto) return

        setUploadError("")
        setUploadMessage("")
        setRemovingRestaurantPhoto(true)

        try {
            const nextCoverImages = restaurantPhotos.filter((photo) => photo.url !== photoUrl)
            const currentProfileImage = getProfilePhotoUrl(restaurant)
            const nextPrimaryPhoto = nextCoverImages[0]?.url || ""
            const shouldClearProfileImage = !nextPrimaryPhoto && currentProfileImage === photoUrl

            const response = await restaurantAPI.updateProfile({
                coverImages: nextCoverImages.map((photo) => ({
                    url: photo.url,
                    ...(photo.publicId ? { publicId: photo.publicId } : {}),
                })),
                ...(shouldClearProfileImage ? { profileImage: "" } : {}),
            })

            const updatedRestaurant = getRestaurantFromResponse(response)
            if (updatedRestaurant) {
                syncRestaurantMediaState(updatedRestaurant)
            } else {
                const refreshedResponse = await restaurantAPI.getCurrentRestaurant()
                syncRestaurantMediaState(getRestaurantFromResponse(refreshedResponse))
            }

            setUploadMessage("Restaurant photo removed successfully.")
        } catch (error) {
            debugError("Error removing restaurant photo:", error)
            setUploadError(error?.response?.data?.message || "Failed to remove restaurant photo.")
        } finally {
            setRemovingRestaurantPhoto(false)
        }
    }

    const handleRemoveMenuPhoto = async (photoUrl) => {
        if (!photoUrl || removingMenuPhoto) return

        setUploadError("")
        setUploadMessage("")
        setRemovingMenuPhoto(true)

        try {
            const nextMenuPhotos = menuPhotos.filter((photo) => photo.url !== photoUrl)
            const response = await restaurantAPI.updateProfile({
                menuImages: nextMenuPhotos.map((photo) => ({
                    url: photo.url,
                    ...(photo.publicId ? { publicId: photo.publicId } : {}),
                })),
            })

            const updatedRestaurant = getRestaurantFromResponse(response)
            if (updatedRestaurant) {
                syncRestaurantMediaState(updatedRestaurant)
            } else {
                const refreshedResponse = await restaurantAPI.getCurrentRestaurant()
                syncRestaurantMediaState(getRestaurantFromResponse(refreshedResponse))
            }

            setUploadMessage("Menu photo removed successfully.")
        } catch (error) {
            debugError("Error removing menu photo:", error)
            setUploadError(error?.response?.data?.message || "Failed to remove menu photo.")
        } finally {
            setRemovingMenuPhoto(false)
        }
    }

    const handleSaveDiningSettings = async () => {
        if (!restaurant || savingDiningSettings) return

        const nextMaxGuests = Math.max(1, parseInt(maxGuestsLimit, 10) || 1)
        const nextDiningSettings = {
            ...(restaurant?.diningSettings || {}),
            isEnabled: Boolean(diningEnabled),
            maxGuests: nextMaxGuests,
            pricingModel: pricingModel || "free",
            bookingFee: Math.max(0, Number(bookingFee) || 0),
            coverChargePerPerson: Math.max(0, Number(coverChargePerPerson) || 0),
            costForTwo: String(costForTwo || "").trim(),
            offer: String(offerBadge || "").trim(),
            mealPeriods: Array.isArray(mealPeriods) && mealPeriods.length > 0 ? mealPeriods : ["breakfast", "lunch", "dinner"],
            diningType: restaurant?.diningSettings?.diningType || "family-dining",
        }

        setDiningSettingsError("")
        setDiningSettingsMessage("")
        setSavingDiningSettings(true)

        try {
            const response = await restaurantAPI.updateDiningSettings(nextDiningSettings)

            const updatedRestaurant = getRestaurantFromResponse(response)
            if (updatedRestaurant) {
                syncRestaurantMediaState(updatedRestaurant)
            }

            setDiningSettingsMessage("Dining and pricing settings saved successfully.")
            toast.success("Dining & pricing settings updated")
        } catch (error) {
            debugError("Error saving dining settings:", error)
            setDiningSettingsError(error?.response?.data?.message || "Failed to save dining settings.")
            toast.error(error?.response?.data?.message || "Failed to save dining settings")
        } finally {
            setSavingDiningSettings(false)
        }
    }

    const handleStatusUpdate = async (bookingId, newStatus) => {
        try {
            const response = await diningAPI.updateBookingStatusRestaurant(bookingId, newStatus)
            if (response.data.success) {
                // Update local state
                setBookings(prev => prev.map(b =>
                    b._id === bookingId ? { ...b, status: newStatus } : b
                ))
            }
        } catch (error) {
            debugError("Error updating status:", error)
        }
    }

    const getStatusPriority = (status) => {
        const key = String(status || "").toLowerCase()
        if (key === "pending") return 0
        if (key === "confirmed" || key === "accepted") return 1
        if (key === "checked-in") return 2
        if (key === "completed") return 3
        if (key === "cancelled") return 4
        return 5
    }

    const getBookingTimestamp = (booking) => {
        const createdAtTs = new Date(booking?.createdAt || "").getTime()
        if (!Number.isNaN(createdAtTs)) return createdAtTs
        const dateTs = new Date(booking?.date || "").getTime()
        if (!Number.isNaN(dateTs)) return dateTs
        return 0
    }

    const isToday = (value) => {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return false
        return date.toDateString() === new Date().toDateString()
    }

    const isNewRequest = (booking) => {
        const status = String(booking?.status || "").toLowerCase()
        if (status !== "pending" && status !== "confirmed") return false
        const createdAt = new Date(booking?.createdAt || booking?.date || "").getTime()
        if (Number.isNaN(createdAt)) return true
        return Date.now() - createdAt <= 2 * 60 * 60 * 1000
    }

    const sortedBookings = useMemo(() => {
        return [...bookings].sort((a, b) => {
            const priorityDiff = getStatusPriority(a?.status) - getStatusPriority(b?.status)
            if (priorityDiff !== 0) return priorityDiff
            return getBookingTimestamp(b) - getBookingTimestamp(a)
        })
    }, [bookings])

    const filteredBookings = useMemo(() => {
        const term = searchTerm.trim().toLowerCase()
        return sortedBookings
            .filter((booking) => {
                if (!term) return true
                return (
                    getBookerName(booking).toLowerCase().includes(term) ||
                    String(booking?.bookingId || "").toLowerCase().includes(term) ||
                    getBookerPhone(booking).toLowerCase().includes(term)
                )
            })
            .filter((booking) => {
                if (activeView === "today") return isToday(booking?.date)
                if (activeView === "new") return isNewRequest(booking)
                return true
            })
    }, [sortedBookings, searchTerm, activeView])

    const newRequestsCount = useMemo(
        () => bookings.filter((booking) => isNewRequest(booking)).length,
        [bookings]
    )

    return (
        <div className="h-full overflow-y-auto bg-slate-50 pb-20 custom-scrollbar">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-xl sticky top-0 z-30 border-b border-slate-100">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center"
                    >
                        <button
                            onClick={() => navigate(-1)}
                            className="mr-4 p-2.5 rounded-2xl bg-slate-100/80 text-slate-600 hover:bg-white hover:text-blue-600 hover:shadow-lg hover:shadow-blue-500/10 transition-all border border-transparent hover:border-blue-500/20 group"
                            title="Go Back"
                        >
                            <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                            Table Reservations
                            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        </h1>
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Live Queue Management</p>
                        </div>
                    </motion.div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="relative group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                            <input
                                type="text"
                                id="reservation-search"
                                name="reservation-search"
                                placeholder="Search guests..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full sm:w-64 pl-11 pr-4 py-2.5 bg-slate-100/50 border-2 border-transparent rounded-2xl text-sm font-bold focus:bg-white focus:border-blue-500/20 focus:ring-4 focus:ring-blue-500/5 transition-all outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                            <button
                                onClick={() => setActiveSection("reservations")}
                                className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeSection === "reservations" ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 scale-[1.02]" : "text-slate-400 hover:text-slate-600"}`}
                            >
                                Queue
                            </button>
                            <button
                                onClick={() => setActiveSection("media")}
                                className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeSection === "media" ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 scale-[1.02]" : "text-slate-400 hover:text-slate-600"}`}
                            >
                                Media
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-6">
                {/* 1. Dining Application Status Banners */}
                {restaurant?.diningSettings?.requestStatus === "pending" && (
                    <div className="mb-6 rounded-3xl bg-gradient-to-r from-amber-500 to-orange-500 text-white p-6 shadow-lg shadow-orange-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white flex-shrink-0">
                                <Clock4 className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-white/25 text-white tracking-wider mb-1">
                                    Application Pending
                                </span>
                                <h3 className="text-base font-bold">Dining Activation Request is Under Review ⏳</h3>
                                <p className="text-xs text-orange-100 mt-0.5">
                                    Your dining application has been submitted to Eatiefy Admin. Once approved, your restaurant will automatically appear on the customer Dining app.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsApplyModalOpen(true)}
                            className="px-5 py-2.5 text-xs font-bold text-[#EB590E] bg-white hover:bg-orange-50 rounded-xl transition-all shadow-sm active:scale-95 whitespace-nowrap"
                        >
                            Edit Proposal
                        </button>
                    </div>
                )}

                {restaurant?.diningSettings?.requestStatus === "rejected" && (
                    <div className="mb-6 rounded-3xl bg-rose-50 border border-rose-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 flex-shrink-0">
                                <Info className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-100 text-rose-700 tracking-wider mb-1">
                                    Action Required
                                </span>
                                <h3 className="text-base font-bold text-rose-900">Dining Activation Not Approved</h3>
                                <p className="text-xs text-rose-700 mt-0.5">
                                    {restaurant?.diningSettings?.rejectionReason ? `Reason: "${restaurant.diningSettings.rejectionReason}"` : "Please update your details with high-quality photos and re-apply."}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsApplyModalOpen(true)}
                            className="px-5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-all shadow-sm active:scale-95 whitespace-nowrap"
                        >
                            Re-Apply Now
                        </button>
                    </div>
                )}

                {(!restaurant?.diningSettings?.requestStatus || restaurant?.diningSettings?.requestStatus === "none") && !restaurant?.diningSettings?.isEnabled && (
                    <div className="mb-6 rounded-3xl bg-gradient-to-r from-[#EB590E] to-[#FF8C38] text-white p-6 shadow-lg shadow-orange-500/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-white/20 text-white tracking-wider mb-1.5">
                                Boost Your Orders
                            </span>
                            <h3 className="text-lg font-bold">Activate Eatiefy Dining for Table Bookings</h3>
                            <p className="text-xs text-orange-100 mt-1 max-w-xl">
                                Allow thousands of local food lovers to discover your restaurant ambience, view your menu, and book dining tables seamlessly.
                            </p>
                        </div>
                        <button
                            onClick={() => setIsApplyModalOpen(true)}
                            className="px-5 py-2.5 text-xs font-bold text-[#EB590E] bg-white hover:bg-orange-50 rounded-xl transition-all shadow-sm active:scale-95 whitespace-nowrap"
                        >
                            Apply for Dining Feature
                        </button>
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-md transition-shadow"
                    >
                        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                        <div className="flex items-center gap-4 relative">
                            <div className="bg-blue-600 p-3 rounded-xl text-white shadow-lg shadow-blue-200">
                                <Users className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Total Bookings</p>
                                <p className="text-3xl font-black text-slate-900 leading-none mt-1">{bookings.length}</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-md transition-shadow"
                    >
                        <div className="absolute top-0 right-0 w-24 h-24 bg-green-50/50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                        <div className="flex items-center gap-4 relative">
                            <div className="bg-emerald-600 p-3 rounded-xl text-white shadow-lg shadow-emerald-200">
                                <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Active</p>
                                <p className="text-3xl font-black text-slate-900 leading-none mt-1">
                                    {bookings.filter(b => ['pending', 'confirmed', 'accepted', 'checked-in'].includes(String(b.status || '').toLowerCase())).length}
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                        className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-md transition-shadow"
                    >
                        <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50/50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110" />
                        <div className="flex items-center gap-4 relative">
                            <div className="bg-orange-600 p-3 rounded-xl text-white shadow-lg shadow-orange-200">
                                <Clock4 className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Today's Bookings</p>
                                <p className="text-3xl font-black text-slate-900 leading-none mt-1">
                                    {bookings.filter(b => new Date(b.date).toDateString() === new Date().toDateString()).length}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </div>

                <div className="mb-6 md:hidden">
                    <div className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 p-1">
                        <button
                            onClick={() => setActiveSection("reservations")}
                            className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${activeSection === "reservations" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                        >
                            Reservations
                        </button>
                        <button
                            onClick={() => setActiveSection("media")}
                            className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${activeSection === "media" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                        >
                            Photos & Menu
                        </button>
                    </div>
                </div>

                {activeSection === "media" && (
                    <div className="mb-8">
                        <button
                            onClick={() => setShowMediaPanel((prev) => !prev)}
                            className="w-full bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                        >
                            <div>
                                <h2 className="text-left text-base font-bold text-slate-900">Photos & Menu Manager</h2>
                                <p className="text-left text-sm text-slate-500">Upload restaurant and menu images only when needed.</p>
                            </div>
                            {showMediaPanel ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                        </button>
                    </div>
                )}

                {activeSection === "media" && showMediaPanel && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Restaurant Photos</h2>
                                    <p className="text-sm text-slate-500 mt-1">Add multiple restaurant photos. The first one will be used as the main preview.</p>
                                </div>
                                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold cursor-pointer hover:bg-slate-800 transition-colors">
                                    <UploadCloud className="w-4 h-4" />
                                    {uploadingRestaurantPhoto ? "Uploading..." : "Add Photos"}
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        multiple
                                        onChange={handleRestaurantPhotoUpload}
                                        disabled={uploadingRestaurantPhoto || removingRestaurantPhoto}
                                    />
                                </label>
                            </div>

                            <div className="mt-4 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 h-56">
                                {restaurantPhoto ? (
                                    <img
                                        src={restaurantPhoto}
                                        alt={restaurant?.restaurantName || restaurant?.name || "Restaurant"}
                                        className="w-full h-full object-cover"
                                     loading="lazy" decoding="async" />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                        <ImagePlus className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium">No restaurant photo added yet</p>
                                    </div>
                                )}
                            </div>

                            {restaurantPhotos.length > 0 && (
                                <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
                                    {restaurantPhotos.map((photo, index) => (
                                        <button
                                            key={`${photo.url}-${index}`}
                                            type="button"
                                            onClick={() => setRestaurantPhoto(photo.url)}
                                            className={`relative h-20 rounded-lg overflow-hidden border bg-slate-50 transition-all ${restaurantPhoto === photo.url ? "border-slate-900 ring-2 ring-slate-200" : "border-slate-200"}`}
                                        >
                                            <img
                                                src={photo.url}
                                                alt={`Restaurant photo ${index + 1}`}
                                                className="w-full h-full object-cover"
                                             loading="lazy" decoding="async" />
                                            <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-[10px] font-semibold text-white">
                                                {restaurantPhoto === photo.url ? "Main" : `Photo ${index + 1}`}
                                            </span>
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleRemoveRestaurantPhoto(photo.url)
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        handleRemoveRestaurantPhoto(photo.url)
                                                    }
                                                }}
                                                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow-sm"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Menu Photos</h2>
                                    <p className="text-sm text-slate-500 mt-1">Add menu photos and view previously uploaded photos.</p>
                                </div>
                                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:bg-blue-700 transition-colors">
                                    <UploadCloud className="w-4 h-4" />
                                    {uploadingMenuPhotos ? "Uploading..." : "Add Photos"}
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        multiple
                                        onChange={handleMenuPhotosUpload}
                                        disabled={uploadingMenuPhotos || removingMenuPhoto}
                                    />
                                </label>
                            </div>

                            {menuPhotos.length > 0 ? (
                                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {menuPhotos.map((photo, index) => (
                                        <div key={`${photo.url}-${index}`} className="relative h-24 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                            <img src={photo.url} alt={`Menu photo ${index + 1}`} className="w-full h-full object-cover"  loading="lazy" decoding="async" />
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveMenuPhoto(photo.url)}
                                                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow-sm"
                                                disabled={removingMenuPhoto}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-4 h-28 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                                    <ImagePlus className="w-7 h-7 mb-2" />
                                    <p className="text-sm font-medium">No menu photos added yet</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeSection === "reservations" && (
                    <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-100 pb-5">
                            <div className="max-w-xl">
                                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#EB590E]">Dining & Table Management</p>
                                <h2 className="mt-1 text-lg font-black text-slate-900">Manage Pricing, Availability & Table Settings</h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    Set your table booking pricing model, cover charges, average cost for two, and guest limits directly.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
                                    <span className={`h-2.5 w-2.5 rounded-full ${diningEnabled ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                                    <span className="text-xs font-bold text-slate-700">
                                        {diningEnabled ? "Dining LIVE" : "Dining PAUSED"}
                                    </span>
                                </div>

                                <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2">
                                    <span className="text-xs font-semibold text-slate-700">Accept Bookings</span>
                                    <button
                                        type="button"
                                        onClick={() => setDiningEnabled((prev) => !prev)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${diningEnabled ? "bg-emerald-600" : "bg-slate-300"}`}
                                        aria-pressed={diningEnabled}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${diningEnabled ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleSaveDiningSettings}
                                    disabled={savingDiningSettings}
                                    className="rounded-full bg-[#EB590E] px-6 py-2 text-xs font-bold text-white transition-all hover:bg-[#D44D0A] shadow-md shadow-orange-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {savingDiningSettings ? "Saving Changes..." : "Save Settings"}
                                </button>
                            </div>
                        </div>

                        {/* Pricing Model Selector */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                <span>1. Select Table Booking Pricing Model</span>
                                <span className="text-[11px] font-normal text-slate-400">(Choose how guests reserve tables at your restaurant)</span>
                            </label>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {[
                                    {
                                        id: "free",
                                        title: "Free Table Reservation",
                                        badge: "Standard (₹0)",
                                        desc: "Guests reserve table for free. They pay directly at your restaurant after dining.",
                                    },
                                    {
                                        id: "fixed_fee",
                                        title: "Fixed Booking Fee",
                                        badge: "Flat Token",
                                        desc: "Charge a nominal fixed reservation fee (e.g. ₹100) to confirm booking.",
                                    },
                                    {
                                        id: "cover_charge",
                                        title: "Per-Person Cover Charge",
                                        badge: "Bill Deductible",
                                        desc: "Charge per guest (e.g. ₹500/person). Adjusted against food bill on arrival.",
                                    },
                                ].map((model) => {
                                    const isSelected = pricingModel === model.id
                                    return (
                                        <button
                                            key={model.id}
                                            type="button"
                                            onClick={() => setPricingModel(model.id)}
                                            className={`p-3.5 rounded-2xl text-left border transition-all ${
                                                isSelected
                                                    ? "border-[#EB590E] bg-orange-50/70 ring-2 ring-orange-400/30"
                                                    : "border-slate-200 bg-white hover:border-slate-300"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className={`text-xs font-bold ${isSelected ? "text-[#EB590E]" : "text-slate-900"}`}>{model.title}</span>
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${isSelected ? "bg-[#EB590E] text-white" : "bg-slate-100 text-slate-500"}`}>{model.badge}</span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 leading-snug">{model.desc}</p>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Dynamic Fee Inputs & Capacity Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
                            {pricingModel === "fixed_fee" && (
                                <div className="space-y-1 bg-amber-50/60 p-3 rounded-2xl border border-amber-200">
                                    <label className="text-[11px] font-bold text-amber-900">Fixed Fee (₹ per reservation)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="100"
                                        value={bookingFee}
                                        onChange={(e) => setBookingFee(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="w-full text-xs font-bold px-3 py-2 border border-amber-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                                    />
                                </div>
                            )}

                            {pricingModel === "cover_charge" && (
                                <div className="space-y-1 bg-amber-50/60 p-3 rounded-2xl border border-amber-200">
                                    <label className="text-[11px] font-bold text-amber-900">Cover Charge (₹ per guest)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="500"
                                        value={coverChargePerPerson}
                                        onChange={(e) => setCoverChargePerPerson(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="w-full text-xs font-bold px-3 py-2 border border-amber-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                                    />
                                </div>
                            )}

                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-slate-700">Cost for Two (₹)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. ₹800 for two"
                                    value={costForTwo}
                                    onChange={(e) => setCostForTwo(e.target.value)}
                                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-slate-700">Dining Offer Badge</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Flat 20% OFF"
                                    value={offerBadge}
                                    onChange={(e) => setOfferBadge(e.target.value)}
                                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-slate-700">Max Table Capacity (Guests)</label>
                                <select
                                    value={maxGuestsLimit}
                                    onChange={(e) => setMaxGuestsLimit(Math.max(1, parseInt(e.target.value, 10) || 6))}
                                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                >
                                    {[2, 4, 6, 8, 10, 12, 16, 20].map((n) => (
                                        <option key={n} value={n}>{n} Guests Max</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Meal Periods Toggles */}
                        <div className="pt-2">
                            <label className="text-xs font-bold text-slate-700 block mb-2">Available Meal Periods</label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: "breakfast", label: "🍳 Breakfast (8 AM - 11 AM)" },
                                    { id: "lunch", label: "🍲 Lunch (12 PM - 4 PM)" },
                                    { id: "dinner", label: "🍷 Dinner (7 PM - 11 PM)" },
                                ].map((period) => {
                                    const isChecked = mealPeriods.includes(period.id)
                                    return (
                                        <button
                                            key={period.id}
                                            type="button"
                                            onClick={() => {
                                                if (isChecked) {
                                                    setMealPeriods(mealPeriods.filter((p) => p !== period.id))
                                                } else {
                                                    setMealPeriods([...mealPeriods, period.id])
                                                }
                                            }}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                                isChecked
                                                    ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                                                    : "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300"
                                            }`}
                                        >
                                            {period.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {(diningSettingsMessage || diningSettingsError) && (
                            <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
                                diningSettingsError
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}>
                                {diningSettingsError || diningSettingsMessage}
                            </div>
                        )}
                    </div>
                )}

                {(uploadMessage || uploadError) && (
                    <div className={`mb-6 rounded-xl px-4 py-3 text-sm font-medium border ${uploadError
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-green-50 text-green-700 border-green-200"
                        }`}>
                        {uploadError || uploadMessage}
                    </div>
                )}

                {/* Bookings List */}
                {activeSection === "reservations" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="font-bold text-slate-800">Reservation Queue</h2>
                            <div className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 p-1">
                                <button
                                    onClick={() => setActiveView("priority")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeView === "priority" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                                >
                                    Priority
                                </button>
                                <button
                                    onClick={() => setActiveView("new")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeView === "new" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                                >
                                    New ({newRequestsCount})
                                </button>
                                <button
                                    onClick={() => setActiveView("today")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeView === "today" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                                >
                                    Today
                                </button>
                            </div>
                        </div>

                        {newRequestsCount > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm font-semibold flex items-center gap-2">
                                <Sparkles className="w-4 h-4" />
                                {newRequestsCount} new reservation request{newRequestsCount > 1 ? "s" : ""} waiting for quick action.
                            </div>
                        )}

                        {filteredBookings.length > 0 ? (
                            <>
                                {/* Desktop View Table */}
                                <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-50 border-b border-slate-100">
                                            <tr>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">ID</th>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Guest Details</th>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Schedule</th>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Guests</th>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            <AnimatePresence mode="popLayout">
                                                {filteredBookings.map((booking) => (
                                                    <motion.tr
                                                        layout
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        key={booking._id}
                                                        className={`hover:bg-slate-50/50 transition-colors ${isNewRequest(booking) ? "bg-amber-50/20" : ""}`}
                                                    >
                                                        <td className="px-6 py-4 font-mono text-xs font-bold text-slate-400 text-center">#{booking.bookingId}</td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs uppercase">
                                                                    {getBookerName(booking).charAt(0) || '?'}
                                                                </div>
                                                                <div>
                                                                    <p className="font-bold text-slate-900 leading-tight">{getBookerName(booking)}</p>
                                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                                        <Phone className="w-3 h-3 text-slate-400" />
                                                                        <p className="text-xs text-slate-500">{getBookerPhone(booking) || 'No phone'}</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                                                    <Calendar className="w-4 h-4 text-blue-500" />
                                                                    {new Date(booking.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                                                    <Clock className="w-4 h-4 text-blue-500" />
                                                                    {booking.timeSlot}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <div className="inline-flex items-center justify-center gap-1.5 font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full text-xs">
                                                                <Users className="w-3 h-3" />
                                                                {booking.guests}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <Badge className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                                                    booking.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                                        booking.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                                                                            booking.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                                                                booking.status === 'checked-in' ? 'bg-orange-100 text-orange-700' :
                                                                                    booking.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                                                                        'bg-rose-100 text-rose-700'
                                                                    }`}>
                                                                    {booking.status === 'pending' ? 'Request' : booking.status}
                                                                </Badge>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                {(booking.status === 'pending' || booking.status === 'confirmed') && (
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(booking._id, 'confirmed')}
                                                                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                                                                    >
                                                                        Accept
                                                                    </button>
                                                                )}
                                                                {(booking.status === 'pending' || booking.status === 'confirmed') && (
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(booking._id, 'cancelled')}
                                                                        className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50 transition-colors"
                                                                    >
                                                                        Decline
                                                                    </button>
                                                                )}
                                                                {booking.status === 'accepted' && (
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(booking._id, 'checked-in')}
                                                                        className="px-3 py-1.5 bg-orange-600 text-white text-xs font-bold rounded-lg hover:bg-orange-700 transition-colors shadow-sm"
                                                                    >
                                                                        Check-in
                                                                    </button>
                                                                )}
                                                                {booking.status === 'checked-in' && (
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(booking._id, 'completed')}
                                                                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                                                                    >
                                                                        Check-out
                                                                    </button>
                                                                )}
                                                                {booking.specialRequest && (
                                                                    <button
                                                                        title={booking.specialRequest}
                                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-100 bg-blue-50/50"
                                                                    >
                                                                        <MessageSquare className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </motion.tr>
                                                ))}
                                            </AnimatePresence>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile View Cards */}
                                <div className="md:hidden space-y-4">
                                    <AnimatePresence mode="popLayout">
                                        {filteredBookings.map((booking) => (
                                            <motion.div
                                                layout
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                key={booking._id}
                                                className={`bg-white rounded-2xl p-4 shadow-sm border border-slate-100 ${isNewRequest(booking) ? "ring-2 ring-amber-400 ring-inset" : ""}`}
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-black text-sm uppercase">
                                                            {getBookerName(booking).charAt(0) || '?'}
                                                        </div>
                                                        <div>
                                                            <h3 className="font-black text-slate-900 leading-none">{getBookerName(booking)}</h3>
                                                            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">#{booking.bookingId}</p>
                                                        </div>
                                                    </div>
                                                    <Badge className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                            booking.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                                booking.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                                                                    booking.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                                                        booking.status === 'checked-in' ? 'bg-orange-100 text-orange-700' :
                                                                            booking.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                                                                'bg-rose-100 text-rose-700'
                                                        }`}>
                                                        {booking.status === 'pending' ? 'Request' : booking.status}
                                                    </Badge>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl mb-4">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="w-4 h-4 text-blue-500" />
                                                        <span className="text-xs font-bold text-slate-700">
                                                            {new Date(booking.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="w-4 h-4 text-blue-500" />
                                                        <span className="text-xs font-bold text-slate-700">{booking.timeSlot}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Users className="w-4 h-4 text-blue-500" />
                                                        <span className="text-xs font-bold text-slate-700">{booking.guests} Guests</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Phone className="w-4 h-4 text-blue-500" />
                                                        <span className="text-xs font-bold text-slate-700 truncate">{getBookerPhone(booking) || 'No phone'}</span>
                                                    </div>
                                                </div>

                                                {booking.specialRequest && (
                                                    <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-700 rounded-xl mb-4 text-xs font-medium border border-blue-100">
                                                        <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
                                                        <p>{booking.specialRequest}</p>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-2">
                                                    {(booking.status === 'pending' || booking.status === 'confirmed') && (
                                                        <button
                                                            onClick={() => handleStatusUpdate(booking._id, 'confirmed')}
                                                            className="flex-1 py-2.5 bg-emerald-600 text-white text-xs font-black rounded-xl hover:bg-emerald-700 transition-colors uppercase tracking-widest"
                                                        >
                                                            Accept
                                                        </button>
                                                    )}
                                                    {(booking.status === 'pending' || booking.status === 'confirmed') && (
                                                        <button
                                                            onClick={() => handleStatusUpdate(booking._id, 'cancelled')}
                                                            className="flex-1 py-2.5 bg-slate-100 text-slate-600 text-xs font-black rounded-xl hover:bg-slate-200 transition-colors uppercase tracking-widest"
                                                        >
                                                            Decline
                                                        </button>
                                                    )}
                                                    {booking.status === 'accepted' && (
                                                        <button
                                                            onClick={() => handleStatusUpdate(booking._id, 'checked-in')}
                                                            className="flex-1 py-2.5 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-700 transition-colors uppercase tracking-widest"
                                                        >
                                                            Check-in
                                                        </button>
                                                    )}
                                                    {booking.status === 'checked-in' && (
                                                        <button
                                                            onClick={() => handleStatusUpdate(booking._id, 'completed')}
                                                            className="flex-1 py-2.5 bg-blue-600 text-white text-xs font-black rounded-xl hover:bg-blue-700 transition-colors uppercase tracking-widest"
                                                        >
                                                            Check-out
                                                        </button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-white rounded-3xl p-16 text-center border border-slate-100 shadow-sm"
                            >
                                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Calendar className="w-10 h-10 text-slate-300" />
                                </div>
                                <h3 className="text-2xl font-black text-slate-800">No reservations found</h3>
                                <p className="text-slate-500 mt-2 max-w-xs mx-auto">When guests book a table, they will appear here in your live queue.</p>
                            </motion.div>
                        )}
                    </div>
                )}
            </div>

            {/* Apply for Dining Feature Modal */}
            {isApplyModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="px-6 py-4 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-base font-bold text-slate-900">Apply for Dining Activation 🍽️</h3>
                                <p className="text-xs text-slate-500">Submit dining details for Eatiefy Admin verification</p>
                            </div>
                            <button
                                onClick={() => setIsApplyModalOpen(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <form onSubmit={handleApplySubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                            {/* Ambience Cover Image URL / Preview */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">Ambience Cover Photo</label>
                                <div className="flex gap-3 items-center">
                                    <div className="w-24 h-16 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex-shrink-0">
                                        <img
                                            src={applyForm.coverImage || restaurantPhoto || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400"}
                                            alt="Cover preview"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <input
                                            type="text"
                                            placeholder="Paste image URL (or upload below)"
                                            value={applyForm.coverImage}
                                            onChange={(e) => setApplyForm(prev => ({ ...prev, coverImage: e.target.value }))}
                                            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                        <p className="text-[10px] text-slate-400">High-resolution ambience photo attracts 3x more bookings.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Cost For Two & Offer Badge */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Cost for Two (₹)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. ₹600 for two"
                                        value={applyForm.costForTwo}
                                        onChange={(e) => setApplyForm(prev => ({ ...prev, costForTwo: e.target.value }))}
                                        className="w-full text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Offer Badge (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Flat 20% OFF"
                                        value={applyForm.offer}
                                        onChange={(e) => setApplyForm(prev => ({ ...prev, offer: e.target.value }))}
                                        className="w-full text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                            </div>

                            {/* Pricing Model & Fees */}
                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-slate-700">Reservation Pricing Model</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: "free", label: "Free (₹0)", desc: "Free reservation" },
                                        { id: "fixed_fee", label: "Fixed Fee", desc: "Token booking fee" },
                                        { id: "cover_charge", label: "Cover Charge", desc: "Per guest charge" },
                                    ].map((model) => {
                                        const isSelected = (applyForm.pricingModel || "free") === model.id
                                        return (
                                            <button
                                                key={model.id}
                                                type="button"
                                                onClick={() => setApplyForm(prev => ({ ...prev, pricingModel: model.id }))}
                                                className={`p-2.5 rounded-xl text-left border transition-all ${
                                                    isSelected
                                                        ? "border-[#EB590E] bg-orange-50 ring-1 ring-[#EB590E]"
                                                        : "border-slate-200 bg-white"
                                                }`}
                                            >
                                                <p className={`text-xs font-bold ${isSelected ? "text-[#EB590E]" : "text-slate-800"}`}>{model.label}</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">{model.desc}</p>
                                            </button>
                                        )
                                    })}
                                </div>

                                {applyForm.pricingModel === "fixed_fee" && (
                                    <div className="pt-1">
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="Fixed Booking Fee (e.g. ₹100)"
                                            value={applyForm.bookingFee || ""}
                                            onChange={(e) => setApplyForm(prev => ({ ...prev, bookingFee: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            className="w-full text-xs px-3 py-2 border border-amber-200 bg-amber-50/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-bold"
                                        />
                                    </div>
                                )}

                                {applyForm.pricingModel === "cover_charge" && (
                                    <div className="pt-1">
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="Cover Charge per person (e.g. ₹500)"
                                            value={applyForm.coverChargePerPerson || ""}
                                            onChange={(e) => setApplyForm(prev => ({ ...prev, coverChargePerPerson: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            className="w-full text-xs px-3 py-2 border border-amber-200 bg-amber-50/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-bold"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Dining Type & Max Guests */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Dining Category</label>
                                    <select
                                        value={applyForm.diningType}
                                        onChange={(e) => setApplyForm(prev => ({ ...prev, diningType: e.target.value }))}
                                        className="w-full text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                    >
                                        <option value="family-dining">Family Dining</option>
                                        <option value="fine-dining">Fine Dining</option>
                                        <option value="luxury-dining">Luxury Dining</option>
                                        <option value="cafe-bistro">Cafe & Bistro</option>
                                        <option value="rooftop">Rooftop Lounge</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Max Table Guests</label>
                                    <select
                                        value={applyForm.maxGuests}
                                        onChange={(e) => setApplyForm(prev => ({ ...prev, maxGuests: parseInt(e.target.value, 10) || 6 }))}
                                        className="w-full text-xs px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                    >
                                        {[2, 4, 6, 8, 10, 12, 16, 20].map(n => (
                                            <option key={n} value={n}>{n} Guests</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Proposal / Remarks for Admin */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">Special Proposal / Notes for Admin</label>
                                <textarea
                                    rows={2.5}
                                    placeholder="Tell admin about your seating capacity, special dining experience, or rooftop setup..."
                                    value={applyForm.notes}
                                    onChange={(e) => setApplyForm(prev => ({ ...prev, notes: e.target.value }))}
                                    className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>

                            {/* Modal Footer Buttons */}
                            <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsApplyModalOpen(false)}
                                    className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingApply}
                                    className="px-6 py-2.5 text-xs font-bold text-white bg-[#EB590E] hover:bg-[#D44D0A] rounded-xl transition-all shadow-md shadow-orange-500/20 disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {submittingApply ? "Submitting..." : "Submit Application"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

