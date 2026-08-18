import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Search, CheckCircle2, XCircle, Eye, Clock, Loader2 } from "lucide-react"
import { Card } from "@food/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { refreshSidebarBadges } from "@food/components/admin/AdminSidebar"
import { useAdminBadgeListRefresh } from "@food/hooks/useAdminBadgeListRefresh"
import { toast } from "sonner"
import AdminListPagination from "@food/components/admin/AdminListPagination"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}



const ComparisonField = ({ label, oldVal, newVal, type = 'text' }) => {
  const isChanged = String(oldVal ?? '') !== String(newVal ?? '');
  if (!isChanged) return null;

  const formatValue = (val) => {
    if (type === 'price') return `₹${val || 0}`;
    if (type === 'boolean') return val ? 'On' : 'Off';
    return val || 'None';
  };

  return (
    <div className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium line-through decoration-2 ${type === 'boolean' ? (oldVal ? 'text-blue-500 decoration-blue-500/30' : 'text-gray-400 decoration-gray-400/50') : 'text-red-500 decoration-red-500/50'}`}>
          {formatValue(oldVal)}
        </span>
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-50 text-gray-400">
           <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="9 5l7 7-7 7" /></svg>
        </div>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${type === 'boolean' ? (newVal ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-100') : 'text-green-600 bg-green-50'}`}>
          {formatValue(newVal)}
        </span>
      </div>
    </div>
  );
};

const ImageComparison = ({ oldImage, newImage, oldImages = [], newImages = [] }) => {
    // Single image comparison
    const isSingleImageChanged = oldImage !== newImage;
    
    // Array images comparison
    const oldSet = new Set(oldImages || []);
    const newSet = new Set(newImages || []);
    const removed = (oldImages || []).filter(img => !newSet.has(img));
    const added = (newImages || []).filter(img => !oldSet.has(img));
    
    const hasChanges = isSingleImageChanged || removed.length > 0 || added.length > 0;
    if (!hasChanges) return null;

    return (
        <div className="col-span-full space-y-4 pt-4 border-t border-gray-100">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Image Variations</label>
            <div className="flex flex-wrap gap-6">
                {isSingleImageChanged && (
                    <div className="flex gap-4 items-center p-3 bg-slate-50 rounded-xl border border-dashed border-gray-200">
                        <div className="relative">
                            <img src={oldImage} className="w-20 h-20 object-cover rounded-lg border-2 border-red-100 opacity-40 grayscale" alt="Old" />
                            <div className="absolute inset-0 flex items-center justify-center"><XCircle className="w-6 h-6 text-red-500/50" /></div>
                            <span className="absolute -top-2 -left-2 bg-red-100 text-red-600 text-[8px] font-bold px-1.5 py-0.5 rounded">OLD</span>
                        </div>
                        <div className="text-gray-300">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="9 5l7 7-7 7" /></svg>
                        </div>
                        <div className="relative">
                            <img src={newImage} className="w-20 h-20 object-cover rounded-lg border-2 border-green-400 shadow-md transition-transform hover:scale-105" alt="New" />
                            <span className="absolute -top-2 -left-2 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm">NEW</span>
                        </div>
                    </div>
                )}
                
                {removed.map((img, idx) => (
                    <div key={`rem-${idx}`} className="relative opacity-60">
                        <img src={img} className="w-20 h-20 object-cover rounded-lg border-2 border-red-200 grayscale" alt="Removed" />
                        <div className="absolute inset-0 flex items-center justify-center"><XCircle className="w-6 h-6 text-red-500" /></div>
                        <span className="absolute -bottom-4 left-0 right-0 text-[8px] text-center text-red-500 font-bold">REMOVED</span>
                    </div>
                ))}
                
                {added.map((img, idx) => (
                    <div key={`add-${idx}`} className="relative">
                        <img src={img} className="w-20 h-20 object-cover rounded-lg border-2 border-green-500 shadow-sm" alt="Added" />
                        <span className="absolute -bottom-4 left-0 right-0 text-[8px] text-center text-green-600 font-bold">ADDED</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function FoodApproval() {
  const [foodRequests, setFoodRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_food_approval_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [processing, setProcessing] = useState(false)
  const isMountedRef = useRef(true)

  // Fetch pending food approval requests
  const fetchFoodRequests = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true)
      }
      const response = await adminAPI.getPendingFoodApprovals({
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: pageSize,
      })
      const payload = response?.data?.data ?? response?.data
      const data = Array.isArray(payload?.requests)
        ? payload.requests
        : Array.isArray(payload)
          ? payload
          : []
      if (!isMountedRef.current) return
      setFoodRequests(data)
      setTotalItems(
        Number(payload?.total ?? response?.data?.total ?? data.length) || 0,
      )
    } catch (error) {
      debugError('Error fetching food approval requests:', error)
      if (!isMountedRef.current) return
      if (!silent) {
        toast.error('Failed to load food approval requests')
      }
      setFoodRequests([])
      setTotalItems(0)
    } finally {
      if (!silent && isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [debouncedSearch, currentPage, pageSize])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  useAdminBadgeListRefresh("foodApprovals", fetchFoodRequests, [debouncedSearch, currentPage, pageSize])

  useEffect(() => {
    isMountedRef.current = true
    fetchFoodRequests()

    const onFocus = () => fetchFoodRequests({ silent: true })
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }
    const onPageShow = () => fetchFoodRequests({ silent: true })

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchFoodRequests({ silent: true })
      }
    }, 30000)

    window.addEventListener("focus", onFocus)
    window.addEventListener("pageshow", onPageShow)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      isMountedRef.current = false
      clearInterval(intervalId)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("pageshow", onPageShow)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [fetchFoodRequests, debouncedSearch, currentPage, pageSize])

  const filteredRequests = foodRequests
  const totalRequests = totalItems

  // Handle approve food item or addon
  const handleApprove = async (request) => {
    if (!request?.isActionable) return
    try {
      setProcessing(true)
      const id = request._id || request.id
      setFoodRequests(prev => prev.filter(item => (item._id || item.id) !== id))

      if (request.entityType === 'addon') {
        await adminAPI.approveRestaurantAddon(id)
        toast.success('Add-on approved successfully')
      } else {
        await adminAPI.approveFoodItem(id)
        toast.success('Food item approved successfully')
      }
      
      await fetchFoodRequests({ silent: true })
      refreshSidebarBadges("foodApprovals")
      setShowDetailModal(false)
      setSelectedRequest(null)
    } catch (error) {
      debugError('Error approving item:', error)
      toast.error(error?.response?.data?.message || 'Failed to approve item')
      await fetchFoodRequests()
    } finally {
      setProcessing(false)
    }
  }

  // Handle reject food item or addon
  const handleReject = async () => {
    if (!selectedRequest?.isActionable) {
      setShowRejectModal(false)
      return
    }
    if (!rejectReason.trim()) {
      toast.error('Please provide a rejection reason')
      return
    }

    try {
      setProcessing(true)
      const id = selectedRequest._id || selectedRequest.id
      setFoodRequests(prev => prev.filter(item => (item._id || item.id) !== id))

      if (selectedRequest.entityType === 'addon') {
        await adminAPI.rejectRestaurantAddon(id, rejectReason)
        toast.success('Add-on rejected')
      } else {
        await adminAPI.rejectFoodItem(id, rejectReason)
        toast.success('Food item rejected')
      }
      
      await fetchFoodRequests({ silent: true })
      refreshSidebarBadges("foodApprovals")
      setShowRejectModal(false)
      setShowDetailModal(false)
      setSelectedRequest(null)
      setRejectReason("")
    } catch (error) {
      debugError('Error rejecting item:', error)
      toast.error(error?.response?.data?.message || 'Failed to reject item')
      await fetchFoodRequests()
    } finally {
      setProcessing(false)
    }
  }

  // View food item details
  const handleViewDetails = (request) => {
    setSelectedRequest(request)
    setShowDetailModal(true)
  }

  // Open reject modal
  const handleRejectClick = (request) => {
    if (!request?.isActionable) return
    setSelectedRequest(request)
    setShowRejectModal(true)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">
            Food Approval
          </h1>
        </div>
      </div>

      {/* Food Approval List Section */}
      <Card className="border border-gray-200 shadow-sm">
        <div className="p-4">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Pending Food & Add-on Approvals</h2>
              <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-600">
                {totalRequests}
              </span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search by name, category, restaurant or status"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#006fbd]" />
            </div>
          ) : (
            <div className="border-t border-gray-200">
              <div className="w-full overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead style={{ backgroundColor: "rgba(0, 111, 189, 0.1)" }}>
                    <tr>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        S.No
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Restaurant
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Item Name
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Price
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Requested Date
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Action Type
                      </th>
                      <th className="px-3 py-3 !text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredRequests.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-3 py-8 text-center text-sm text-gray-500">
                          {loading ? "Loading..." : "No food or add-on records found."}
                        </td>
                      </tr>
                    ) : (
                      filteredRequests.map((request, index) => (
                        <tr key={request._id || request.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold !text-center">
                            {(currentPage - 1) * pageSize + index + 1}
                          </td>
                          <td className="px-3 py-3 !text-center max-w-[200px]">
                            <div className="text-sm truncate" title={request.restaurantName}>
                              <div className="font-semibold text-gray-900 truncate">{request.restaurantName || '-'}</div>
                              <div className="text-gray-500 text-xs truncate" title={request.restaurantId}>{request.restaurantId || '-'}</div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 !text-center max-w-[150px] truncate" title={request.category}>
                            {request.category || '-'}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 font-semibold !text-center max-w-[200px] truncate" title={request.itemName}>
                            {request.itemName || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 capitalize !text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${request.entityType === 'addon' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {request.entityType || 'food'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm !text-center">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                              request.isActionable
                                ? 'bg-amber-100 text-amber-700'
                                : String(request.approvalStatus || '').toLowerCase() === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              {request.approvalStatus || (request.isActionable ? 'pending' : 'active')}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 font-semibold !text-center">
                            {request.price !== null && request.price !== undefined ? `Rs ${request.price}` : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 !text-center">
                            {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm !text-center">
                            {request.actionType === 'UPDATED' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700">
                                    Changes
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                                    New Added
                                </span>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap !text-center text-sm">
                            <div className="flex justify-center gap-1.5">
                              <button
                                onClick={() => handleViewDetails(request)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors"
                                style={{ backgroundColor: "#006fbd" }}
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleApprove(request)}
                                disabled={processing || !request.isActionable}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Approve"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleRejectClick(request)}
                                disabled={processing || !request.isActionable}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <AdminListPagination
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  try {
                    localStorage.setItem("admin_food_approval_pageSize", String(size))
                  } catch {}
                  setCurrentPage(1)
                }}
                itemLabel="requests"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Item Details Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 bg-white shadow-2xl rounded-2xl border-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-slate-50/50">
            <DialogTitle className="text-xl font-bold text-gray-900">
              {selectedRequest?.entityType === 'addon' ? 'Add-on Details' : 'Food Item Details'}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Review the submitted details before approval.
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="p-6 space-y-6">
              {/* Restaurant Info */}
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 flex items-center justify-between">
                <div>
                   <h3 className="font-bold text-xs text-blue-700 uppercase tracking-wider mb-1">Restaurant</h3>
                   <p className="text-sm font-semibold text-gray-900">{selectedRequest.restaurantName || '-'}</p>
                   <p className="text-xs text-gray-500">ID: {selectedRequest.restaurantId || '-'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="px-3 py-1 bg-white rounded-full border border-blue-100 text-[10px] font-bold text-blue-600">
                        {selectedRequest.entityType?.toUpperCase()}
                    </div>
                    {selectedRequest.actionType === 'UPDATED' && (
                        <div className="px-2 py-0.5 bg-yellow-100 rounded text-[9px] font-bold text-yellow-700 uppercase">
                            Changes
                        </div>
                    )}
                </div>
              </div>

              {selectedRequest.actionType === 'UPDATED' && selectedRequest.oldData ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <ComparisonField label="Item Name" oldVal={selectedRequest.oldData.name} newVal={selectedRequest.newData?.name} />
                       <ComparisonField label="Category" oldVal={selectedRequest.oldData.categoryName || selectedRequest.oldData.category} newVal={selectedRequest.newData?.categoryName || selectedRequest.newData?.category} />
                       <ComparisonField label="Price" oldVal={selectedRequest.oldData.price} newVal={selectedRequest.newData?.price} type="price" />
                       <ComparisonField label="Food Type" oldVal={selectedRequest.oldData.foodType} newVal={selectedRequest.newData?.foodType} />
                       {(() => {
                         const oldV = selectedRequest.oldData.variants || []
                         const newV = selectedRequest.newData?.variants || []
                         const oldStr = oldV.map(v => `${v.name}:₹${v.price}`).join(', ')
                         const newStr = newV.map(v => `${v.name}:₹${v.price}`).join(', ')
                         if (oldStr === newStr || (!oldStr && !newStr)) return null
                         return (
                           <div className="col-span-full">
                             <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Variants</label>
                             <div className="grid grid-cols-2 gap-3">
                               <div>
                                 <p className="text-[10px] text-gray-400 mb-1">Before</p>
                                 {oldV.length > 0 ? oldV.map((v, i) => (
                                   <div key={i} className="flex justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mb-1">
                                     <span className="text-sm text-gray-700">{v.name}</span>
                                     <span className="text-sm font-bold text-red-600">₹{v.price}</span>
                                   </div>
                                 )) : <p className="text-sm text-gray-400 italic">None</p>}
                               </div>
                               <div>
                                 <p className="text-[10px] text-gray-400 mb-1">After</p>
                                 {newV.length > 0 ? newV.map((v, i) => (
                                   <div key={i} className="flex justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-1.5 mb-1">
                                     <span className="text-sm text-gray-700">{v.name}</span>
                                     <span className="text-sm font-bold text-green-600">₹{v.price}</span>
                                   </div>
                                 )) : <p className="text-sm text-gray-400 italic">None</p>}
                               </div>
                             </div>
                           </div>
                         )
                       })()}
                       <ComparisonField label="Preparation Time" oldVal={selectedRequest.oldData.preparationTime} newVal={selectedRequest.newData?.preparationTime} />
                       <ComparisonField label="Recommend" oldVal={selectedRequest.oldData.isRecommended} newVal={selectedRequest.newData?.isRecommended} type="boolean" />
                       <ComparisonField label="In Stock" oldVal={selectedRequest.oldData.isAvailable} newVal={selectedRequest.newData?.isAvailable} type="boolean" />
                       
                       <div className="col-span-full">
                          <ComparisonField label="Description" oldVal={selectedRequest.oldData.description} newVal={selectedRequest.newData?.description} />
                       </div>
                       
                       <ImageComparison 
                          oldImage={selectedRequest.oldData.image} 
                          newImage={selectedRequest.newData?.image} 
                          oldImages={selectedRequest.oldData.images} 
                          newImages={selectedRequest.newData?.images} 
                       />
                   </div>
                </div>
              ) : (
                /* Item Info (Existing View) */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Item Name</label>
                          <p className="text-sm font-semibold text-gray-900">{selectedRequest.itemName || '-'}</p>
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category</label>
                          <p className="text-sm text-gray-700">{selectedRequest.category || '-'}</p>
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Price</label>
                          {selectedRequest.variants && selectedRequest.variants.length > 0 ? (
                            <p className="text-xs text-gray-500 font-medium">Starts from ₹{selectedRequest.price}</p>
                          ) : (
                            <p className="text-sm font-bold text-green-600">{selectedRequest.price !== null && selectedRequest.price !== undefined ? `₹${selectedRequest.price}` : '-'}</p>
                          )}
                      </div>
                      {selectedRequest.variants && selectedRequest.variants.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Variants</label>
                          <div className="space-y-1.5">
                            {selectedRequest.variants.map((v, i) => (
                              <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                                <span className="text-sm font-medium text-gray-800">{v.name}</span>
                                <span className="text-sm font-bold text-green-600">₹{v.price}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status</label>
                          <p className="text-sm text-gray-700 capitalize font-medium">{selectedRequest.approvalStatus || 'pending'}</p>
                      </div>
                  </div>

                  <div className="space-y-4">
                      {selectedRequest.foodType && (
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Food Type</label>
                              <p className="text-sm text-gray-700">{selectedRequest.foodType}</p>
                          </div>
                      )}
                      {selectedRequest.requestedAt && (
                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Requested On</label>
                              <p className="text-sm text-gray-700">{new Date(selectedRequest.requestedAt).toLocaleString()}</p>
                          </div>
                      )}
                  </div>

                  {selectedRequest.description && (
                    <div className="col-span-full">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</label>
                      <p className="text-sm text-gray-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">{selectedRequest.description}</p>
                    </div>
                  )}

                  {/* Images */}
                  {(() => {
                    const allImages = (selectedRequest.images || []).filter(img => img && typeof img === 'string');
                    if (selectedRequest.image && !allImages.includes(selectedRequest.image)) {
                        allImages.unshift(selectedRequest.image);
                    }
                    
                    return allImages.length > 0 ? (
                      <div className="col-span-full">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Images ({allImages.length})
                        </label>
                        <div className="flex flex-wrap gap-3">
                          {allImages.map((img, idx) => (
                              <img 
                                key={idx}
                                src={img} 
                                alt="Item preview"
                                className="w-24 h-24 object-cover rounded-xl border border-gray-100 shadow-sm hover:scale-105 transition-transform cursor-zoom-in"
                                onClick={() => window.open(img, '_blank')}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="p-6 pt-4 border-t border-gray-100 bg-slate-50/50 flex gap-2">
            <button
              type="button"
              onClick={() => setShowDetailModal(false)}
              className="px-6 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            {selectedRequest?.isActionable && (
              <>
                <button
                  type="button"
                  onClick={() => handleRejectClick(selectedRequest)}
                  className="px-6 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 shadow-lg shadow-red-200 transition-all active:scale-95"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(selectedRequest)}
                  disabled={processing}
                  className="px-6 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 shadow-lg shadow-green-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {processing ? "Processing..." : "Approve Item"}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Modal */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-md p-0 bg-white rounded-2xl border-none shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 bg-red-50/30">
            <DialogTitle className="text-xl font-bold text-red-700 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Reject Item
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-1">
              Please provide a clear reason for rejecting this {selectedRequest?.entityType || 'item'}.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="rejectReason" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="rejectReason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tell the restaurant why this item was rejected..."
                  required
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>
            <DialogFooter className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={processing || !rejectReason.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95 disabled:opacity-50"
              >
                {processing ? "Processing..." : "Confirm Rejection"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
