import { X } from "lucide-react"
import { useState, useEffect } from "react"

export default function FilterPanel({ isOpen, onClose, filters, setFilters, onApply, onReset, restaurants = [] }) {
  const [localFilters, setLocalFilters] = useState(filters)

  useEffect(() => {
    if (isOpen) {
      setLocalFilters(filters)
    }
  }, [isOpen, filters])

  if (!isOpen) return null

  const today = new Date().toISOString().split("T")[0]

  const sanitizeAmountInput = (value) => {
    if (value === "") return ""
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ""
    return String(Math.max(0, parsed))
  }

  const clampDateValue = (value) => {
    if (!value) return ""
    return value > today ? today : value
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Filter Orders</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Payment Status Filter */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Payment Status
            </label>
            <div className="flex flex-wrap gap-2">
              {["All", "paid", "pending", "failed", "refunded"].map((status) => (
                <button
                  key={status}
                  onClick={() => setLocalFilters(prev => ({ ...prev, paymentStatus: status === "All" ? "" : status }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    localFilters.paymentStatus === status || (status === "All" && !localFilters.paymentStatus)
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Delivery Type Filter */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Delivery Type
            </label>
            <div className="flex flex-wrap gap-2">
              {["All", "home_delivery", "take_away"].map((type) => (
                <button
                  key={type}
                  onClick={() => setLocalFilters(prev => ({ ...prev, deliveryType: type === "All" ? "" : type }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    localFilters.deliveryType === type || (type === "All" && !localFilters.deliveryType)
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Amount Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Min Amount ($)
              </label>
              <input
                type="number"
                value={localFilters.minAmount || ""}
                min="0"
                onChange={(e) => setLocalFilters(prev => ({ ...prev, minAmount: sanitizeAmountInput(e.target.value) }))}
                placeholder="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Max Amount ($)
              </label>
              <input
                type="number"
                value={localFilters.maxAmount || ""}
                min="0"
                onChange={(e) => setLocalFilters(prev => ({ ...prev, maxAmount: sanitizeAmountInput(e.target.value) }))}
                placeholder="10000"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                From Date
              </label>
              <input
                type="date"
                value={localFilters.fromDate || ""}
                max={localFilters.toDate ? clampDateValue(localFilters.toDate) : today}
                onChange={(e) =>
                  setLocalFilters((prev) => {
                    const nextFromDate = clampDateValue(e.target.value)
                    const nextToDate =
                      prev.toDate && prev.toDate < nextFromDate ? nextFromDate : prev.toDate

                    return {
                      ...prev,
                      fromDate: nextFromDate,
                      toDate: nextToDate,
                    }
                  })
                }
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                To Date
              </label>
              <input
                type="date"
                value={localFilters.toDate || ""}
                min={localFilters.fromDate || undefined}
                max={today}
                onChange={(e) =>
                  setLocalFilters((prev) => ({
                    ...prev,
                    toDate: clampDateValue(e.target.value),
                  }))
                }
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Restaurant Filter */}
          {restaurants.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Restaurant
              </label>
              <select
                value={localFilters.restaurant || ""}
                onChange={(e) => setLocalFilters(prev => ({ ...prev, restaurant: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Restaurants</option>
                {restaurants.map((rest) => (
                  <option key={rest} value={rest}>{rest}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
          >
            Reset
          </button>
          <button
            onClick={() => { setFilters(localFilters); onApply(); }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md"
          >
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  )
}
