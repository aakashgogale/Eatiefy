import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import {
  UserCog,
  Search,
  RefreshCw,
  Shield,
  Ban,
  CheckCircle2,
  Trash2,
  Loader2,
  Plus,
  Eye,
  EyeOff,
  Users,
  KeyRound,
} from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import AdminListPagination from "@food/components/admin/AdminListPagination"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@food/components/ui/dialog"

const emptyForm = { name: "", email: "", phone: "", password: "" }

const inputClass =
  "w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50/80 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 focus:bg-white transition-colors"

/** Keep last list in memory so returning from Permissions doesn't flash empty. */
let subAdminsListCache = null

export default function SubAdminList() {
  const navigate = useNavigate()
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(() => !Array.isArray(subAdminsListCache))
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try {
      return Number(localStorage.getItem("admin_sub_admins_pageSize")) || 20
    } catch {
      return 20
    }
  })
  const [totalItems, setTotalItems] = useState(0)
  const [subAdmins, setSubAdmins] = useState(() =>
    Array.isArray(subAdminsListCache) ? subAdminsListCache : []
  )
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState(null)
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" })
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const requestIdRef = useRef(0)
  const hasLoadedOnceRef = useRef(Array.isArray(subAdminsListCache))

  const fetchSubAdmins = useCallback(async (opts = {}) => {
    const { silent = false } = opts
    const useSilent = silent || hasLoadedOnceRef.current || Array.isArray(subAdminsListCache)

    if (useSilent) setRefreshing(true)
    else setLoading(true)

    const reqId = ++requestIdRef.current
    try {
      const res = await adminAPI.getSubAdmins({
        search: searchQuery.trim() || undefined,
        page: currentPage,
        limit: pageSize,
      })
      if (reqId !== requestIdRef.current) return

      const list =
        res?.data?.data?.subAdmins ||
        res?.data?.subAdmins ||
        []
      const next = Array.isArray(list) ? list : []
      setSubAdmins(next)
      setTotalItems(res?.data?.data?.pagination?.total ?? next.length)
      hasLoadedOnceRef.current = true
      // Only cache unfiltered first page
      if (!searchQuery.trim() && currentPage === 1) {
        subAdminsListCache = next
      }
    } catch (err) {
      if (reqId !== requestIdRef.current) return
      toast.error(err?.response?.data?.message || "Failed to load sub admins")
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [searchQuery, currentPage, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  useEffect(() => {
    const delay = searchQuery.trim() ? 300 : Array.isArray(subAdminsListCache) ? 0 : 200
    const t = setTimeout(() => {
      fetchSubAdmins({ silent: Array.isArray(subAdminsListCache) })
    }, delay)
    return () => {
      clearTimeout(t)
      requestIdRef.current += 1
    }
  }, [searchQuery, currentPage, pageSize, fetchSubAdmins])

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleCancelCreate = () => {
    setForm(emptyForm)
    setShowPassword(false)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Name, email and password are required")
      return
    }
    setCreating(true)
    try {
      await adminAPI.createSubAdmin({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      })
      toast.success("Sub admin created successfully")
      setForm(emptyForm)
      setShowPassword(false)
      await fetchSubAdmins({ silent: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to create sub admin")
    } finally {
      setCreating(false)
    }
  }

  const openConfirm = (type, admin) => {
    setConfirmDialog({ type, admin })
  }

  const openPasswordDialog = (admin) => {
    setPasswordForm({ newPassword: "", confirmPassword: "" })
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    setPasswordDialog(admin)
  }

  const closePasswordDialog = (force = false) => {
    if (savingPassword && !force) return
    setPasswordDialog(null)
    setPasswordForm({ newPassword: "", confirmPassword: "" })
    setShowNewPassword(false)
    setShowConfirmPassword(false)
  }

  const handleSavePassword = async () => {
    if (!passwordDialog) return
    const newPassword = passwordForm.newPassword.trim()
    const confirmPassword = passwordForm.confirmPassword.trim()

    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match")
      return
    }

    const id = passwordDialog.id || passwordDialog._id
    setSavingPassword(true)
    try {
      await adminAPI.resetSubAdminPassword(id, newPassword)
      toast.success("Password updated successfully")
      closePasswordDialog(true)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update password")
    } finally {
      setSavingPassword(false)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmDialog?.admin) return
    const { type, admin } = confirmDialog
    const id = admin.id || admin._id
    setActionLoading(true)
    try {
      if (type === "delete") {
        await adminAPI.deleteSubAdmin(id)
        toast.success("Sub admin deleted successfully")
      } else if (type === "disable") {
        await adminAPI.updateSubAdminStatus(id, false)
        toast.success("Sub admin disabled successfully")
      } else if (type === "enable") {
        await adminAPI.updateSubAdminStatus(id, true)
        toast.success("Sub admin enabled successfully")
      }
      setConfirmDialog(null)
      await fetchSubAdmins({ silent: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed")
    } finally {
      setActionLoading(false)
    }
  }

  const confirmCopy = () => {
    if (!confirmDialog) return { title: "", message: "" }
    const name = confirmDialog.admin?.name || "this sub admin"
    if (confirmDialog.type === "delete") {
      return {
        title: "Delete Sub Admin",
        message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      }
    }
    if (confirmDialog.type === "disable") {
      return {
        title: "Disable Sub Admin",
        message: `Are you sure you want to disable "${name}"? They will not be able to log in until enabled again.`,
      }
    }
    return {
      title: "Enable Sub Admin",
      message: `Are you sure you want to enable "${name}"?`,
    }
  }

  const { title: confirmTitle, message: confirmMessage } = confirmCopy()
  const showCountSkeleton = loading && !Array.isArray(subAdminsListCache)

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="space-y-4">
        {/* Header — no back arrow on list page */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <UserCog className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                Sub Admin Management
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Create, disable, and delete sub admins. Permissions are managed per admin.
              </p>
            </div>
          </div>
        </div>

        {/* Create form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Plus className="w-4 h-4 text-slate-700" />
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">Create Sub Admin</h2>
          </div>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleFormChange("name", e.target.value)}
                  placeholder="Full name"
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleFormChange("email", e.target.value)}
                  placeholder="email@example.com"
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => handleFormChange("phone", e.target.value)}
                  placeholder="Phone number"
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => handleFormChange("password", e.target.value)}
                    placeholder="Min 6 characters"
                    className={`${inputClass} pr-10`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-60 shadow-sm"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Sub Admin
              </button>
              <button
                type="button"
                onClick={handleCancelCreate}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-4 sm:px-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-2 shrink-0">
              <Users className="w-5 h-5 text-slate-600" />
              <h2 className="text-base sm:text-lg font-semibold text-slate-900">Sub Admins</h2>
              {showCountSkeleton ? (
                <span
                  className="inline-block h-5 w-7 rounded-full bg-slate-300 animate-pulse"
                  aria-hidden
                />
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 min-w-[1.5rem] text-center">
                  {totalItems}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-1 sm:justify-end">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sub admins"
                  className="pl-9 pr-3 py-2 w-full text-sm rounded-lg border border-slate-200 bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 focus:bg-white transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={() => fetchSubAdmins({ silent: true })}
                disabled={refreshing || loading}
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all shrink-0"
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className={`w-[18px] h-[18px] ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {loading && subAdmins.length === 0 ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-slate-300 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-40 bg-slate-300 rounded" />
                    <div className="h-3 w-56 bg-slate-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : subAdmins.length === 0 ? (
            <div className="py-14 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600">No sub admins found</p>
              <p className="text-xs text-slate-400 mt-1">Create one using the form above</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 -mx-1">
              {subAdmins.map((admin) => {
                const id = admin.id || admin._id
                const active = admin.isActive !== false
                return (
                  <div
                    key={id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 px-1 hover:bg-slate-50/80 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                        {(admin.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{admin.name}</p>
                          {!active && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-50 text-red-600 shrink-0">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {admin.email}
                          {admin.phone ? ` · ${admin.phone}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pl-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/food/sub-admins/${id}/permissions`)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 transition-colors"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        Permissions
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordDialog(admin)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 transition-colors"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Forget Password
                      </button>
                      {active ? (
                        <button
                          type="button"
                          onClick={() => openConfirm("disable", admin)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          Disable
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openConfirm("enable", admin)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Enable
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openConfirm("delete", admin)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <AdminListPagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              try {
                localStorage.setItem("admin_sub_admins_pageSize", String(size))
              } catch {}
              setCurrentPage(1)
            }}
            itemLabel="sub admins"
          />
        </div>
      </div>

      <Dialog open={!!confirmDialog} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent className="max-w-md bg-white p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-200">
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription className="sr-only">{confirmMessage}</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-5 space-y-5">
            <p className="text-sm text-slate-700">{confirmMessage}</p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                disabled={actionLoading}
                className="px-5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={`px-5 py-2 text-sm font-medium rounded-lg text-white transition-all inline-flex items-center gap-2 ${
                  confirmDialog?.type === "enable"
                    ? "bg-slate-900 hover:bg-slate-800"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Yes
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordDialog} onOpenChange={(open) => !open && closePasswordDialog()}>
        <DialogContent className="max-w-md bg-white p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-200">
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-slate-700" />
              Forget Password
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 pt-1">
              Set a new password for{" "}
              <span className="font-medium text-slate-700">
                {passwordDialog?.name || "this sub admin"}
              </span>
              {passwordDialog?.email ? ` (${passwordDialog.email})` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                  }
                  placeholder="Min 6 characters"
                  className={`${inputClass} pr-10`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  }
                  placeholder="Re-enter new password"
                  className={`${inputClass} pr-10`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={closePasswordDialog}
                disabled={savingPassword}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePassword}
                disabled={savingPassword}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-60"
              >
                {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Password
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
