import { useState, useMemo, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Download, ChevronDown, Eye, Settings, ArrowUpDown, Loader2, Star, Building2, User, FileText, Phone, Mail, MapPin, ShieldX, Trash2, ArrowRight, Plus, X, Upload, Image as ImageIcon } from "lucide-react"
import { adminAPI, uploadAPI } from "@food/api"
import { resolveMediaUrl } from "@food/utils/common"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const normalizeImageUrl = (image) => {
    if (!image) return ""
    if (typeof image === "string") return resolveMediaUrl(image)
    if (typeof image === "object") return resolveMediaUrl(image.url || image.secure_url || "")
    return ""
}

const getPrimaryRestaurantImage = (restaurant, fallback = "") => {
    const diningCover = restaurant?.diningSettings?.coverImage
    if (diningCover) return normalizeImageUrl(diningCover)

    const coverImages = Array.isArray(restaurant?.coverImages) ? restaurant.coverImages : []
    const firstCoverImage = coverImages.map(normalizeImageUrl).find(Boolean)
    if (firstCoverImage) return firstCoverImage

    const menuImages = Array.isArray(restaurant?.menuImages) ? restaurant.menuImages : []
    const firstMenuImage = menuImages.map(normalizeImageUrl).find(Boolean)
    if (firstMenuImage) return firstMenuImage

    return (
        normalizeImageUrl(restaurant?.profileImage) ||
        normalizeImageUrl(restaurant?.logo) ||
        fallback
    )
}


export default function DiningList() {
    const navigate = useNavigate()
    const [searchQuery, setSearchQuery] = useState("")
    const [activeTab, setActiveTab] = useState("active") // "active" | "requests"
    const [restaurants, setRestaurants] = useState([])
    const [pendingRequests, setPendingRequests] = useState([])
    const [requestsLoading, setRequestsLoading] = useState(false)
    const [categories, setCategories] = useState([])
    const [selectedCategory, setSelectedCategory] = useState("All")
    const [loading, setLoading] = useState(true)
    const [categoryLoading, setCategoryLoading] = useState(true)
    const [error, setError] = useState(null)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [editingRestaurant, setEditingRestaurant] = useState(null)
    const [uploadingImage, setUploadingImage] = useState(false)
    const [imagePreviewUrl, setImagePreviewUrl] = useState("")
    const [rejectModalOpen, setRejectModalOpen] = useState(false)
    const [rejectingRestaurant, setRejectingRestaurant] = useState(null)
    const [rejectionReason, setRejectionReason] = useState("")
    const [actionLoadingId, setActionLoadingId] = useState(null)
    const fileInputRef = useRef(null)

    const fetchPendingRequests = async () => {
        try {
            setRequestsLoading(true)
            const response = await adminAPI.getDiningRequests()
            if (response.data && response.data.success) {
                setPendingRequests(Array.isArray(response.data.data) ? response.data.data : [])
            }
        } catch (err) {
            debugError("Error fetching dining requests:", err)
        } finally {
            setRequestsLoading(false)
        }
    }

    // Fetch restaurants from backend API
    useEffect(() => {
        const fetchRestaurants = async () => {
            try {
                setLoading(true)
                setError(null)

                const response = await adminAPI.getDiningRestaurants()

                if (response.data && response.data.success && response.data.data) {
                    const restaurantsData = response.data.data.restaurants || []

                    const mappedRestaurants = restaurantsData.map((restaurant, index) => ({
                        id: restaurant._id || restaurant.id || index + 1,
                        _id: restaurant._id,
                        name: restaurant.name || restaurant.restaurantName || "N/A",
                        ownerName: restaurant.ownerName || "N/A",
                        ownerPhone: restaurant.ownerPhone || "N/A",
                        zone: restaurant.zone || "N/A",
                        status: restaurant.status === "approved" || restaurant.isActive === true,
                        rating: restaurant.rating || 0,
                        logo: getPrimaryRestaurantImage(restaurant, "https://via.placeholder.com/40"),
                        categories: Array.isArray(restaurant.categories) ? restaurant.categories : [],
                        categoryIds: Array.isArray(restaurant.categoryIds) ? restaurant.categoryIds : [],
                        primaryCategoryId: restaurant.primaryCategoryId || null,
                        diningSettings: restaurant.diningSettings || { isEnabled: false, maxGuests: 6, diningType: "" },
                        originalData: restaurant,
                    }))

                    setRestaurants(mappedRestaurants)
                } else {
                    setRestaurants([])
                }
            } catch (err) {
                debugError("Error fetching restaurants:", err)
                setError(err.message || "Failed to fetch restaurants")
                setRestaurants([])
            } finally {
                setLoading(false)
            }
        }

        fetchRestaurants()
        fetchPendingRequests()
    }, [])

    // Fetch categories
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                setCategoryLoading(true)
                const response = await adminAPI.getDiningCategories()
                if (response.data && response.data.success) {
                    const cats = (response.data.data.categories || []).map(cat => ({
                        ...cat,
                        slug: cat.name.toLowerCase().replace(/\s+/g, '-')
                    }))
                    setCategories(cats)
                }
            } catch (err) {
                debugError("Error fetching categories:", err)
            } finally {
                setCategoryLoading(false)
            }
        }
        fetchCategories()
    }, [])

    const filteredRestaurants = useMemo(() => {
        let result = [...restaurants]

        // Search Filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim()
            result = result.filter(restaurant =>
                restaurant.name.toLowerCase().includes(query) ||
                restaurant.ownerName.toLowerCase().includes(query) ||
                restaurant.ownerPhone.includes(query)
            )
        }

        // Category Filter
        if (selectedCategory !== "All") {
            result = result.filter(restaurant =>
                restaurant.categories?.some(category => category.slug === selectedCategory) ||
                (selectedCategory === "Uncategorized" && !restaurant.diningSettings?.diningType)
            )
        }

        return result
    }, [restaurants, searchQuery, selectedCategory])

    const formatRestaurantId = (id) => {
        if (!id) return "REST000000"
        return `REST${String(id).slice(-6).toUpperCase()}`
    }

    const renderStars = (rating) => {
        const fullStars = Math.floor(rating || 0);
        return (
            <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                    <Star 
                        key={i} 
                        className={`w-3.5 h-3.5 ${i < fullStars ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'}`} 
                    />
                ))}
                <span className="ml-1 text-slate-600">({rating || 0})</span>
            </div>
        )
    }

    const handleDiningToggle = async (restaurant) => {
        const newStatus = !restaurant.diningSettings?.isEnabled
        try {
            // Optimistic update
            setRestaurants(prev => prev.map(r =>
                r.id === restaurant.id
                    ? { ...r, diningSettings: { ...r.diningSettings, isEnabled: newStatus } }
                    : r
            ))

            await adminAPI.updateRestaurantDiningSettings(restaurant._id, {
                isEnabled: newStatus,
                maxGuests: restaurant.diningSettings?.maxGuests || 6,
                categoryIds: restaurant.categoryIds || [],
                primaryCategoryId: restaurant.primaryCategoryId || restaurant.categoryIds?.[0] || null,
            })
            // Could show success toast here
        } catch (error) {
            debugError("Failed to update dining settings", error)
            // Revert on error
            setRestaurants(prev => prev.map(r =>
                r.id === restaurant.id
                    ? { ...r, diningSettings: { ...r.diningSettings, isEnabled: !newStatus } }
                    : r
            ))
        }
    }

    const handleMaxGuestsUpdate = async (restaurant, newValue) => {
        const guests = parseInt(newValue)
        if (isNaN(guests) || guests < 1) return

        // Prevent unnecessary API calls
        if (guests === restaurant.diningSettings?.maxGuests) return

        try {
            // Optimistic update
            setRestaurants(prev => prev.map(r =>
                r.id === restaurant.id
                    ? { ...r, diningSettings: { ...r.diningSettings, maxGuests: guests } }
                    : r
            ))

            await adminAPI.updateRestaurantDiningSettings(restaurant._id, {
                isEnabled: restaurant.diningSettings?.isEnabled === true,
                maxGuests: guests,
                categoryIds: restaurant.categoryIds || [],
                primaryCategoryId: restaurant.primaryCategoryId || restaurant.categoryIds?.[0] || null,
            })
        } catch (error) {
            debugError("Failed to update max guests", error)
            // Revert would require tracking previous value better
        }
    }

    const handleApproveRequest = async (request) => {
        try {
            setActionLoadingId(request._id)
            await adminAPI.approveDiningRequest(request._id, {
                isEnabled: true,
                maxGuests: request.diningSettings?.maxGuests || 6,
                diningType: request.diningSettings?.diningType || "family-dining",
                costForTwo: request.diningSettings?.costForTwo || request.costForTwo,
                offer: request.diningSettings?.offer || request.offer,
                coverImage: request.diningSettings?.coverImage,
                coverImages: request.diningSettings?.coverImages,
            })

            // Remove from pending
            setPendingRequests(prev => prev.filter(r => r._id !== request._id))

            // Refresh restaurants list
            const response = await adminAPI.getDiningRestaurants()
            if (response.data?.success && response.data.data?.restaurants) {
                const mapped = response.data.data.restaurants.map((restaurant, index) => ({
                    id: restaurant._id || restaurant.id || index + 1,
                    _id: restaurant._id,
                    name: restaurant.name || restaurant.restaurantName || "N/A",
                    ownerName: restaurant.ownerName || "N/A",
                    ownerPhone: restaurant.ownerPhone || "N/A",
                    zone: restaurant.zone || "N/A",
                    status: restaurant.status === "approved" || restaurant.isActive === true,
                    rating: restaurant.rating || 0,
                    logo: getPrimaryRestaurantImage(restaurant, "https://via.placeholder.com/40"),
                    categories: Array.isArray(restaurant.categories) ? restaurant.categories : [],
                    categoryIds: Array.isArray(restaurant.categoryIds) ? restaurant.categoryIds : [],
                    primaryCategoryId: restaurant.primaryCategoryId || null,
                    diningSettings: restaurant.diningSettings || { isEnabled: true, maxGuests: 6, diningType: "" },
                    originalData: restaurant,
                }))
                setRestaurants(mapped)
            }
        } catch (err) {
            debugError("Approve failed:", err)
        } finally {
            setActionLoadingId(null)
        }
    }

    const handleRejectRequest = async () => {
        if (!rejectingRestaurant) return
        try {
            setActionLoadingId(rejectingRestaurant._id)
            await adminAPI.rejectDiningRequest(rejectingRestaurant._id, rejectionReason)
            setPendingRequests(prev => prev.filter(r => r._id !== rejectingRestaurant._id))
            setRejectModalOpen(false)
            setRejectingRestaurant(null)
            setRejectionReason("")
        } catch (err) {
            debugError("Reject failed:", err)
        } finally {
            setActionLoadingId(null)
        }
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
            <div className="max-w-7xl mx-auto">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-slate-900">Dining Management</h1>
                        </div>
                    </div>
                    <p className="text-slate-500 text-sm">Review dining activation requests from restaurants and manage live dining tables.</p>

                    {/* Tab Navigation */}
                    <div className="mt-5 flex gap-2 border-b border-slate-100 pb-2">
                        <button
                            onClick={() => setActiveTab("active")}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                activeTab === "active"
                                    ? "bg-slate-900 text-white shadow-sm"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                            <Building2 className="w-4 h-4" />
                            Registered Dining Restaurants ({restaurants.length})
                        </button>

                        <button
                            onClick={() => setActiveTab("requests")}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                activeTab === "requests"
                                    ? "bg-[#EB590E] text-white shadow-sm"
                                    : "bg-orange-50 text-[#EB590E] hover:bg-orange-100"
                            }`}
                        >
                            <Star className="w-4 h-4" />
                            Pending Dining Requests
                            {pendingRequests.length > 0 && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                                    activeTab === "requests" ? "bg-white text-[#EB590E]" : "bg-[#EB590E] text-white"
                                }`}>
                                    {pendingRequests.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Tab 1: Pending Approval Requests */}
                {activeTab === "requests" && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Pending Dining Requests</h2>
                                <p className="text-xs text-slate-500">Restaurants waiting for admin approval to activate the Dining feature.</p>
                            </div>
                            <button
                                onClick={fetchPendingRequests}
                                className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                Refresh Requests
                            </button>
                        </div>

                        {requestsLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-[#EB590E]" />
                                <span className="ml-3 text-slate-600 font-medium">Loading requests...</span>
                            </div>
                        ) : pendingRequests.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mb-4 text-[#EB590E]">
                                    <Star className="w-8 h-8" />
                                </div>
                                <h3 className="text-base font-bold text-slate-800 mb-1">No Pending Requests</h3>
                                <p className="text-xs text-slate-500 max-w-sm">All restaurant dining requests have been processed. New requests will appear here in real-time.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {pendingRequests.map((req) => {
                                    const cover = req.diningSettings?.coverImage || req.coverImages?.[0]?.url || req.profileImage
                                    const isLoading = actionLoadingId === req._id

                                    return (
                                        <div key={req._id} className="border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                                            <div>
                                                {/* Header image & title */}
                                                <div className="flex gap-4 mb-3.5">
                                                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200">
                                                        <img
                                                            src={normalizeImageUrl(cover) || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400"}
                                                            alt={req.restaurantName}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 uppercase tracking-wider mb-1">
                                                            Pending Approval
                                                        </span>
                                                        <h3 className="text-base font-bold text-slate-900 truncate">{req.restaurantName}</h3>
                                                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                            <User className="w-3.5 h-3.5 text-slate-400" />
                                                            {req.ownerName} ({req.ownerPhone})
                                                        </p>
                                                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                                            {req.area || req.city || "Location available"}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Details badges */}
                                                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-xl mb-3 text-center">
                                                    <div>
                                                        <span className="block text-[10px] uppercase font-bold text-slate-400">Category</span>
                                                        <span className="text-xs font-bold text-slate-700 capitalize">{req.diningSettings?.diningType || "Family Dining"}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-[10px] uppercase font-bold text-slate-400">Cost For 2</span>
                                                        <span className="text-xs font-bold text-slate-700">{req.diningSettings?.costForTwo || req.costForTwo || "₹600"}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-[10px] uppercase font-bold text-slate-400">Max Guests</span>
                                                        <span className="text-xs font-bold text-slate-700">{req.diningSettings?.maxGuests || 6} Guests</span>
                                                    </div>
                                                </div>

                                                {/* Offer & Notes */}
                                                {(req.diningSettings?.offer || req.offer) && (
                                                    <div className="mb-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                                                        🏷️ Offer: {req.diningSettings?.offer || req.offer}
                                                    </div>
                                                )}

                                                {req.diningSettings?.notes && (
                                                    <div className="mb-3 text-xs text-slate-600 bg-slate-100/70 p-2.5 rounded-xl">
                                                        <span className="font-bold text-slate-700">Proposal / Note: </span>
                                                        {req.diningSettings.notes}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                                                <button
                                                    disabled={isLoading}
                                                    onClick={() => {
                                                        setRejectingRestaurant(req)
                                                        setRejectModalOpen(true)
                                                    }}
                                                    className="px-4 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors disabled:opacity-50"
                                                >
                                                    Reject
                                                </button>
                                                <button
                                                    disabled={isLoading}
                                                    onClick={() => handleApproveRequest(req)}
                                                    className="px-5 py-2 text-xs font-bold text-white bg-[#EB590E] hover:bg-[#D44D0A] rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                                                >
                                                    {isLoading ? (
                                                        <>
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            Approving...
                                                        </>
                                                    ) : (
                                                        <>
                                                            Approve & Activate Live
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 2: All Active Dining Restaurants */}
                {activeTab === "active" && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                                <span className="ml-3 text-slate-600">Loading dining list...</span>
                            </div>
                        ) : restaurants.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center">
                                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                                    <Building2 className="w-10 h-10 text-slate-300" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900 mb-2">No dining restaurants added yet</h2>
                                <p className="text-slate-500 max-w-sm mb-8">
                                    Get started by approving incoming dining requests or editing restaurant dining settings.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                                    <h2 className="text-xl font-bold text-slate-900">Registered Dining Restaurants</h2>

                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="relative flex-1 sm:flex-initial min-w-[250px]">
                                            <input
                                                type="text"
                                                placeholder="Search dining restaurants..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        </div>
                                    </div>
                                </div>

                                {/* Category Filter Chips */}
                                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-4 mb-2">
                                    <button
                                        onClick={() => setSelectedCategory("All")}
                                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${selectedCategory === "All"
                                            ? "bg-blue-600 text-white shadow-md"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                            }`}
                                    >
                                        All ({restaurants.length})
                                    </button>
                                    {categories.map((cat) => {
                                        const count = restaurants.filter(r => r.categories?.some(category => category.slug === cat.slug)).length;
                                        return (
                                            <button
                                                key={cat._id}
                                                onClick={() => setSelectedCategory(cat.slug)}
                                                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${selectedCategory === cat.slug
                                                    ? "bg-blue-600 text-white shadow-md"
                                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                                    }`}
                                            >
                                                {cat.name} ({count})
                                            </button>
                                        )
                                    })}
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-slate-50 border-b border-slate-200">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Restaurant</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Owner</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Zone</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Dining</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Guests</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Rating</th>
                                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                                                <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-700 uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-100">
                                            {filteredRestaurants.length === 0 ? (
                                                <tr>
                                                    <td colSpan={8} className="px-6 py-20 text-center">
                                                        <div className="flex flex-col items-center justify-center">
                                                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                                                <Search className="w-8 h-8 text-slate-300" />
                                                            </div>
                                                            <p className="text-lg font-semibold text-slate-700 mb-1">No dining restaurants found</p>
                                                            <p className="text-sm text-slate-500">
                                                                Try adjusting your search query or filters.
                                                            </p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredRestaurants.map((restaurant, index) => (
                                                    <tr key={restaurant.id} className="hover:bg-slate-50 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex-shrink-0">
                                                                    <img
                                                                        src={restaurant.logo}
                                                                        alt={restaurant.name}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => { e.target.src = "https://via.placeholder.com/40" }}
                                                                    />
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <span className="text-sm font-medium text-slate-900">{restaurant.name}</span>
                                                                    <span className="text-xs text-slate-500">#{formatRestaurantId(restaurant.originalData?.restaurantId || restaurant._id)}</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-medium text-slate-900">{restaurant.ownerName}</span>
                                                                <span className="text-xs text-slate-500">{restaurant.ownerPhone}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <span className="text-sm text-slate-700">{restaurant.zone}</span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <button
                                                                onClick={() => handleDiningToggle(restaurant)}
                                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${restaurant.diningSettings?.isEnabled ? 'bg-[#EB590E]' : 'bg-slate-200'}`}
                                                            >
                                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${restaurant.diningSettings?.isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                            </button>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <select
                                                                value={restaurant.diningSettings?.maxGuests || 6}
                                                                onChange={(e) => handleMaxGuestsUpdate(restaurant, e.target.value)}
                                                                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                            >
                                                                {[2, 4, 6, 8, 10, 12, 16, 20].map(num => (
                                                                    <option key={num} value={num}>{num} Guests</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <div className="flex items-center gap-1">
                                                                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                                                                <span className="text-sm font-medium text-slate-900">{restaurant.rating.toFixed(1)}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${restaurant.diningSettings?.isEnabled
                                                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                                                : "bg-slate-100 text-slate-600"
                                                                }`}>
                                                                {restaurant.diningSettings?.isEnabled ? "Live on Dining" : "Dining Disabled"}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right whitespace-nowrap">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingRestaurant({
                                                                            ...restaurant,
                                                                            coverImage: restaurant.originalData?.coverImage || restaurant.logo || "",
                                                                            costForTwo: restaurant.originalData?.costForTwo || 600,
                                                                            offer: restaurant.originalData?.offer || "",
                                                                        })
                                                                        setImagePreviewUrl(restaurant.logo || restaurant.originalData?.coverImage || "")
                                                                        setIsEditModalOpen(true)
                                                                    }}
                                                                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                                                                    title="Edit Dining Details & Ambience Photo"
                                                                >
                                                                    <Settings className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Reject Reason Modal */}
            {rejectModalOpen && rejectingRestaurant && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <h3 className="text-lg font-bold text-slate-900 mb-2">Reject Dining Request</h3>
                        <p className="text-xs text-slate-500 mb-4">
                            Provide a reason for rejecting the dining activation request from <span className="font-bold text-slate-700">{rejectingRestaurant.restaurantName}</span>.
                        </p>

                        <textarea
                            rows={3}
                            placeholder="e.g. Ambience photos are unclear, please upload HD photos and re-apply."
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 mb-4"
                        />

                        <div className="flex items-center justify-end gap-2.5">
                            <button
                                onClick={() => {
                                    setRejectModalOpen(false)
                                    setRejectingRestaurant(null)
                                    setRejectionReason("")
                                }}
                                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={actionLoadingId === rejectingRestaurant._id}
                                onClick={handleRejectRequest}
                                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                                {actionLoadingId === rejectingRestaurant._id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : null}
                                Confirm Reject
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {isEditModalOpen && editingRestaurant && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-base font-bold text-slate-900">Edit Dining Settings</h3>
                                <p className="text-xs text-slate-500">{editingRestaurant.name}</p>
                            </div>
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <Plus className="w-5 h-5 rotate-45" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto flex-1">
                            {/* Photo Upload Section */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-2">Ambience / Dining Cover Photo</label>
                                <div className="flex gap-4 items-center">
                                    <div className="relative w-28 h-20 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex-shrink-0 group">
                                        {imagePreviewUrl || editingRestaurant.coverImage ? (
                                            <img
                                                src={imagePreviewUrl || resolveMediaUrl(editingRestaurant.coverImage)}
                                                alt="Cover preview"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                                <ImageIcon className="w-6 h-6 mb-1" />
                                                <span className="text-[10px]">No photo</span>
                                            </div>
                                        )}
                                        {uploadingImage && (
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0]
                                                if (!file) return

                                                try {
                                                    setUploadingImage(true)
                                                    const res = await uploadAPI.uploadMedia(new FormData().append("media", file))
                                                    const uploadedUrl = res.data?.data?.url || res.data?.url
                                                    if (uploadedUrl) {
                                                        setImagePreviewUrl(resolveMediaUrl(uploadedUrl))
                                                        setEditingRestaurant(prev => ({
                                                            ...prev,
                                                            coverImage: uploadedUrl
                                                        }))
                                                    }
                                                } catch (uploadErr) {
                                                    debugError("Upload failed", uploadErr)
                                                } finally {
                                                    setUploadingImage(false)
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            disabled={uploadingImage}
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors disabled:opacity-50"
                                        >
                                            <Upload className="w-3.5 h-3.5" />
                                            {uploadingImage ? "Uploading..." : "Upload New Photo"}
                                        </button>
                                        <p className="text-[11px] text-slate-400 mt-1.5">Directly displayed on user dining cards & details.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Dining Status Toggle */}
                            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">Table Reservation Active</p>
                                    <p className="text-xs text-slate-500">Allow users to book tables at this restaurant</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditingRestaurant(prev => ({
                                        ...prev,
                                        diningSettings: { ...prev.diningSettings, isEnabled: !prev.diningSettings?.isEnabled }
                                    }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingRestaurant.diningSettings?.isEnabled ? 'bg-[#EB590E]' : 'bg-slate-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${editingRestaurant.diningSettings?.isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            {/* Pricing Model Selection */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700">Reservation Pricing Model</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: "free", label: "Free (₹0)", desc: "Standard free booking" },
                                        { id: "fixed_fee", label: "Fixed Fee", desc: "Token booking fee" },
                                        { id: "cover_charge", label: "Cover Charge", desc: "Per person fee" },
                                    ].map(model => {
                                        const isSelected = (editingRestaurant.diningSettings?.pricingModel || editingRestaurant.pricingModel || "free") === model.id
                                        return (
                                            <button
                                                key={model.id}
                                                type="button"
                                                onClick={() => setEditingRestaurant(prev => ({
                                                    ...prev,
                                                    pricingModel: model.id,
                                                    diningSettings: { ...prev.diningSettings, pricingModel: model.id }
                                                }))}
                                                className={`p-2.5 rounded-xl text-left border transition-all ${
                                                    isSelected
                                                        ? "border-[#EB590E] bg-orange-50/60 ring-1 ring-[#EB590E]"
                                                        : "border-slate-200 bg-white hover:border-slate-300"
                                                }`}
                                            >
                                                <p className={`text-xs font-bold ${isSelected ? "text-[#EB590E]" : "text-slate-800"}`}>{model.label}</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">{model.desc}</p>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Dynamic Fee Inputs based on Pricing Model */}
                            {(editingRestaurant.diningSettings?.pricingModel === "fixed_fee" || editingRestaurant.pricingModel === "fixed_fee") && (
                                <div className="space-y-1.5 bg-amber-50/50 p-3 rounded-xl border border-amber-200/60">
                                    <label className="text-xs font-bold text-amber-900">Fixed Booking Fee (₹ per reservation)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="e.g. 100"
                                        value={editingRestaurant.diningSettings?.bookingFee || editingRestaurant.bookingFee || ""}
                                        onChange={(e) => {
                                            const val = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0)
                                            setEditingRestaurant(prev => ({
                                                ...prev,
                                                bookingFee: val,
                                                diningSettings: { ...prev.diningSettings, bookingFee: val }
                                            }))
                                        }}
                                        className="w-full px-3.5 py-2 text-xs border border-amber-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-bold text-slate-800"
                                    />
                                    <p className="text-[10px] text-amber-700">Charged once to confirm the table reservation.</p>
                                </div>
                            )}

                            {(editingRestaurant.diningSettings?.pricingModel === "cover_charge" || editingRestaurant.pricingModel === "cover_charge") && (
                                <div className="space-y-1.5 bg-amber-50/50 p-3 rounded-xl border border-amber-200/60">
                                    <label className="text-xs font-bold text-amber-900">Cover Charge (₹ per guest)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="e.g. 500"
                                        value={editingRestaurant.diningSettings?.coverChargePerPerson || editingRestaurant.coverChargePerPerson || ""}
                                        onChange={(e) => {
                                            const val = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0)
                                            setEditingRestaurant(prev => ({
                                                ...prev,
                                                coverChargePerPerson: val,
                                                diningSettings: { ...prev.diningSettings, coverChargePerPerson: val }
                                            }))
                                        }}
                                        className="w-full px-3.5 py-2 text-xs border border-amber-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-bold text-slate-800"
                                    />
                                    <p className="text-[10px] text-amber-700">Adjusted against customer's final food & beverage bill.</p>
                                </div>
                            )}

                            {/* Offer & Cost */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-700">Offer / Promo Badge</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Flat 20% OFF"
                                        value={editingRestaurant.offer || ""}
                                        onChange={(e) => setEditingRestaurant(prev => ({ ...prev, offer: e.target.value }))}
                                        className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-700">Cost For Two (₹)</label>
                                    <input
                                        type="number"
                                        placeholder="600"
                                        value={editingRestaurant.costForTwo || ""}
                                        onChange={(e) => setEditingRestaurant(prev => ({ ...prev, costForTwo: e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                        className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 flex-shrink-0">
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        setLoading(true)
                                        const pModel = editingRestaurant.diningSettings?.pricingModel || editingRestaurant.pricingModel || "free"
                                        const bFee = editingRestaurant.diningSettings?.bookingFee ?? editingRestaurant.bookingFee ?? 0
                                        const cCharge = editingRestaurant.diningSettings?.coverChargePerPerson ?? editingRestaurant.coverChargePerPerson ?? 0

                                        await adminAPI.updateRestaurantDiningSettings(editingRestaurant._id, {
                                            isEnabled: editingRestaurant.diningSettings?.isEnabled === true,
                                            maxGuests: editingRestaurant.diningSettings?.maxGuests || 6,
                                            categoryIds: editingRestaurant.categoryIds || [],
                                            primaryCategoryId: editingRestaurant.primaryCategoryId || editingRestaurant.categoryIds?.[0] || null,
                                            coverImage: editingRestaurant.coverImage,
                                            costForTwo: editingRestaurant.costForTwo,
                                            offer: editingRestaurant.offer,
                                            pricingModel: pModel,
                                            bookingFee: bFee,
                                            coverChargePerPerson: cCharge,
                                        })
                                        setRestaurants(prev => prev.map(r => r._id === editingRestaurant._id ? {
                                            ...r,
                                            ...editingRestaurant,
                                            pricingModel: pModel,
                                            bookingFee: bFee,
                                            coverChargePerPerson: cCharge,
                                            diningSettings: {
                                                ...r.diningSettings,
                                                ...editingRestaurant.diningSettings,
                                                pricingModel: pModel,
                                                bookingFee: bFee,
                                                coverChargePerPerson: cCharge,
                                            }
                                        } : r))
                                        setIsEditModalOpen(false)
                                    } catch (err) {
                                        debugError("Update failed", err)
                                    } finally {
                                        setLoading(false)
                                    }
                                }}
                                className="px-5 py-2 text-sm font-bold text-white bg-[#EB590E] hover:bg-[#D44D0A] rounded-xl transition-colors shadow-md"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
