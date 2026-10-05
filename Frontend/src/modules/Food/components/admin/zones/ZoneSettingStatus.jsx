import { MapPin } from "lucide-react"

/**
 * "Custom for this zone" / "Using default" badge for one value of a
 * zone-scoped settings page. Renders nothing for the all-zones default.
 */
export function ZoneSettingBadge({ zoneId, loading, overridden }) {
  if (!zoneId || loading) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        overridden ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      <MapPin className="w-3 h-3" />
      {overridden ? "Custom for this zone" : "Using default"}
    </span>
  )
}

/** One line under a zone's value saying what the default is and how saving behaves. */
export function ZoneDefaultHint({ zoneId, overridden, defaultLabel }) {
  if (!zoneId || defaultLabel == null || defaultLabel === "") return null
  return (
    <p className="text-xs text-slate-500 mt-1">
      {overridden
        ? `Default for other zones: ${defaultLabel}.`
        : `This zone follows the default (${defaultLabel}). Saving a new value overrides it for this zone only.`}
    </p>
  )
}
