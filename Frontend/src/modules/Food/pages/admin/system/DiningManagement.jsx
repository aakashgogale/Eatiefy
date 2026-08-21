import { useState, useEffect, useRef } from "react"
import { Upload, Trash2, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, Layout, UtensilsCrossed, Edit, X, Power, ExternalLink, RefreshCw } from "lucide-react"
import api, { adminAPI, uploadAPI } from "@food/api"
import { getModuleToken } from "@food/utils/auth"
import { resolveMediaUrl } from "@food/utils/common"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { Button } from "@food/components/ui/button"

const debugError = (...args) => {}

export default function DiningManagement() {
    const [activeTab, setActiveTab] = useState('categories')

    // Categories State
    const [categories, setCategories] = useState([])
    const [categoriesLoading, setCategoriesLoading] = useState(true)
    const [categoriesUploading, setCategoriesUploading] = useState(false)
    const [categoriesDeleting, setCategoriesDeleting] = useState(null)
    const [categoryName, setCategoryName] = useState("")
    const [categoryFile, setCategoryFile] = useState(null)
    const [categoryPreviewUrl, setCategoryPreviewUrl] = useState("")
    const [editingCategoryId, setEditingCategoryId] = useState(null)
    const [editingCategoryImageUrl, setEditingCategoryImageUrl] = useState("")
    const categoryFileInputRef = useRef(null)

    // Banners State
    const [banners, setBanners] = useState([])
    const [bannersLoading, setBannersLoading] = useState(true)
    const [bannersUploading, setBannersUploading] = useState(false)
    const [bannersDeleting, setBannersDeleting] = useState(null)
    const [togglingBannerId, setTogglingBannerId] = useState(null)
    const [bannerFile, setBannerFile] = useState(null)
    const [bannerPreviewUrl, setBannerPreviewUrl] = useState("")
    const [bannerTagline, setBannerTagline] = useState("")
    const [bannerPromoText, setBannerPromoText] = useState("")
    const [bannerCtaText, setBannerCtaText] = useState("Reserve Table")
    const [bannerCtaLink, setBannerCtaLink] = useState("")
    const [editingBannerId, setEditingBannerId] = useState(null)
    const [editingBannerImageUrl, setEditingBannerImageUrl] = useState("")
    const bannerFileInputRef = useRef(null)

    // Common State
    const [error, setError] = useState(null)
    const [success, setSuccess] = useState(null)

    const getAuthConfig = (additionalConfig = {}) => {
        const adminToken = getModuleToken('admin')
        if (!adminToken) return additionalConfig
        return {
            ...additionalConfig,
            headers: {
                ...additionalConfig.headers,
                Authorization: `Bearer ${adminToken.trim()}`,
            }
        }
    }

    useEffect(() => {
        fetchCategories()
    }, [])

    useEffect(() => {
        setError(null)
        setSuccess(null)
        if (activeTab === 'banners') {
            fetchBanners()
        }
    }, [activeTab])

    // Cleanup object URLs on unmount
    useEffect(() => {
        return () => {
            if (categoryPreviewUrl && categoryPreviewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(categoryPreviewUrl)
            }
            if (bannerPreviewUrl && bannerPreviewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(bannerPreviewUrl)
            }
        }
    }, [categoryPreviewUrl, bannerPreviewUrl])

    // ==================== CATEGORIES ====================
    const fetchCategories = async () => {
        try {
            setCategoriesLoading(true)
            const response = await adminAPI.getDiningCategories()
            if (response.data.success) {
                setCategories(response.data.data.categories || [])
            }
        } catch (err) {
            debugError(err)
        } finally {
            setCategoriesLoading(false)
        }
    }

    const resetCategoryForm = () => {
        setCategoryName("")
        setCategoryFile(null)
        setCategoryPreviewUrl("")
        setEditingCategoryId(null)
        setEditingCategoryImageUrl("")
        if (categoryFileInputRef.current) categoryFileInputRef.current.value = ""
    }

    const handleEditCategory = (category) => {
        setError(null)
        setSuccess(null)
        setEditingCategoryId(category._id)
        setCategoryName(category.name || "")
        setCategoryFile(null)
        setCategoryPreviewUrl("")
        setEditingCategoryImageUrl(category.imageUrl || "")
        if (categoryFileInputRef.current) categoryFileInputRef.current.value = ""
    }

    const handleCategoryFileChange = (e) => {
        const file = e.target.files?.[0] || null
        setCategoryFile(file)
        if (file) {
            setCategoryPreviewUrl(URL.createObjectURL(file))
        } else {
            setCategoryPreviewUrl("")
        }
    }

    const handleSubmitCategory = async () => {
        const trimmedCategoryName = categoryName.trim()
        if (!trimmedCategoryName) return setError("Category name is required")
        if (!editingCategoryId && !categoryFile) return setError("Category Name and Image are required")

        try {
            setError(null)
            setSuccess(null)
            setCategoriesUploading(true)
            let imageUrl = editingCategoryImageUrl

            if (categoryFile) {
                const uploadResponse = await uploadAPI.uploadMedia(categoryFile, { folder: "eatiefy/dining/categories" })
                imageUrl = uploadResponse?.data?.data?.url || ""
            }

            const response = editingCategoryId
                ? await adminAPI.updateDiningCategory(editingCategoryId, {
                    name: trimmedCategoryName,
                    ...(imageUrl ? { imageUrl } : {}),
                })
                : await adminAPI.createDiningCategory({
                    name: trimmedCategoryName,
                    imageUrl,
                })

            if (response.data.success) {
                setSuccess(editingCategoryId ? "Category updated successfully" : "Category created successfully")
                resetCategoryForm()
                fetchCategories()
            }
        } catch (err) {
            setError(err.response?.data?.message || (editingCategoryId ? "Failed to update category" : "Failed to create category"))
        } finally {
            setCategoriesUploading(false)
        }
    }

    const handleDeleteCategory = async (id) => {
        if (!window.confirm("Are you sure you want to delete this category?")) return
        try {
            setCategoriesDeleting(id)
            await adminAPI.deleteDiningCategory(id)
            fetchCategories()
            setSuccess("Category deleted successfully")
        } catch (err) {
            setError("Failed to delete category")
        } finally {
            setCategoriesDeleting(null)
        }
    }

    // ==================== BANNERS ====================
    const fetchBanners = async () => {
        try {
            setBannersLoading(true)
            const response = await api.get('/food/hero-banners/dining', getAuthConfig())
            if (response.data.success) {
                setBanners(response.data.data.banners || [])
            } else {
                setBanners([])
            }
        } catch (err) {
            debugError(err)
            setBanners([])
        } finally {
            setBannersLoading(false)
        }
    }

    const handleBannerFileChange = (e) => {
        const file = e.target.files?.[0] || null
        setBannerFile(file)
        if (file) {
            setBannerPreviewUrl(URL.createObjectURL(file))
        } else {
            setBannerPreviewUrl("")
        }
    }

    const resetBannerForm = () => {
        setBannerFile(null)
        setBannerPreviewUrl("")
        setBannerTagline("")
        setBannerPromoText("")
        setBannerCtaText("Reserve Table")
        setBannerCtaLink("")
        setEditingBannerId(null)
        setEditingBannerImageUrl("")
        if (bannerFileInputRef.current) bannerFileInputRef.current.value = ""
    }

    const handleEditBanner = (banner) => {
        setError(null)
        setSuccess(null)
        setEditingBannerId(banner._id)
        setBannerTagline(banner.title || "")
        setBannerPromoText(banner.ctaText || "")
        setBannerCtaText(banner.ctaButtonText || "Reserve Table")
        setBannerCtaLink(banner.ctaLink || "")
        setBannerFile(null)
        setBannerPreviewUrl("")
        setEditingBannerImageUrl(banner.imageUrl || "")
        if (bannerFileInputRef.current) bannerFileInputRef.current.value = ""
        window.scrollTo({ top: 0, behavior: "smooth" })
    }

    const handleToggleBannerStatus = async (banner) => {
        try {
            setTogglingBannerId(banner._id)
            await api.patch(`/food/hero-banners/dining/${banner._id}/status`, {}, getAuthConfig())
            fetchBanners()
            setSuccess(`Banner ${banner.isActive !== false ? "deactivated" : "activated"} successfully`)
        } catch (err) {
            setError(err.response?.data?.message || "Failed to update banner status")
        } finally {
            setTogglingBannerId(null)
        }
    }

    const handleSubmitBanner = async () => {
        setError(null)
        setSuccess(null)

        if (!editingBannerId && !bannerFile) {
            return setError("Banner image is required")
        }

        try {
            setBannersUploading(true)

            if (editingBannerId) {
                // Update existing banner
                let imageUrl = editingBannerImageUrl
                if (bannerFile) {
                    try {
                        const uploadRes = await uploadAPI.uploadMedia(bannerFile, { folder: "eatiefy/dining/banners" })
                        if (uploadRes?.data?.data?.url) {
                            imageUrl = uploadRes.data.data.url
                        }
                    } catch {
                        // Fallback upload
                    }
                }

                const payload = {
                    title: bannerTagline.trim(),
                    ctaText: bannerPromoText.trim(),
                    ctaLink: bannerCtaLink.trim(),
                    ...(imageUrl ? { imageUrl } : {})
                }

                const response = await api.patch(`/food/hero-banners/dining/${editingBannerId}`, payload, getAuthConfig())
                if (response.data.success) {
                    setSuccess("Dining page banner updated successfully")
                    resetBannerForm()
                    fetchBanners()
                }
            } else {
                // Create new banner
                // Try uploadAPI first for Cloudinary/CDN parity
                let uploadedUrl = ""
                if (bannerFile) {
                    try {
                        const uploadRes = await uploadAPI.uploadMedia(bannerFile, { folder: "eatiefy/dining/banners" })
                        if (uploadRes?.data?.data?.url) {
                            uploadedUrl = uploadRes.data.data.url
                        }
                    } catch (uploadErr) {
                        debugError("Direct upload fallback", uploadErr)
                    }
                }

                const formData = new FormData()
                formData.append('files', bannerFile)
                if (bannerTagline.trim()) formData.append('title', bannerTagline.trim())
                if (bannerPromoText.trim()) formData.append('ctaText', bannerPromoText.trim())
                if (bannerCtaLink.trim()) formData.append('ctaLink', bannerCtaLink.trim())

                const response = await api.post('/food/hero-banners/dining/multiple', formData, getAuthConfig({
                    headers: { 'Content-Type': 'multipart/form-data' }
                }))

                if (response.data.success) {
                    // If we got a cloud CDN URL from uploadAPI, update the newly created banner's imageUrl
                    if (uploadedUrl && response.data.data?.banners?.[0]?.banner?._id) {
                        const newBannerId = response.data.data.banners[0].banner._id
                        await api.patch(`/food/hero-banners/dining/${newBannerId}`, { imageUrl: uploadedUrl }, getAuthConfig()).catch(() => {})
                    }
                    setSuccess("Dining page banner created successfully")
                    resetBannerForm()
                    fetchBanners()
                }
            }
        } catch (err) {
            setError(err.response?.data?.message || (editingBannerId ? "Failed to update dining banner" : "Failed to create dining banner"))
        } finally {
            setBannersUploading(false)
        }
    }

    const handleDeleteBanner = async (id) => {
        if (!window.confirm("Are you sure you want to delete this banner?")) return
        try {
            setBannersDeleting(id)
            await api.delete(`/food/hero-banners/dining/${id}`, getAuthConfig())
            fetchBanners()
            setSuccess("Banner deleted successfully")
        } catch (err) {
            setError("Failed to delete banner")
        } finally {
            setBannersDeleting(null)
        }
    }

    const tabs = [
        { id: 'categories', label: 'Dining Categories', icon: Layout },
        { id: 'banners', label: 'Dining Banners', icon: ImageIcon },
    ]

    return (
        <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-md">
                                <UtensilsCrossed className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Dining Management</h1>
                                <p className="text-sm text-slate-600 mt-1">Manage dining categories, restaurant links, and promo hero banners</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                if (activeTab === 'categories') fetchCategories()
                                else fetchBanners()
                            }}
                            className="gap-2 text-slate-700"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 mb-6">
                    <div className="flex gap-2">
                        {tabs.map((tab) => {
                            const Icon = tab.icon
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                                        activeTab === tab.id
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Messages */}
                {success && (
                    <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center gap-2 max-w-3xl animate-in fade-in">
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <span className="font-medium text-sm">{success}</span>
                    </div>
                )}
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center gap-2 max-w-3xl animate-in fade-in">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <span className="font-medium text-sm">{error}</span>
                    </div>
                )}

                {/* ==================== CATEGORIES TAB ==================== */}
                {activeTab === 'categories' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sticky top-6">
                                <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
                                    <h2 className="text-lg font-bold text-slate-900">
                                        {editingCategoryId ? "Edit Category" : "Add Category"}
                                    </h2>
                                    {editingCategoryId && (
                                        <Button type="button" variant="ghost" size="sm" onClick={resetCategoryForm} className="gap-1 text-slate-500 hover:text-slate-800">
                                            <X className="w-4 h-4" />
                                            Cancel
                                        </Button>
                                    )}
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">Category Name *</Label>
                                        <Input
                                            value={categoryName}
                                            onChange={e => setCategoryName(e.target.value)}
                                            placeholder="e.g. Fine Dining, Cafes, Rooftop"
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">
                                            {editingCategoryId ? "Replace Image (Optional)" : "Category Image *"}
                                        </Label>
                                        <Input
                                            type="file"
                                            ref={categoryFileInputRef}
                                            onChange={handleCategoryFileChange}
                                            accept="image/*"
                                            className="mt-1 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                        />
                                        {(categoryPreviewUrl || editingCategoryImageUrl) && (
                                            <div className="mt-3 relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                                <img
                                                    src={categoryPreviewUrl || resolveMediaUrl(editingCategoryImageUrl)}
                                                    alt="Preview"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null
                                                        e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=300&fit=crop"
                                                    }}
                                                />
                                                <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded">
                                                    {categoryPreviewUrl ? "New Selected Image" : "Current Image"}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <Button
                                        onClick={handleSubmitCategory}
                                        disabled={categoriesUploading}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                                    >
                                        {categoriesUploading ? (
                                            <span className="flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Saving...
                                            </span>
                                        ) : (
                                            editingCategoryId ? "Update Category" : "Create Category"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-2">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-900">Categories List</h2>
                                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                                        {categories.length} Categories
                                    </span>
                                </div>
                                {categoriesLoading ? (
                                    <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                                        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                                        <p className="text-xs font-medium">Loading categories...</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {categories.map(cat => (
                                            <div key={cat._id} className="border border-slate-200 rounded-xl overflow-hidden group relative bg-white hover:shadow-md transition-all">
                                                <div className="h-32 bg-slate-100 relative overflow-hidden">
                                                    <img
                                                        src={resolveMediaUrl(cat.imageUrl)}
                                                        alt={cat.name}
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null
                                                            e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=300&fit=crop"
                                                        }}
                                                    />
                                                </div>
                                                <div className="p-3 bg-white flex items-center justify-between">
                                                    <p className="font-semibold text-slate-900 text-sm truncate">{cat.name}</p>
                                                </div>
                                                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm p-1 rounded-lg shadow-sm">
                                                    <button
                                                        onClick={() => handleEditCategory(cat)}
                                                        className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"
                                                        title="Edit Category"
                                                    >
                                                        <Edit className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteCategory(cat._id)}
                                                        className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                                                        title="Delete Category"
                                                    >
                                                        {categoriesDeleting === cat._id ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {categories.length === 0 && (
                                            <div className="text-slate-400 text-center col-span-full py-12 border-2 border-dashed border-slate-200 rounded-xl">
                                                <UtensilsCrossed className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                <p className="text-sm font-medium">No categories found</p>
                                                <p className="text-xs text-slate-400 mt-0.5">Add your first category from the left form.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ==================== BANNERS TAB ==================== */}
                {activeTab === 'banners' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sticky top-6">
                                <div className="flex items-center justify-between gap-3 mb-2 pb-3 border-b border-slate-100">
                                    <h2 className="text-lg font-bold text-slate-900">
                                        {editingBannerId ? "Edit Dining Banner" : "Add Dining Page Banner"}
                                    </h2>
                                    {editingBannerId && (
                                        <Button type="button" variant="ghost" size="sm" onClick={resetBannerForm} className="gap-1 text-slate-500 hover:text-slate-800">
                                            <X className="w-4 h-4" />
                                            Cancel
                                        </Button>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 mb-4">
                                    This hero promo banner displays at the top of the user Dining section.
                                </p>
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">
                                            {editingBannerId ? "Replace Banner Image (Optional)" : "Banner Image *"}
                                        </Label>
                                        <Input
                                            type="file"
                                            ref={bannerFileInputRef}
                                            onChange={handleBannerFileChange}
                                            accept="image/*"
                                            className="mt-1 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                        />
                                        {(bannerPreviewUrl || editingBannerImageUrl) && (
                                            <div className="mt-3 relative w-full h-36 rounded-lg overflow-hidden border border-slate-200 bg-slate-900">
                                                <img
                                                    src={bannerPreviewUrl || resolveMediaUrl(editingBannerImageUrl)}
                                                    alt="Banner Preview"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null
                                                        e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=600&fit=crop"
                                                    }}
                                                />
                                                <span className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded">
                                                    {bannerPreviewUrl ? "New Selected Preview" : "Current Active Image"}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">Heading / Title</Label>
                                        <Input
                                            value={bannerTagline}
                                            onChange={e => setBannerTagline(e.target.value)}
                                            placeholder="e.g. Dining, Gourmet Delights"
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">Promo / Subtitle Text</Label>
                                        <Input
                                            value={bannerPromoText}
                                            onChange={e => setBannerPromoText(e.target.value)}
                                            placeholder="e.g. Discover fresh dining picks near you..."
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs font-semibold text-slate-700">CTA Link / Path (Optional)</Label>
                                        <Input
                                            value={bannerCtaLink}
                                            onChange={e => setBannerCtaLink(e.target.value)}
                                            placeholder="e.g. /food/user/dining/restaurants or https://..."
                                            className="mt-1"
                                        />
                                    </div>
                                    <Button
                                        onClick={handleSubmitBanner}
                                        disabled={bannersUploading}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                                    >
                                        {bannersUploading ? (
                                            <span className="flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                {editingBannerId ? "Updating..." : "Uploading Banner..."}
                                            </span>
                                        ) : (
                                            editingBannerId ? "Update Banner" : "Create Banner"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-2">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-900">Active Dining Banners</h2>
                                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                                        {banners.length} {banners.length === 1 ? "Banner" : "Banners"}
                                    </span>
                                </div>
                                {bannersLoading ? (
                                    <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                                        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                                        <p className="text-xs font-medium">Loading dining banners...</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {banners.map(banner => (
                                            <div
                                                key={banner._id}
                                                className={`border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-all relative flex flex-col ${
                                                    banner.isActive === false ? "border-slate-200 opacity-70" : "border-blue-100 ring-1 ring-blue-500/20"
                                                }`}
                                            >
                                                <div className="h-36 bg-slate-900 relative overflow-hidden">
                                                    <img
                                                        src={resolveMediaUrl(banner.imageUrl)}
                                                        alt={banner.title || "Dining banner"}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null
                                                            e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=600&fit=crop"
                                                        }}
                                                    />
                                                    <div className="absolute top-2 left-2">
                                                        <span
                                                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-md shadow-sm ${
                                                                banner.isActive !== false
                                                                    ? "bg-emerald-500 text-white"
                                                                    : "bg-slate-700 text-slate-200"
                                                            }`}
                                                        >
                                                            {banner.isActive !== false ? "Active on App" : "Inactive"}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="p-4 bg-white flex-1 flex flex-col justify-between">
                                                    <div>
                                                        <h3 className="font-bold text-slate-900 text-sm">
                                                            {banner.title || "Dining"}
                                                        </h3>
                                                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                                                            {banner.ctaText || "Discover fresh, incredible dining picks..."}
                                                        </p>
                                                        {banner.ctaLink && (
                                                            <div className="flex items-center gap-1 text-[11px] text-blue-600 mt-2 font-medium truncate">
                                                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                                                <span className="truncate">{banner.ctaLink}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleToggleBannerStatus(banner)}
                                                            disabled={togglingBannerId === banner._id}
                                                            className={`h-8 text-xs font-semibold gap-1.5 ${
                                                                banner.isActive !== false
                                                                    ? "text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                                                                    : "text-slate-600 hover:bg-slate-100"
                                                            }`}
                                                        >
                                                            {togglingBannerId === banner._id ? (
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                <Power className="w-3 h-3" />
                                                            )}
                                                            {banner.isActive !== false ? "Active" : "Enable"}
                                                        </Button>

                                                        <div className="flex items-center gap-1.5">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleEditBanner(banner)}
                                                                className="h-8 px-2.5 text-xs text-blue-600 hover:bg-blue-50 border-blue-200 gap-1"
                                                            >
                                                                <Edit className="w-3.5 h-3.5" />
                                                                Edit
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleDeleteBanner(banner._id)}
                                                                disabled={bannersDeleting === banner._id}
                                                                className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-50 border-red-200"
                                                            >
                                                                {bannersDeleting === banner._id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                )}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {banners.length === 0 && (
                                            <div className="text-slate-400 text-center col-span-full py-12 border-2 border-dashed border-slate-200 rounded-xl">
                                                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                <p className="text-sm font-medium">No dining hero banners yet</p>
                                                <p className="text-xs text-slate-400 mt-0.5">Add a banner on the left to show on the user dining page.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}


