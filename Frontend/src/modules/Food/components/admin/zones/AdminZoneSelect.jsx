import { ChevronDown, MapPin } from "lucide-react"
import { getZoneId, getZoneLabel } from "@food/hooks/useAdminZoneFilter"

/**
 * Zone dropdown for admin pages; pair it with `useAdminZoneFilter`.
 * `value` is a zone id, "" selects `allLabel`.
 */
export default function AdminZoneSelect({
  value,
  onChange,
  zones,
  loading = false,
  allLabel = "All Zones",
  getOptionLabel = getZoneLabel,
  disabled = false,
  className = "",
}) {
  const showLoading = loading && zones.length === 0

  return (
    <div className={`relative min-w-[200px] w-full sm:w-auto ${className}`}>
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-600 pointer-events-none" />
      <select
        aria-label="Filter by zone"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || showLoading}
        className="w-full sm:w-[220px] pl-9 pr-8 py-2 text-sm font-semibold rounded-lg border border-slate-200 bg-slate-50 hover:bg-white text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer appearance-none shadow-2xs transition-all disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{showLoading ? "Loading zones..." : allLabel}</option>
        {zones.map((zone) => {
          const id = getZoneId(zone)
          return (
            <option key={id} value={id}>
              {getOptionLabel(zone)}
              {zone?.isActive === false ? " (Inactive)" : ""}
            </option>
          )
        })}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  )
}
