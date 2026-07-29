import { useState, useEffect, useMemo, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Trophy, Search, Calendar, CheckCircle2, Clock, XCircle, Loader2, AlertCircle,
  Gift, User, RefreshCw, X, Wallet
} from "lucide-react"
import { adminAPI } from "@food/api"

// ─── Helper ────────────────────────────────────────────────────────────────────
function toISTDateString(date = new Date()) {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

function formatDate(dateStr) {
  if (!dateStr) return ""
  const [y, m, d] = dateStr.split("-")
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`
}

// ─── Give Bonus Dialog ──────────────────────────────────────────────────────────
function GiveBonusDialog({ record, onClose, onDone }) {
  const partnerName = record?.deliveryPartnerId?.name || "—"
  const defaultAmount = record?.bonusAmount || 0
  const eligibilityId = record?._id

  const [amount, setAmount] = useState(String(defaultAmount))
  const [reason, setReason] = useState(`${record?.ruleId?.targetType ? (record.ruleId.targetType.charAt(0).toUpperCase() + record.ruleId.targetType.slice(1)) : "Daily"} Target Achieved`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) { setError("Enter a valid bonus amount"); return }
    setSubmitting(true)
    setError("")
    try {
      // Step 1: Credit the bonus via existing bonus API
      const bonusRes = await adminAPI.addDeliveryPartnerBonus(
        record.deliveryPartnerId._id,
        Number(amount),
        reason || "Target Bonus",
        "target",
        eligibilityId
      )
      const bonusTransactionId = bonusRes.data?.data?.transaction?.transactionId || null

      // Step 2: Mark eligibility record as bonus_given
      await adminAPI.markBonusGiven(eligibilityId, bonusTransactionId)

      onDone()
    } catch (e) {
      setError(e.response?.data?.message || "Failed to give bonus. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Gift className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">Give Bonus</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Partner info */}
          <div className="bg-slate-50 rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
              <User className="w-4.5 h-4.5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">{partnerName}</p>
              <p className="text-xs text-slate-500">
                {record?.ordersCompleted} / {record?.targetOrders} orders completed
              </p>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Bonus Amount (₹) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={submitting}
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for bonus"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Processing..." : "Submit & Credit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function EligibleBonuses() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const today = toISTDateString()
  const yesterday = toISTDateString(new Date(Date.now() - 86400000))

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  const [dateMode, setDateMode] = useState("today") // today | yesterday | custom
  const [customDate, setCustomDate] = useState(today)
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all")
  const [search, setSearch] = useState("")

  const [giveBonusRecord, setGiveBonusRecord] = useState(null)

  const selectedDate = dateMode === "today" ? today : dateMode === "yesterday" ? yesterday : customDate

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = { date: selectedDate }
      if (statusFilter && statusFilter !== "all") params.status = statusFilter
      const res = await adminAPI.getEligibleBonuses(params)
      setRecords(res.data?.data || [])
    } catch (e) {
      setError("Failed to load eligible bonuses. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [selectedDate, statusFilter])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  const showSuccess = (msg) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(""), 3500)
  }

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records
    const q = search.toLowerCase()
    return records.filter(r =>
      r.deliveryPartnerId?.name?.toLowerCase().includes(q) ||
      r.deliveryPartnerId?.deliveryId?.toLowerCase().includes(q)
    )
  }, [records, search])

  const handleBonusDone = () => {
    setGiveBonusRecord(null)
    showSuccess("Bonus credited and eligibility updated successfully! ✅")
    fetchRecords()
  }

  const summaryEligible = records.filter(r => r.status === "eligible").length
  const summaryGiven = records.filter(r => r.status === "bonus_given").length

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-amber-500 rounded-xl">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Eligible Bonuses</h1>
            <p className="text-sm text-slate-500 mt-0.5">Delivery partners who achieved their delivery target</p>
          </div>
        </div>

        {/* Alerts */}
        {successMsg && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3 mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {successMsg}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Total Eligible</p>
              <p className="text-2xl font-bold text-slate-800">{summaryEligible + summaryGiven}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Bonus Given</p>
              <p className="text-2xl font-bold text-emerald-700">{summaryGiven}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Pending Approval</p>
              <p className="text-2xl font-bold text-orange-600">{summaryEligible}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-5">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Mode */}
            <div className="flex gap-2">
              {[["today", "Today"], ["yesterday", "Yesterday"], ["custom", "Custom Date"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setDateMode(val)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${dateMode === val ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {val === "today" && <Calendar className="w-3.5 h-3.5" />}
                  {label}
                </button>
              ))}
              {dateMode === "custom" && (
                <input
                  type="date"
                  value={customDate}
                  max={today}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>

            <div className="h-6 w-px bg-slate-200" />

            {/* Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="all">All Status</option>
              <option value="eligible">Eligible (Pending)</option>
              <option value="bonus_given">Bonus Given</option>
            </select>

            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search delivery partner..."
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Refresh */}
            <button
              onClick={fetchRecords}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 ml-0.5">
            Showing data for: <strong>{formatDate(selectedDate)}</strong>
          </p>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No eligible partners found</p>
              <p className="text-xs mt-1">Try changing the date or status filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery Partner</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rule</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Orders</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Target</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bonus</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-right py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record, idx) => {
                    const partner = record.deliveryPartnerId
                    const rule = record.ruleId
                    const isEligible = record.status === "eligible"
                    const isBonusGiven = record.status === "bonus_given"

                    return (
                      <tr key={record._id} className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                        <td className="py-4 px-4 text-slate-400">{idx + 1}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">{partner?.name || "—"}</p>
                              <p className="text-xs text-slate-400">{partner?.deliveryId || ""}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div>
                            <p className="font-medium text-slate-700">{rule?.name || "—"}</p>
                            <p className="text-xs text-slate-400 capitalize">{rule?.targetType || ""}</p>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-bold text-slate-800">{record.ordersCompleted}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-medium text-slate-600">{record.targetOrders}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-bold text-emerald-700">₹{record.bonusAmount}</span>
                        </td>
                        <td className="py-4 px-4">
                          {isBonusGiven ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Bonus Given
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                              <Clock className="w-3.5 h-3.5" />
                              Eligible
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right">
                          {isEligible ? (
                            <button
                              onClick={() => setGiveBonusRecord(record)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all shadow-sm"
                            >
                              <Gift className="w-3.5 h-3.5" />
                              Give Bonus
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 italic">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Give Bonus Dialog */}
      {giveBonusRecord && (
        <GiveBonusDialog
          record={giveBonusRecord}
          onClose={() => setGiveBonusRecord(null)}
          onDone={handleBonusDone}
        />
      )}
    </div>
  )
}
