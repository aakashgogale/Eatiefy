import { Link, useLocation } from "react-router-dom"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { ArrowLeft, AlertTriangle, Phone, Shield, Loader2 } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import { Textarea } from "@food/components/ui/textarea"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { userAPI } from "@food/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function ReportSafetyEmergency() {
  const goBack = useAppBackNavigation()
  const [report, setReport] = useState("")
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null)
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false)

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true)
      const res = await userAPI.getMySafetyEmergencyReports({ page: 1, limit: 20 })
      const list = res?.data?.data?.safetyEmergencies ?? []
      setHistory(Array.isArray(list) ? list : [])
    } catch (err) {
      debugError("Error fetching safety emergency history:", err)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const historySorted = useMemo(() => {
    const arr = Array.isArray(history) ? [...history] : []
    arr.sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    return arr
  }, [history])

  const getStatusPill = (status) => {
    const map = {
      unread: "bg-blue-100 text-blue-700",
      read: "bg-slate-100 text-slate-700",
      urgent: "bg-red-100 text-red-700",
      resolved: "bg-green-100 text-green-700",
    }
    const cls = map[String(status)] || map.unread
    const label = String(status || "unread").replace(/^\w/, (c) => c.toUpperCase())
    return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>
  }

  const getPriorityPill = (priority) => {
    const map = {
      low: "bg-gray-100 text-gray-700",
      medium: "bg-yellow-100 text-yellow-700",
      high: "bg-orange-100 text-orange-700",
      critical: "bg-red-100 text-red-700 font-bold",
    }
    const cls = map[String(priority)] || map.medium
    const label = String(priority || "medium").replace(/^\w/, (c) => c.toUpperCase())
    return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>
  }

  const formatDateTime = (iso) => {
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ""
      return d.toLocaleString()
    } catch {
      return ""
    }
  }

  const handleSubmit = async () => {
    if (!report.trim()) {
      toast.error('Please describe the safety concern or emergency')
      return
    }

    if (report.trim().length < 10) {
      toast.error('Description must be at least 10 characters')
      return
    }

    try {
      setIsSubmitting(true)
      const response = await userAPI.createSafetyEmergencyReport(report.trim())
      
      if (response.data.success) {
        setIsSubmitted(true)
        setReport("")
        toast.success('Safety emergency report submitted successfully!')
        fetchHistory()
        setTimeout(() => {
          setIsSubmitted(false)
        }, 5000)
      }
    } catch (error) {
      debugError('Error submitting safety emergency report:', error)
      const backendError = error.response?.data?.message || error.response?.data?.error
      toast.error(backendError || 'Failed to submit safety emergency report. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenHistoryDetails = (item) => {
    setSelectedHistoryItem(item)
    setIsHistoryDialogOpen(true)
  }

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] pb-24 md:pb-0">
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 lg:py-8">
        {/* Header */}
        <div className="flex items-center mb-6 md:mb-8">
          <div
            onClick={goBack}
            className="h-10 w-10 md:h-11 md:w-11 flex items-center justify-center bg-white dark:bg-[#1a1a1a] rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_15px_rgba(0,0,0,0.08)] active:scale-95 transition-all cursor-pointer border border-slate-100 dark:border-gray-800"
          >
            <ArrowLeft className="h-5 w-5 text-slate-800 dark:text-white" />
          </div>
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white ml-4">Report an Emergency</h1>
        </div>

        {/* Emergency Contact Card */}
        <Card className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/30 dark:to-[#1a1a1a] border border-red-100 dark:border-red-900/50 rounded-2xl shadow-sm mb-5 md:mb-6 overflow-hidden">
          <CardContent className="p-5 md:p-6 relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-100 dark:bg-red-900/20 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
            <div className="flex items-start gap-4 relative z-10">
              <div className="bg-red-100 dark:bg-red-900/50 rounded-full p-3 md:p-3.5 mt-0.5 shadow-sm">
                <Phone className="h-5 w-5 md:h-6 md:w-6 text-[#DC2626] dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-1.5">
                  Emergency Contact
                </h3>
                <p className="text-sm md:text-base text-slate-600 dark:text-gray-300 mb-4 leading-relaxed">
                  For immediate emergencies, please call your local emergency services directly for immediate assistance.
                </p>
                <a
                  href="tel:100"
                  className="inline-flex items-center justify-center bg-white dark:bg-[#222] text-[#DC2626] dark:text-red-400 border border-red-100 dark:border-red-900/30 font-bold text-base md:text-lg px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-all active:scale-95"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call 100
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isSubmitted ? (
          <>
            {/* Info Card */}
            <Card className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800 mb-5 md:mb-6">
              <CardContent className="p-5 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="bg-slate-50 dark:bg-gray-800/80 rounded-full p-3 mt-0.5 border border-slate-100 dark:border-gray-700">
                    <Shield className="h-5 w-5 md:h-6 md:w-6 text-slate-700 dark:text-gray-300" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white mb-1.5">
                      Safety is our priority
                    </h3>
                    <p className="text-sm md:text-base text-slate-500 dark:text-gray-400 leading-relaxed">
                      Report any safety concerns, incidents, or emergencies related to your order or delivery experience. We take these reports very seriously.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Report Form */}
            <Card className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-[0_2px_15px_rgba(0,0,0,0.02)] border border-slate-100 dark:border-gray-800 mb-5 md:mb-6">
              <CardContent className="p-5 md:p-6">
                <label className="block text-sm md:text-base font-semibold text-slate-900 dark:text-white mb-3">
                  Describe the safety concern or emergency
                </label>
                <Textarea
                  placeholder="Please provide details about the safety issue..."
                  value={report}
                  onChange={(e) => setReport(e.target.value)}
                  className="min-h-[160px] md:min-h-[200px] w-full resize-y text-sm md:text-base leading-relaxed bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl p-4 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
                  dir="ltr"
                  style={{
                    direction: 'ltr',
                    textAlign: 'left',
                    unicodeBidi: 'bidi-override',
                    width: '100%',
                    maxWidth: '100%'
                  }}
                />
                <p className={`text-xs md:text-sm mt-3 flex justify-between font-medium ${report.trim().length < 10 ? 'text-[#DC2626]' : 'text-slate-500 dark:text-gray-400'}`}>
                  <span>{report.length} characters</span>
                  <span>Min 10 characters</span>
                </p>
              </CardContent>
            </Card>

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={report.trim().length < 10 || isSubmitting}
              className="w-full bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-base h-12 md:h-14 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_14px_rgba(220,38,38,0.25)] hover:shadow-[0_6px_20px_rgba(220,38,38,0.3)] transition-all active:scale-[0.98]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Submitting Report...
                </>
              ) : (
                'Submit Safety Report'
              )}
            </Button>

            {/* History */}
            <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border-0 dark:border-gray-800 mt-5 md:mt-6">
              <CardContent className="p-4 md:p-5 lg:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white">
                    Your report history
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchHistory}
                    disabled={historyLoading}
                    className="h-8"
                  >
                    {historyLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading
                      </>
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>

                {historyLoading && historySorted.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                    Loading your reports...
                  </p>
                ) : historySorted.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                    No reports yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {historySorted.map((item) => (
                      <button
                        type="button"
                        key={item?._id || item?.id || `${item?.createdAt}-${item?.message?.slice?.(0, 12)}`}
                        onClick={() => handleOpenHistoryDetails(item)}
                        className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 p-3 md:p-4 bg-gray-50 dark:bg-[#101010] hover:bg-gray-100 dark:hover:bg-[#141414] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm md:text-base font-medium text-gray-900 dark:text-white truncate">
                              {item?.message || "—"}
                            </p>
                            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {formatDateTime(item?.createdAt)}
                            </p>
                          </div>
                          <div className="shrink-0">
                            {getStatusPill(item?.status)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* History Details Dialog */}
            <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
              <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    Report Details
                  </DialogTitle>
                  <DialogDescription>
                    Full details of your safety emergency report.
                  </DialogDescription>
                </DialogHeader>

                {selectedHistoryItem && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusPill(selectedHistoryItem?.status)}
                      {selectedHistoryItem?.priority ? getPriorityPill(selectedHistoryItem?.priority) : null}
                      {selectedHistoryItem?.createdAt ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDateTime(selectedHistoryItem.createdAt)}
                        </span>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0f0f0f] p-4">
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {selectedHistoryItem?.message || "—"}
                      </p>
                    </div>

                    {selectedHistoryItem?.adminResponse && (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/10 p-4">
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mb-2">
                          Admin response
                        </p>
                        <p className="text-sm text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap leading-relaxed">
                          {selectedHistoryItem.adminResponse}
                        </p>
                        {selectedHistoryItem?.respondedAt && (
                          <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-2">
                            Responded at: {formatDateTime(selectedHistoryItem.respondedAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        ) : (
          /* Success State */
          <Card className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-md border-0 dark:border-gray-800 overflow-hidden">
            <CardContent className="p-6 md:p-8 lg:p-10 text-center">
              <div className="w-16 h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-5 lg:mb-6">
                <AlertTriangle className="h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white mb-2 md:mb-3">Report Submitted</h2>
              <p className="text-sm md:text-base lg:text-lg text-gray-600 dark:text-gray-400 mb-3 md:mb-4">
                Your safety report has been submitted. Our team will review it immediately and take appropriate action.
              </p>
              <p className="text-xs md:text-sm text-red-600 dark:text-red-400 font-medium">
                If this is a life-threatening emergency, please call 100 immediately.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AnimatedPage>
  )
}


