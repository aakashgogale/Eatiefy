import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Trophy, CheckCircle2, Clock, ArrowLeft, Loader2, AlertCircle, ChevronRight } from "lucide-react"
import { deliveryAPI } from "@food/api"
import useDeliveryBackNavigation from "../hooks/useDeliveryBackNavigation"

const TYPE_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }

function ProgressRing({ completed, target, size = 72 }) {
  const radius = (size - 10) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(completed / Math.max(target, 1), 1)
  const dashOffset = circumference * (1 - pct)
  const themeColor = "var(--module-theme-color, #00B761)"

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f0f0f0" strokeWidth={9} />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke={pct >= 1 ? themeColor : "#111111"}
        strokeWidth={9}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}
      />
    </svg>
  )
}

function BonusCard({ item }) {
  const { rule, ordersCompleted, targetOrders, bonusAmount, isEligible, approvalStatus, approvedAt } = item
  const isApproved = approvalStatus === "bonus_given"
  const isPending = approvalStatus === "eligible" || isEligible
  const remaining = Math.max(0, targetOrders - ordersCompleted)

  return (
    <div className="bg-white rounded-[28px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden mb-4">
      {/* Card header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">{TYPE_LABELS[rule.targetType]} Target</p>
          <h3 className="text-base font-bold text-gray-900 mt-0.5">{rule.name}</h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">Bonus</p>
          <p className="text-xl font-black text-gray-900" style={{ color: "var(--module-theme-color, #00B761)" }}>₹{bonusAmount}</p>
        </div>
      </div>

      {/* Progress area */}
      <div className="px-5 py-5 flex items-center gap-5">
        <div className="relative shrink-0">
          <ProgressRing completed={ordersCompleted} target={targetOrders} size={80} />
          <div className="absolute inset-0 flex items-center justify-center font-black">
            <span className="text-[16px] text-gray-900">{ordersCompleted}</span>
            <span className="text-[12px] text-gray-400">/{targetOrders}</span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900 mb-2">Orders Completed</p>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min((ordersCompleted / Math.max(targetOrders, 1)) * 100, 100)}%`,
                backgroundColor: ordersCompleted >= targetOrders ? "var(--module-theme-color, #00B761)" : "#111111",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-gray-400 font-medium">{ordersCompleted} done</span>
            <span className="text-[11px] text-gray-400 font-medium">Target: {targetOrders}</span>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="px-5 pb-5">
        {isApproved ? (
          <div
            className="rounded-[20px] p-4 flex items-start gap-3"
            style={{ backgroundColor: "rgba(var(--module-theme-rgb, 0,183,97), 0.08)", border: "1px solid rgba(var(--module-theme-rgb, 0,183,97), 0.20)" }}
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "var(--module-theme-color, #00B761)" }} />
            <div>
              <p className="font-bold text-gray-900 text-sm">Bonus Approved! 🎉</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                ₹{bonusAmount} has been credited to your wallet.
                {approvedAt && ` Approved on ${new Date(approvedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}.`}
              </p>
            </div>
          </div>
        ) : isPending ? (
          <div className="bg-amber-50 rounded-[20px] p-4 flex items-start gap-3 border border-amber-100">
            <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-gray-900 text-sm">Pending Admin Approval</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Great job! You've completed the {TYPE_LABELS[rule.targetType].toLowerCase()} target. Your ₹{bonusAmount} bonus is waiting for admin approval.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-[20px] p-4 flex items-start gap-3 border border-gray-100">
            <Trophy className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-gray-900 text-sm">
                {remaining} more order{remaining !== 1 ? "s" : ""} to go!
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Complete {targetOrders} deliveries to earn ₹{bonusAmount} bonus.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MyBonusStatusV2() {
  const navigate = useNavigate()
  const goBack = useDeliveryBackNavigation()
  const [bonusStatus, setBonusStatus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    deliveryAPI.getMyBonusStatus()
      .then(res => setBonusStatus(res.data?.data?.bonusStatus || []))
      .catch(() => setError("Could not load bonus status. Please try again."))
      .finally(() => setLoading(false))
  }, [])

  const hasAnyActive = bonusStatus.length > 0
  const anyApproved = bonusStatus.some(b => b.approvalStatus === "bonus_given")
  const anyPending = bonusStatus.some(b => b.approvalStatus === "eligible" || (b.isEligible && b.approvalStatus !== "bonus_given"))

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center font-poppins pb-32">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--module-theme-color, #00B761)" }} />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-poppins pb-32 overflow-x-clip touch-pan-y" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* Sticky Header — same style as ProfileV2 / PocketV2 */}
      <div className="sticky top-0 z-[100] bg-[#f8f9fa]/90 backdrop-blur-xl border-b border-gray-100 px-4 py-4 pt-8 mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={goBack}
            className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-gray-900 border border-gray-200 shadow-sm active:scale-95 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tighter">MY BONUS</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Delivery targets & rewards</p>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {/* Status summary pills */}
        {hasAnyActive && (anyApproved || anyPending) && (
          <div className="flex gap-2 flex-wrap mb-2">
            {anyApproved && (
              <span
                className="flex items-center gap-1.5 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full"
                style={{ backgroundColor: "var(--module-theme-color, #00B761)" }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Bonus Approved
              </span>
            )}
            {anyPending && (
              <span className="flex items-center gap-1.5 bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full">
                <Clock className="w-3.5 h-3.5" /> Pending Approval
              </span>
            )}
          </div>
        )}

        {error ? (
          <div className="bg-white rounded-[24px] border border-red-100 p-5 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        ) : !hasAnyActive ? (
          <div className="bg-white rounded-[28px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-8 text-center">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4 border"
              style={{
                backgroundColor: "rgba(var(--module-theme-rgb, 0,183,97), 0.08)",
                borderColor: "rgba(var(--module-theme-rgb, 0,183,97), 0.18)",
              }}
            >
              <Trophy className="w-8 h-8" style={{ color: "var(--module-theme-color, #00B761)" }} />
            </div>
            <h3 className="font-black text-gray-900 mb-2">No Active Targets</h3>
            <p className="text-sm text-gray-400">No bonus rules are currently active. Check back later!</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">
              Your progress today
            </p>
            {bonusStatus.map((item, idx) => (
              <BonusCard key={idx} item={item} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
