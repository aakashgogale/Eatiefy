import { useState, useMemo, useEffect } from "react"
import { 
  Search, Plus, Edit, Trash2, ArrowUpDown, 
  Percent, Loader2, X, Building2, IndianRupee,
  Sliders, ShieldCheck, Sparkles, AlertCircle, CheckCircle2,
  HelpCircle, RefreshCw
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"

const debugError = (...args) => {}

export default function RestaurantCommission() {
  const [searchQuery, setSearchQuery] = useState("")
  const [commissions, setCommissions] = useState([])
  const [approvedRestaurants, setApprovedRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isAddEditOpen, setIsAddEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isRestaurantSelectOpen, setIsRestaurantSelectOpen] = useState(false)
  const [selectedCommission, setSelectedCommission] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)

  // Global commission state
  const [globalCommission, setGlobalCommission] = useState({
    enabled: false,
    type: "percentage", // "percentage" | "amount"
    value: "",
    notes: ""
  })
  const [savingGlobal, setSavingGlobal] = useState(false)

  // Per-restaurant custom form data
  const [formData, setFormData] = useState({
    restaurantId: "",
    defaultCommission: {
      type: "percentage",
      value: ""
    },
    notes: ""
  })
  const [formErrors, setFormErrors] = useState({})
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    restaurant: true,
    restaurantId: true,
    defaultCommission: true,
    status: true,
    actions: true,
  })

  const filteredCommissions = useMemo(() => {
    if (!searchQuery.trim()) {
      return commissions
    }
    
    const query = searchQuery.toLowerCase().trim()
    return commissions.filter(commission =>
      commission.restaurantName?.toLowerCase().includes(query) ||
      commission.restaurantId?.toLowerCase().includes(query) ||
      commission.restaurant?.name?.toLowerCase().includes(query)
    )
  }, [commissions, searchQuery])

  const filteredRestaurants = useMemo(() => {
    if (!searchQuery.trim()) {
      return approvedRestaurants
    }
    
    const query = searchQuery.toLowerCase().trim()
    return approvedRestaurants.filter(restaurant =>
      restaurant.name?.toLowerCase().includes(query) ||
      restaurant.restaurantId?.toLowerCase().includes(query) ||
      restaurant.ownerName?.toLowerCase().includes(query)
    )
  }, [approvedRestaurants, searchQuery])

  // Fetch data on component mount
  useEffect(() => {
    fetchBootstrap()
  }, [])

  const fetchBootstrap = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getRestaurantCommissionBootstrap()
      const data = response?.data?.data
      setCommissions(Array.isArray(data?.commissions) ? data.commissions : [])
      setApprovedRestaurants(Array.isArray(data?.restaurants) ? data.restaurants : [])
      if (data?.globalCommission) {
        setGlobalCommission({
          enabled: data.globalCommission.enabled !== false,
          type: data.globalCommission.type || "percentage",
          value: data.globalCommission.value?.toString() ?? "0",
          notes: data.globalCommission.notes || ""
        })
      }
    } catch (error) {
      debugError('Error fetching bootstrap:', error)
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        toast.error(`Cannot connect to backend server. Please ensure the backend is running on ${API_BASE_URL.replace('/api', '')}`)
      } else {
        toast.error(error.response?.data?.message || 'Failed to fetch commissions')
      }
      setCommissions([])
      setApprovedRestaurants([])
    } finally {
      setLoading(false)
    }
  }

  const fetchCommissions = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getRestaurantCommissions({})
      let commissionsData = null
      if (response?.data?.success && response?.data?.data?.commissions) {
        commissionsData = response.data.data.commissions
      } else if (response?.data?.data?.commissions) {
        commissionsData = response.data.data.commissions
      } else if (response?.data?.commissions) {
        commissionsData = response.data.commissions
      }
      
      if (commissionsData && Array.isArray(commissionsData)) {
        setCommissions(commissionsData)
      } else {
        setCommissions([])
      }
    } catch (error) {
      debugError('Error fetching commissions:', error)
      toast.error(error.response?.data?.message || 'Failed to fetch commissions')
      setCommissions([])
    } finally {
      setLoading(false)
    }
  }

  // Handle saving Global Commission
  const handleSaveGlobalCommission = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    const numVal = parseFloat(globalCommission.value)
    if (isNaN(numVal) || numVal < 0) {
      toast.error("Please enter a valid commission value (0 or greater)")
      return
    }
    if (globalCommission.type === "percentage" && numVal > 100) {
      toast.error("Percentage commission cannot exceed 100%")
      return
    }

    try {
      setSavingGlobal(true)
      const payload = {
        enabled: Boolean(globalCommission.enabled),
        type: globalCommission.type,
        value: numVal,
        notes: globalCommission.notes || ""
      }
      const res = await adminAPI.updateGlobalRestaurantCommission(payload)
      if (res?.data?.success) {
        toast.success("Global restaurant commission updated successfully")
        if (res.data.data) {
          setGlobalCommission({
            enabled: res.data.data.enabled !== false,
            type: res.data.data.type || "percentage",
            value: res.data.data.value?.toString() ?? "0",
            notes: res.data.data.notes || ""
          })
        }
      }
    } catch (error) {
      debugError("Error saving global commission:", error)
      toast.error(error.response?.data?.message || "Failed to update global commission")
    } finally {
      setSavingGlobal(false)
    }
  }

  const handleToggleStatus = async (commission) => {
    try {
      await adminAPI.toggleRestaurantCommissionStatus(commission._id)
      await fetchCommissions()
      toast.success('Commission status updated successfully')
    } catch (error) {
      debugError('Error toggling status:', error)
      toast.error(error.response?.data?.message || 'Failed to update status')
    }
  }

  const handleAdd = () => {
    setSelectedCommission(null)
    setSelectedRestaurant(null)
    setFormData({
      restaurantId: "",
      defaultCommission: {
        type: "percentage",
        value: "10"
      },
      notes: ""
    })
    setFormErrors({})
    setIsRestaurantSelectOpen(true)
  }

  const handleSelectRestaurant = (restaurant) => {
    setSelectedRestaurant(restaurant)
    setFormData(prev => ({
      ...prev,
      restaurantId: restaurant._id
    }))
    setIsRestaurantSelectOpen(false)
    setIsAddEditOpen(true)
  }

  const handleEdit = async (commission) => {
    try {
      setLoading(true)
      const response = await adminAPI.getRestaurantCommissionById(commission._id)
      
      let commissionData = null
      if (response?.data?.success && response?.data?.data?.commission) {
        commissionData = response.data.data.commission
      } else if (response?.data?.data?.commission) {
        commissionData = response.data.data.commission
      } else if (response?.data?.commission) {
        commissionData = response.data.commission
      }

      if (commissionData) {
        setSelectedCommission(commissionData)
        setSelectedRestaurant(commissionData.restaurant)
        
        let restaurantId = ""
        if (commissionData.restaurant) {
          if (typeof commissionData.restaurant === 'object' && commissionData.restaurant._id) {
            restaurantId = commissionData.restaurant._id
          } else if (typeof commissionData.restaurant === 'string') {
            restaurantId = commissionData.restaurant
          } else {
            restaurantId = commissionData.restaurantId || commissionData.restaurant?._id || ""
          }
        } else {
          restaurantId = commissionData.restaurantId || commissionData.restaurant || ""
        }
        
        setFormData({
          restaurantId: restaurantId,
          defaultCommission: {
            type: commissionData.defaultCommission?.type || "percentage",
            value: commissionData.defaultCommission?.value?.toString() || "10"
          },
          notes: commissionData.notes || ""
        })
        setFormErrors({})
        setIsAddEditOpen(true)
      }
    } catch (error) {
      debugError('Error fetching commission:', error)
      toast.error(error.response?.data?.message || 'Failed to load commission')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (commission) => {
    setSelectedCommission(commission)
    setIsDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedCommission) return

    try {
      setDeleting(true)
      await adminAPI.deleteRestaurantCommission(selectedCommission._id)
      await fetchCommissions()
      toast.success('Commission deleted successfully')
      setIsDeleteOpen(false)
      setSelectedCommission(null)
    } catch (error) {
      debugError('Error deleting commission:', error)
      toast.error(error.response?.data?.message || 'Failed to delete commission')
    } finally {
      setDeleting(false)
    }
  }

  const validateForm = () => {
    const errors = {}
    
    if (!formData.restaurantId) {
      errors.restaurantId = "Restaurant is required"
    }

    if (!formData.defaultCommission.value || parseFloat(formData.defaultCommission.value) < 0) {
      errors.defaultCommission = "Commission value is required (0 or greater)"
    }

    if (formData.defaultCommission.type === "percentage" && 
        (parseFloat(formData.defaultCommission.value) < 0 || parseFloat(formData.defaultCommission.value) > 100)) {
      errors.defaultCommission = "Percentage must be between 0 and 100"
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error("Please fix the errors in the form")
      return
    }

    try {
      setSaving(true)
      
      const payload = {
        restaurantId: formData.restaurantId,
        defaultCommission: {
          type: formData.defaultCommission.type,
          value: parseFloat(formData.defaultCommission.value)
        },
        notes: formData.notes
      }

      if (selectedCommission) {
        await adminAPI.updateRestaurantCommission(selectedCommission._id, payload)
        toast.success('Restaurant commission updated successfully')
      } else {
        await adminAPI.createRestaurantCommission(payload)
        toast.success('Restaurant commission created successfully')
      }

      await fetchCommissions()
      setIsAddEditOpen(false)
      setSelectedCommission(null)
      setSelectedRestaurant(null)
    } catch (error) {
      debugError('Error saving commission:', error)
      toast.error(error.response?.data?.message || 'Failed to save commission')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* TOP BAR / TITLE */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Sliders className="w-6 h-6 text-blue-600" />
              Restaurant Commission Management
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Configure global default commission per order (₹ or %) and override for specific restaurants.
            </p>
          </div>
          <button
            onClick={fetchBootstrap}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm transition-all self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            Refresh
          </button>
        </div>

        {/* 1. GLOBAL DEFAULT COMMISSION CARD */}
        <div className="bg-gradient-to-br from-white via-white to-blue-50/40 rounded-2xl shadow-sm border border-slate-200/80 p-6 lg:p-7 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-blue-600 rounded-xl text-white shadow-md shadow-blue-600/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-900">Global Default Commission</h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    globalCommission.enabled 
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200" 
                      : "bg-slate-100 text-slate-600 border border-slate-200"
                  }`}>
                    {globalCommission.enabled ? "Active for All Restaurants" : "Disabled"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Applied to every order placed with restaurants that don't have an individual custom commission setup.
                </p>
              </div>
            </div>

            {/* Enable/Disable Toggle */}
            <div className="flex items-center gap-3 self-start lg:self-center bg-slate-50 p-2 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-700">
                {globalCommission.enabled ? "Commission Enabled" : "Commission Disabled"}
              </span>
              <button
                type="button"
                onClick={() => setGlobalCommission(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  globalCommission.enabled ? "bg-blue-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                    globalCommission.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Form Fields for Global Commission */}
          <form onSubmit={handleSaveGlobalCommission} className="mt-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              
              {/* Type Selection */}
              <div className="md:col-span-4 space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Commission Mode
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setGlobalCommission(prev => ({ ...prev, type: "percentage" }))}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      globalCommission.type === "percentage"
                        ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Percent className="w-3.5 h-3.5" />
                    Percentage (%)
                  </button>

                  <button
                    type="button"
                    onClick={() => setGlobalCommission(prev => ({ ...prev, type: "amount" }))}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      globalCommission.type === "amount"
                        ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <IndianRupee className="w-3.5 h-3.5" />
                    Fixed Rupee (₹)
                  </button>
                </div>
              </div>

              {/* Value Input */}
              <div className="md:col-span-4 space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  {globalCommission.type === "percentage" ? "Commission Rate (%)" : "Commission Per Order (₹)"}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-sm">
                    {globalCommission.type === "percentage" ? "%" : "₹"}
                  </div>
                  <input
                    type="number"
                    step={globalCommission.type === "percentage" ? "0.1" : "0.01"}
                    min="0"
                    max={globalCommission.type === "percentage" ? "100" : undefined}
                    value={globalCommission.value}
                    onChange={(e) => setGlobalCommission(prev => ({ ...prev, value: e.target.value }))}
                    placeholder={globalCommission.type === "percentage" ? "e.g. 10 (10% of subtotal)" : "e.g. 10 (₹10 per order)"}
                    className="w-full pl-9 pr-4 py-2.5 text-sm font-semibold rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {globalCommission.type === "percentage" 
                    ? "Deducted as % of food items subtotal." 
                    : "Flat ₹ fee deducted from restaurant share per order."}
                </p>
              </div>

              {/* Notes */}
              <div className="md:col-span-4 space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Remarks / Notes <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={globalCommission.notes}
                  onChange={(e) => setGlobalCommission(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="e.g. Default platform charge per order"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                />
                <p className="text-[11px] text-slate-400">Internal reference memo</p>
              </div>

            </div>

            {/* Save Button & Summary */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>
                  Current Active Rule:{" "}
                  <strong>
                    {globalCommission.enabled 
                      ? (globalCommission.type === "percentage" ? `${globalCommission.value}% per order` : `₹${globalCommission.value} flat per order`)
                      : "0 (Disabled)"}
                  </strong>
                </span>
              </div>

              <button
                type="submit"
                disabled={savingGlobal}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed self-end sm:self-auto"
              >
                {savingGlobal ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Global Commission
              </button>
            </div>
          </form>
        </div>

        {/* 2. RESTAURANT-SPECIFIC COMMISSION OVERRIDES */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 lg:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">Restaurant-Specific Overrides</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {commissions.length} Custom {commissions.length === 1 ? 'Rule' : 'Rules'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Set custom commission percentage or flat rupee rate for individual partner restaurants.
              </p>
            </div>

            <button 
              onClick={handleAdd}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-2 transition-all shadow-sm self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              Add Restaurant Override
            </button>
          </div>

          {/* Search */}
          <div className="mb-5 flex items-center gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <input
                type="text"
                placeholder="Search by restaurant name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
              <p className="text-sm">Loading commission rules...</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full">
                <thead className="bg-slate-50/80 border-b border-slate-200">
                  <tr>
                    {visibleColumns.si && (
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        S.No
                      </th>
                    )}
                    {visibleColumns.restaurant && (
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Restaurant
                      </th>
                    )}
                    {visibleColumns.restaurantId && (
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Restaurant ID
                      </th>
                    )}
                    {visibleColumns.defaultCommission && (
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Custom Commission
                      </th>
                    )}
                    {visibleColumns.status && (
                      <th className="px-5 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Status
                      </th>
                    )}
                    {visibleColumns.actions && (
                      <th className="px-5 py-3.5 text-center text-[11px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredCommissions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-medium text-slate-700 text-sm">No custom restaurant commission overrides configured</p>
                        <p className="text-xs text-slate-400 mt-1">All restaurants currently use the Global Default Commission setting above.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredCommissions.map((commission, idx) => (
                      <tr key={commission._id} className="hover:bg-slate-50/70 transition-colors">
                        {visibleColumns.si && (
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-500">
                            {commission.sl || (idx + 1)}
                          </td>
                        )}
                        {visibleColumns.restaurant && (
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className="text-sm font-bold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer">
                              {commission.restaurantName || commission.restaurant?.name || '-'}
                            </span>
                            {commission.notes && (
                              <p className="text-xs text-slate-400 truncate max-w-xs">{commission.notes}</p>
                            )}
                          </td>
                        )}
                        {visibleColumns.restaurantId && (
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {commission.restaurantId || '-'}
                            </span>
                          </td>
                        )}
                        {visibleColumns.defaultCommission && (
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold ${
                              commission.defaultCommission?.type === 'percentage'
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}>
                              {commission.defaultCommission?.type === 'percentage' ? (
                                <>
                                  <Percent className="w-3 h-3" />
                                  {commission.defaultCommission.value}% of subtotal
                                </>
                              ) : (
                                <>
                                  <IndianRupee className="w-3 h-3" />
                                  ₹{commission.defaultCommission?.value} per order
                                </>
                              )}
                            </span>
                          </td>
                        )}
                        {visibleColumns.status && (
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(commission)}
                              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                commission.status ? "bg-emerald-600" : "bg-slate-300"
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                                  commission.status ? "translate-x-5" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </td>
                        )}
                        {visibleColumns.actions && (
                          <td className="px-5 py-3.5 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleEdit(commission)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title="Edit Override"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(commission)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete Override"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* RESTAURANT SELECTION DIALOG */}
      <Dialog open={isRestaurantSelectOpen} onOpenChange={setIsRestaurantSelectOpen}>
        <DialogContent className="max-w-lg bg-white p-0 rounded-2xl overflow-hidden shadow-xl border border-slate-200">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-lg font-bold text-slate-900">Select Restaurant for Custom Commission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search restaurants by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {filteredRestaurants
                .filter(r => !r.hasCommissionSetup)
                .map((restaurant) => (
                  <button
                    key={restaurant._id}
                    onClick={() => handleSelectRestaurant(restaurant)}
                    className="w-full p-3.5 text-left rounded-xl border border-slate-200 hover:bg-blue-50/70 hover:border-blue-300 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <p className="font-bold text-sm text-slate-900 group-hover:text-blue-700">{restaurant.name}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{restaurant.restaurantId}</p>
                    </div>
                    <Building2 className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
                  </button>
                ))}
              {filteredRestaurants.filter(r => !r.hasCommissionSetup).length === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">
                  <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p>No available restaurants found.</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="px-6 py-3 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => setIsRestaurantSelectOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD / EDIT DIALOG */}
      <Dialog open={isAddEditOpen} onOpenChange={setIsAddEditOpen}>
        <DialogContent className="max-w-lg bg-white p-0 rounded-2xl overflow-hidden shadow-xl border border-slate-200">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-lg font-bold text-slate-900">
              {selectedCommission ? "Edit Restaurant Commission Override" : "Add Restaurant Commission Override"}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 px-6 py-4">
            {/* Restaurant Info */}
            {selectedRestaurant && (
              <div className="p-3.5 bg-blue-50/70 rounded-xl border border-blue-100 flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg text-white">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-bold text-sm text-slate-900">{selectedRestaurant.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{selectedRestaurant.restaurantId}</p>
                </div>
              </div>
            )}

            {/* Mode Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Commission Mode <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100/80 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    defaultCommission: { ...prev.defaultCommission, type: "percentage" }
                  }))}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    formData.defaultCommission.type === "percentage"
                      ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Percent className="w-3.5 h-3.5" />
                  Percentage (%)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    defaultCommission: { ...prev.defaultCommission, type: "amount" }
                  }))}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    formData.defaultCommission.type === "amount"
                      ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <IndianRupee className="w-3.5 h-3.5" />
                  Fixed Rupee (₹)
                </button>
              </div>
            </div>

            {/* Value Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                {formData.defaultCommission.type === "percentage" ? "Commission Rate (%)" : "Per-Order Commission (₹)"} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-sm">
                  {formData.defaultCommission.type === "percentage" ? "%" : "₹"}
                </div>
                <input
                  type="number"
                  step={formData.defaultCommission.type === "percentage" ? "0.1" : "0.01"}
                  min="0"
                  max={formData.defaultCommission.type === "percentage" ? "100" : undefined}
                  value={formData.defaultCommission.value}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    defaultCommission: { ...prev.defaultCommission, value: e.target.value }
                  }))}
                  placeholder={formData.defaultCommission.type === "percentage" ? "e.g. 10 (10% of subtotal)" : "e.g. 10 (₹10 per order)"}
                  className={`w-full pl-9 pr-4 py-2.5 text-sm font-semibold rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm ${
                    formErrors.defaultCommission ? "border-red-500" : "border-slate-300"
                  }`}
                />
              </div>
              {formErrors.defaultCommission && (
                <p className="text-xs text-red-500 mt-1">{formErrors.defaultCommission}</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Notes <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm resize-none"
                rows="2"
                placeholder="Reason or contract reference for this custom rate..."
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="px-4 py-2.5 text-sm font-medium rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {selectedCommission ? "Update Override" : "Save Override"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION DIALOG */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-md bg-white p-0 rounded-2xl overflow-hidden shadow-xl border border-slate-200">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-lg font-bold text-slate-900">Delete Commission Override</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-3">
            <p className="text-sm text-slate-600">
              Are you sure you want to remove the custom commission override for{" "}
              <strong className="text-slate-900">"{selectedCommission?.restaurantName || selectedCommission?.restaurant?.name}"</strong>?
            </p>
            <p className="text-xs text-slate-400 mt-2">
              The restaurant will automatically revert to using the Global Default Commission setting.
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => setIsDeleteOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-600/20 disabled:opacity-50 flex items-center gap-2"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete Override
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}


