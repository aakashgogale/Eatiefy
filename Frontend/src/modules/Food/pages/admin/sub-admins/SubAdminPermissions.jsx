import { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Shield, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import {
  SUB_ADMIN_PERMISSION_ACTIONS,
  normalizePermissions,
  emptyPermissionActions,
  getSubAdminPermissionModules,
} from "@food/utils/subAdminPermissions"

export default function SubAdminPermissions() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subAdmin, setSubAdmin] = useState(null)
  const [permissions, setPermissions] = useState(normalizePermissions({}))
  const [savedPermissions, setSavedPermissions] = useState(normalizePermissions({}))

  const modules = useMemo(() => getSubAdminPermissionModules(), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getSubAdminById(id)
      const admin = res?.data?.data?.subAdmin || res?.data?.subAdmin
      if (!admin) {
        toast.error("Sub admin not found")
        navigate("/admin/food/sub-admins")
        return
      }
      const normalized = normalizePermissions(admin.permissions || {})
      setSubAdmin(admin)
      setPermissions(normalized)
      setSavedPermissions(normalized)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load permissions")
      navigate("/admin/food/sub-admins")
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => {
    load()
  }, [load])

  const hasAnyChecked = useMemo(() => {
    return modules.some((mod) => {
      const row = permissions[mod.key] || emptyPermissionActions()
      return SUB_ADMIN_PERMISSION_ACTIONS.some((a) => row[a])
    })
  }, [permissions, modules])

  const hasPermissionChanges = useMemo(
    () => JSON.stringify(permissions) !== JSON.stringify(savedPermissions),
    [permissions, savedPermissions],
  )
  const isRowAllChecked = (key) => {
    const row = permissions[key] || emptyPermissionActions()
    return SUB_ADMIN_PERMISSION_ACTIONS.every((a) => row[a])
  }

  const toggleAction = (key, action, checked) => {
    setPermissions((prev) => {
      const current = { ...(prev[key] || emptyPermissionActions()) }

      if (action === "view" && !checked) {
        // Unchecking view removes all write permissions too
        return { ...prev, [key]: emptyPermissionActions() }
      }

      current[action] = checked

      // create / edit / delete always require view
      if (checked && action !== "view") {
        current.view = true
      }

      return { ...prev, [key]: current }
    })
  }

  const toggleAllForRow = (key, checked) => {
    const next = emptyPermissionActions()
    SUB_ADMIN_PERMISSION_ACTIONS.forEach((a) => {
      next[a] = checked
    })
    setPermissions((prev) => ({ ...prev, [key]: next }))
  }

  const handleReset = () => {
    if (!hasAnyChecked) return
    // Local only — persists only when user clicks Save Permissions
    setPermissions(normalizePermissions({}))
  }

  const handleSave = async () => {
    if (!hasPermissionChanges || saving) return
    setSaving(true)
    try {
      await adminAPI.updateSubAdminPermissions(id, permissions)
      setSavedPermissions(permissions)
      toast.success("Permissions saved successfully")
      navigate("/admin/food/sub-admins")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save permissions")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    navigate("/admin/food/sub-admins")
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-6 bg-slate-50 min-h-screen flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading...
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors shrink-0"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Sub Admin Permission Matrix</h1>
              {subAdmin && (
                <p className="text-sm text-slate-500 mt-0.5 truncate">
                  {subAdmin.name}
                  {subAdmin.email ? ` (${subAdmin.email})` : ""}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={!hasAnyChecked || saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-white shrink-0"
              title={hasAnyChecked ? "Reset all permissions" : "Select at least one permission to reset"}
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Sidebar Section
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider w-16">
                    All
                  </th>
                  {SUB_ADMIN_PERMISSION_ACTIONS.map((action) => (
                    <th
                      key={action}
                      className="px-3 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider w-20 capitalize"
                    >
                      {action}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {modules.map((mod) => {
                  const row = permissions[mod.key] || emptyPermissionActions()
                  return (
                    <tr key={mod.key} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-sm text-slate-800">{mod.label}</td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isRowAllChecked(mod.key)}
                          onChange={(e) => toggleAllForRow(mod.key, e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          aria-label={`All permissions for ${mod.label}`}
                        />
                      </td>
                      {SUB_ADMIN_PERMISSION_ACTIONS.map((action) => (
                        <td key={action} className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row[action])}
                            onChange={(e) => toggleAction(mod.key, action, e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            aria-label={`${action} for ${mod.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2.5 px-4 py-4 sm:px-5 border-t border-slate-200">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasPermissionChanges}
              title={
                hasPermissionChanges
                  ? "Save permission changes"
                  : "Change at least one permission to enable save"
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-slate-900 shadow-sm"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Permissions
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
