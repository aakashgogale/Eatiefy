import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, AlertCircle, Upload, Loader2, Pencil } from "lucide-react"
import { restaurantAPI, uploadAPI } from "@food/api"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"
import { maskAccountNumber } from "@food/utils/restaurantProfile"

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
const UPI_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/

const EMPTY_FORM = {
  bankName: "",
  accountType: "",
  accountHolderName: "",
  accountNumber: "",
  confirmAccountNumber: "",
  ifscCode: "",
  upiId: "",
  upiQrImage: "",
}

export default function UpdateBankDetails() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingQr, setUploadingQr] = useState(false)
  const [lastUpdated, setLastUpdated] = useState("")

  const [form, setForm] = useState(EMPTY_FORM)
  // The page opens in read-only view; Edit reveals the same form, prefilled.
  const [isEditing, setIsEditing] = useState(false)
  const [errors, setErrors] = useState({})
  const [isQrPickerOpen, setIsQrPickerOpen] = useState(false)
  const qrInputRef = useRef(null)

  const formattedUpdatedAt = useMemo(() => {
    if (!lastUpdated) return ""
    const date = new Date(lastUpdated)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  }, [lastUpdated])

  // Drives the empty state and the Add/Edit label.
  const hasAnyDetails = useMemo(
    () =>
      Boolean(
        form.accountHolderName ||
          form.accountNumber ||
          form.ifscCode ||
          form.bankName ||
          form.upiId ||
          form.upiQrImage
      ),
    [form]
  )

  const validate = () => {
    const nextErrors = {}
    const accountHolderName = String(form.accountHolderName || "").trim()
    const accountNumber = String(form.accountNumber || "").replace(/\s|-/g, "")
    const confirmAccountNumber = String(form.confirmAccountNumber || "").replace(/\s|-/g, "")
    const ifscCode = String(form.ifscCode || "").trim().toUpperCase()
    const upiId = String(form.upiId || "").trim()

    const anyBankField = Boolean(accountHolderName || accountNumber || ifscCode)

    if (anyBankField) {
      if (!accountHolderName) nextErrors.accountHolderName = "Account holder name is required"
      if (!accountNumber) {
        nextErrors.accountNumber = "Account number is required"
      } else if (!/^\d{9,18}$/.test(accountNumber)) {
        nextErrors.accountNumber = "Account number must be 9 to 18 digits"
      }
      if (!confirmAccountNumber) {
        nextErrors.confirmAccountNumber = "Please confirm account number"
      } else if (confirmAccountNumber !== accountNumber) {
        nextErrors.confirmAccountNumber = "Account numbers do not match"
      }
      if (!ifscCode) {
        nextErrors.ifscCode = "IFSC code is required"
      } else if (!IFSC_REGEX.test(ifscCode)) {
        nextErrors.ifscCode = "Invalid IFSC format (e.g. SBIN0018764)"
      }
    }

    if (upiId && !UPI_REGEX.test(upiId)) {
      nextErrors.upiId = "Invalid UPI ID format (e.g. name@bank)"
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const loadProfile = async () => {
    try {
      setLoading(true)
      const response = await restaurantAPI.getCurrentRestaurant()
      const doc = response?.data?.data?.restaurant || response?.data?.restaurant || null
      if (!doc) return

      const accountNumber = String(doc.accountNumber || "").replace(/\s|-/g, "")
      const upiQrImage =
        typeof doc.upiQrImage === "string"
          ? doc.upiQrImage
          : String(doc.upiQrImage?.url || "")

      setForm({
        bankName: String(doc.bankName || ""),
        accountType: String(doc.accountType || ""),
        accountHolderName: String(doc.accountHolderName || ""),
        accountNumber,
        confirmAccountNumber: accountNumber,
        ifscCode: String(doc.ifscCode || "").toUpperCase(),
        upiId: String(doc.upiId || ""),
        upiQrImage,
      })
      setLastUpdated(doc.updatedAt || "")
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to load bank details")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const handleQrUpload = async (file) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size too large. Max 5MB allowed.")
        return
      }
      setUploadingQr(true)
      const response = await uploadAPI.uploadMedia(file, { folder: "food/restaurants/upi-qr" })
      const url =
        response?.data?.data?.url ||
        response?.data?.url ||
        ""
      if (!url) throw new Error("Upload failed")
      setForm((prev) => ({ ...prev, upiQrImage: url }))
      toast.success("QR updated successfully")
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to upload QR image")
    } finally {
      setUploadingQr(false)
    }
  }

  const handleQrClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsQrPickerOpen(true)
    } else {
      qrInputRef.current?.click()
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    const payload = {
      accountHolderName: String(form.accountHolderName || "").trim(),
      accountNumber: String(form.accountNumber || "").replace(/\s|-/g, ""),
      ifscCode: String(form.ifscCode || "").trim().toUpperCase(),
      upiId: String(form.upiId || "").trim(),
      upiQrImage: String(form.upiQrImage || "").trim(),
    }

    try {
      setSaving(true)
      await restaurantAPI.updateProfile(payload)
      // Reload from the backend so view mode shows exactly what was saved.
      await loadProfile()
      setErrors({})
      setIsEditing(false)
      toast.success("Bank details updated successfully")
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to update bank details")
    } finally {
      setSaving(false)
    }
  }

  const inputClass = (key) =>
    `w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 text-base transition-colors ${
      errors[key]
        ? "border-red-500 focus:ring-[#2E7D52] focus:border-[#2E7D52]"
        : "border-gray-300 focus:ring-blue-500 focus:border-transparent"
    }`

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
        <button onClick={goBack} className="p-2 rounded-full hover:bg-gray-100" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Bank & UPI Details</h1>
      </div>

      <div className="flex-1 px-4 pt-4 pb-6">
        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading details...</span>
          </div>
        ) : !isEditing ? (
          /* View mode: every saved detail, read-only, with an explicit Edit action. */
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">Account details</h2>
                {formattedUpdatedAt ? (
                  <p className="text-sm text-gray-500 mt-1">Last updated: {formattedUpdatedAt}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="shrink-0 inline-flex items-center gap-2 bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white px-4 py-2 rounded-lg text-sm font-bold active:scale-95 transition-transform"
              >
                <Pencil className="w-3.5 h-3.5" />
                {hasAnyDetails ? "Edit" : "Add details"}
              </button>
            </div>

            {!hasAnyDetails ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center">
                <p className="text-sm font-medium text-gray-600">No bank or UPI details saved yet</p>
                <p className="mt-1 text-xs text-gray-500">
                  Add them so payouts can reach your account.
                </p>
              </div>
            ) : (
              <>
                <dl className="space-y-4">
                  {[
                    { label: "Account holder name", value: form.accountHolderName },
                    { label: "Bank name", value: form.bankName },
                    // Masked on purpose — the full number is never rendered back.
                    { label: "Account number", value: maskAccountNumber(form.accountNumber) },
                    { label: "IFSC code", value: form.ifscCode },
                    { label: "Account type", value: form.accountType },
                    { label: "UPI ID", value: form.upiId },
                  ].map((row) => {
                    const value = String(row.value ?? "").trim()
                    return (
                      <div key={row.label} className="flex flex-col gap-0.5">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          {row.label}
                        </dt>
                        <dd
                          className={`text-[15px] font-semibold break-words ${
                            value ? "text-gray-900" : "text-gray-400 italic font-medium"
                          }`}
                        >
                          {value || "Not set"}
                        </dd>
                      </div>
                    )
                  })}
                </dl>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    UPI QR
                  </p>
                  {form.upiQrImage ? (
                    <img
                      src={form.upiQrImage}
                      alt="UPI QR code"
                      className="h-40 w-40 rounded-xl border border-gray-200 object-contain bg-white"
                    />
                  ) : (
                    <p className="text-[15px] font-medium text-gray-400 italic">Not set</p>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="mb-2">
              <h2 className="text-base font-bold text-gray-900">Account details</h2>
              {formattedUpdatedAt ? (
                <p className="text-sm text-gray-500 mt-1">Last updated: {formattedUpdatedAt}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account holder name</label>
              <input
                type="text"
                value={form.accountHolderName}
                onChange={(e) => setForm((p) => ({ ...p, accountHolderName: e.target.value }))}
                className={inputClass("accountHolderName")}
                placeholder="Enter account holder name"
              />
              {errors.accountHolderName ? (
                <p className="mt-1.5 text-xs text-[#2E7D52] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.accountHolderName}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account number</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.accountNumber}
                onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value.replace(/[^\d\s-]/g, "") }))}
                className={inputClass("accountNumber")}
                placeholder="Enter account number"
              />
              {errors.accountNumber ? (
                <p className="mt-1.5 text-xs text-[#2E7D52] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.accountNumber}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Confirm account number</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.confirmAccountNumber}
                onChange={(e) => setForm((p) => ({ ...p, confirmAccountNumber: e.target.value.replace(/[^\d\s-]/g, "") }))}
                className={inputClass("confirmAccountNumber")}
                placeholder="Re-enter account number"
              />
              {errors.confirmAccountNumber ? (
                <p className="mt-1.5 text-xs text-[#2E7D52] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.confirmAccountNumber}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">IFSC code</label>
              <input
                type="text"
                maxLength={11}
                value={form.ifscCode}
                onChange={(e) => setForm((p) => ({ ...p, ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
                className={inputClass("ifscCode")}
                placeholder="e.g. SBIN0018764"
              />
              {errors.ifscCode ? (
                <p className="mt-1.5 text-xs text-[#2E7D52] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.ifscCode}
                </p>
              ) : null}
            </div>

            <div className="pt-2 border-t border-gray-200">
              <h2 className="text-base font-bold text-gray-900 mb-3">UPI details</h2>

              <label className="block text-sm font-medium text-gray-700 mb-2">UPI ID</label>
              <input
                type="text"
                value={form.upiId}
                onChange={(e) => setForm((p) => ({ ...p, upiId: e.target.value.trim() }))}
                className={inputClass("upiId")}
                placeholder="e.g. merchant@okaxis"
              />
              {errors.upiId ? (
                <p className="mt-1.5 text-xs text-[#2E7D52] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.upiId}
                </p>
              ) : null}

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">UPI QR image</label>
                {form.upiQrImage ? (
                  <img
                    src={form.upiQrImage}
                    alt="UPI QR"
                    className="w-40 h-40 object-contain border border-gray-200 rounded-lg bg-white"
                  />
                ) : (
                  <div className="w-40 h-40 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-500">
                    No QR uploaded
                  </div>
                )}

                <div 
                  onClick={handleQrClick}
                  className="inline-flex mt-3 items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50"
                >
                  {uploadingQr ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload QR Image
                    </>
                  )}
                  <input
                    ref={qrInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingQr}
                    onChange={(e) => handleQrUpload(e.target.files?.[0])}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  // Discard edits by reloading the saved values.
                  setErrors({})
                  setIsEditing(false)
                  loadProfile()
                }}
                disabled={saving || uploadingQr}
                className="flex-1 border border-gray-300 text-gray-700 font-bold py-4 rounded-lg text-base disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || uploadingQr}
                className="flex-[2] bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg text-base transition-colors"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
      
      <ImageSourcePicker
        isOpen={isQrPickerOpen}
        onClose={() => setIsQrPickerOpen(false)}
        onFileSelect={handleQrUpload}
        title="Upload UPI QR"
        description="Choose how to upload your bank UPI QR image"
        fileNamePrefix="upi-qr"
        galleryInputRef={qrInputRef}
      />
    </div>
  )
}







