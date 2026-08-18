import { useState, useEffect } from "react"
import { Target, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react"
import { adminAPI } from "@food/api"

const TYPE_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }
const TYPE_COLORS = {
  daily: "bg-blue-100 text-blue-700",
  weekly: "bg-purple-100 text-purple-700",
  monthly: "bg-orange-100 text-orange-700",
}
const STATUS_COLORS = {
  active: "bg-emerald-100 text-emerald-700",
  inactive: "bg-slate-100 text-slate-500",
}

const DEFAULT_FORM = { name: "", targetType: "daily", minimumOrders: "", bonusAmount: "", status: "active" }

export default function TargetBonusRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [editingId, setEditingId] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [deletingId, setDeletingId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getTargetBonusRules()
      setRules(res.data?.data || [])
    } catch (e) {
      setError("Failed to load rules.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRules() }, [])

  const showSuccess = (msg) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(""), 3500)
  }

  const validate = () => {
    const errs = {}
    if (!formData.name.trim()) errs.name = "Rule name is required"
    if (!formData.targetType) errs.targetType = "Target type is required"
    if (!formData.minimumOrders || Number(formData.minimumOrders) < 1) errs.minimumOrders = "At least 1 order required"
    if (formData.bonusAmount === "" || Number(formData.bonusAmount) < 0) errs.bonusAmount = "Valid amount required"
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setError("")
    try {
      const payload = {
        name: formData.name.trim(),
        targetType: formData.targetType,
        minimumOrders: Number(formData.minimumOrders),
        bonusAmount: Number(formData.bonusAmount),
        status: formData.status,
      }
      if (editingId) {
        await adminAPI.updateTargetBonusRule(editingId, payload)
        showSuccess("Rule updated successfully!")
      } else {
        await adminAPI.createTargetBonusRule(payload)
        showSuccess("Rule created successfully!")
      }
      setFormData(DEFAULT_FORM)
      setEditingId(null)
      setFormErrors({})
      fetchRules()
    } catch (e) {
      setError(e.response?.data?.message || "Failed to save rule. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (rule) => {
    setEditingId(rule._id)
    setFormData({
      name: rule.name,
      targetType: rule.targetType,
      minimumOrders: String(rule.minimumOrders),
      bonusAmount: String(rule.bonusAmount),
      status: rule.status,
    })
    setFormErrors({})
    setError("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleCancel = () => {
    setEditingId(null)
    setFormData(DEFAULT_FORM)
    setFormErrors({})
    setError("")
  }

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this rule? This cannot be undone.")) return
    setDeletingId(id)
    try {
      await adminAPI.deleteTargetBonusRule(id)
      showSuccess("Rule deleted.")
      fetchRules()
    } catch (e) {
      setError(e.response?.data?.message || "Failed to delete rule.")
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleStatus = async (id) => {
    setTogglingId(id)
    try {
      await adminAPI.toggleTargetBonusRuleStatus(id)
      showSuccess("Status updated.")
      fetchRules()
    } catch (e) {
      setError(e.response?.data?.message || "Failed to toggle status.")
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-indigo-600 rounded-xl">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Target Bonus Rules</h1>
            <p className="text-sm text-slate-500 mt-0.5">Define delivery targets that make partners eligible for a bonus</p>
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

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-800 mb-5 flex items-center gap-2">
            {editingId ? <Pencil className="w-4 h-4 text-indigo-500" /> : <Plus className="w-4 h-4 text-indigo-500" />}
            {editingId ? "Edit Rule" : "Create New Rule"}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Target Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Target Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => { setFormData(p => ({ ...p, name: e.target.value })); setFormErrors(p => ({ ...p, name: "" })) }}
                  placeholder="e.g. Daily Delivery Bonus"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${formErrors.name ? "border-red-400" : "border-slate-300"}`}
                  disabled={submitting}
                />
                {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>}
              </div>

              {/* Target Type */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Target Type <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  {["daily", "weekly", "monthly"].map((t) => (
                    <label key={t} className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 border-2 rounded-lg cursor-pointer text-sm font-medium transition-all ${formData.targetType === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      <input
                        type="radio"
                        name="targetType"
                        value={t}
                        checked={formData.targetType === t}
                        onChange={() => setFormData(p => ({ ...p, targetType: t }))}
                        className="hidden"
                        disabled={submitting}
                      />
                      {TYPE_LABELS[t]}
                    </label>
                  ))}
                </div>
                {formErrors.targetType && <p className="text-xs text-red-500 mt-1">{formErrors.targetType}</p>}
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                <div className="flex gap-3">
                  {["active", "inactive"].map((s) => (
                    <label key={s} className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 border-2 rounded-lg cursor-pointer text-sm font-medium transition-all capitalize ${formData.status === s ? (s === "active" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-400 bg-slate-100 text-slate-600") : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      <input
                        type="radio"
                        name="status"
                        value={s}
                        checked={formData.status === s}
                        onChange={() => setFormData(p => ({ ...p, status: s }))}
                        className="hidden"
                        disabled={submitting}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>

              {/* Minimum Orders */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Minimum Orders <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formData.minimumOrders}
                  onChange={(e) => { setFormData(p => ({ ...p, minimumOrders: e.target.value })); setFormErrors(p => ({ ...p, minimumOrders: "" })) }}
                  placeholder="e.g. 15"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${formErrors.minimumOrders ? "border-red-400" : "border-slate-300"}`}
                  disabled={submitting}
                />
                {formErrors.minimumOrders && <p className="text-xs text-red-500 mt-1">{formErrors.minimumOrders}</p>}
              </div>

              {/* Bonus Amount */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Bonus Amount (₹) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.bonusAmount}
                  onChange={(e) => { setFormData(p => ({ ...p, bonusAmount: e.target.value })); setFormErrors(p => ({ ...p, bonusAmount: "" })) }}
                  placeholder="e.g. 150"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${formErrors.bonusAmount ? "border-red-400" : "border-slate-300"}`}
                  disabled={submitting}
                />
                {formErrors.bonusAmount && <p className="text-xs text-red-500 mt-1">{formErrors.bonusAmount}</p>}
              </div>

              {/* Info box */}
              <div className="md:col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Note:</strong> Only one active rule per type (Daily/Weekly/Monthly) is allowed at a time. If you set status to <em>Active</em>, make sure no other active rule of the same type exists.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-5 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
                disabled={submitting}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? "Saving..." : editingId ? "Update Rule" : "Save Rule"}
              </button>
            </div>
          </form>
        </div>

        {/* Rules Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-800">All Rules</h2>
            <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{rules.length} rule{rules.length !== 1 ? "s" : ""}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-14 text-slate-400">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No rules created yet. Create one above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Min Orders</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bonus</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, idx) => (
                    <tr key={rule._id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-3 text-slate-400">{idx + 1}</td>
                      <td className="py-3.5 px-3 font-medium text-slate-800">{rule.name}</td>
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${TYPE_COLORS[rule.targetType]}`}>
                          {TYPE_LABELS[rule.targetType]}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 font-semibold text-slate-700">{rule.minimumOrders}</td>
                      <td className="py-3.5 px-3 font-semibold text-emerald-700">₹{rule.bonusAmount}</td>
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[rule.status]}`}>
                          {rule.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex items-center justify-end gap-2">
                          {/* Toggle */}
                          <button
                            onClick={() => handleToggleStatus(rule._id)}
                            disabled={togglingId === rule._id}
                            title={rule.status === "active" ? "Deactivate" : "Activate"}
                            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-indigo-600"
                          >
                            {togglingId === rule._id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : rule.status === "active"
                                ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                                : <ToggleLeft className="w-5 h-5 text-slate-400" />
                            }
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => handleEdit(rule)}
                            title="Edit"
                            className="p-1.5 rounded-lg hover:bg-indigo-50 transition-colors text-slate-500 hover:text-indigo-600"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(rule._id)}
                            disabled={deletingId === rule._id}
                            title="Delete"
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-slate-500 hover:text-red-600"
                          >
                            {deletingId === rule._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
