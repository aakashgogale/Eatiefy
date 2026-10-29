import { Clock } from "lucide-react";
import { normalizeTimeValue } from "@food/utils/outletHours";

/**
 * Time input for outlet hours. Any valid time (hours and minutes) can be picked;
 * there are no predefined options.
 *
 * Renders three plain `<select>` dropdowns (hour / minute / AM-PM) instead of the
 * native `<input type="time">` the app used before. Inside the restaurant app's
 * WebView, the OS's native time-picker dialog (the one with +/- steppers) could
 * kick the whole app out when its steppers were tapped — a native-shell crash we
 * cannot fix from this web code. Plain `<select>` elements fall back to the
 * browser's ordinary (non-crashing) option list and avoid that dialog entirely.
 *
 * Always emits a canonical "HH:mm" string, or "" when incomplete.
 */
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i); // 0..59

const to24Hour = (hour12, minute, period) => {
  let hours = Number(hour12);
  if (!Number.isFinite(hours)) return "";
  if (period === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }
  return `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const splitTime = (normalized) => {
  if (!normalized) return { hour12: "", minute: "", period: "" };
  const [h, m] = normalized.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return { hour12: String(hour12), minute: String(m).padStart(2, "0"), period };
};

export default function TimeField({
  label,
  value,
  onChange,
  id,
  disabled = false,
  invalid = false,
  hint,
}) {
  const normalized = normalizeTimeValue(value);
  const { hour12, minute, period } = splitTime(normalized);
  const baseId = id || `time-${String(label || "field").toLowerCase().replace(/\s+/g, "-")}`;

  const emit = (nextHour12, nextMinute, nextPeriod) => {
    if (nextHour12 === "" || nextMinute === "" || nextPeriod === "") return;
    onChange(to24Hour(nextHour12, nextMinute, nextPeriod));
  };

  const selectClass =
    "h-9 flex-1 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100";

  return (
    <div
      className={`rounded-md border px-3 py-2 transition-colors ${
        invalid
          ? "border-red-300 bg-red-50/50"
          : "border-gray-200 bg-gray-50/60 focus-within:border-gray-900"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Clock className={`h-4 w-4 ${invalid ? "text-red-500" : "text-gray-800"}`} />
        <span className="text-xs font-medium text-gray-900">{label}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          id={`${baseId}-hour`}
          aria-label={`${label} hour`}
          disabled={disabled}
          value={hour12}
          onChange={(event) => emit(event.target.value, minute || "00", period || "AM")}
          className={selectClass}
        >
          <option value="" disabled>
            --
          </option>
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-gray-400">:</span>
        <select
          id={`${baseId}-minute`}
          aria-label={`${label} minute`}
          disabled={disabled}
          value={minute}
          onChange={(event) => emit(hour12 || "12", event.target.value, period || "AM")}
          className={selectClass}
        >
          <option value="" disabled>
            --
          </option>
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={String(m).padStart(2, "0")}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <select
          id={`${baseId}-period`}
          aria-label={`${label} AM or PM`}
          disabled={disabled}
          value={period}
          onChange={(event) => emit(hour12 || "12", minute || "00", event.target.value)}
          className={selectClass}
        >
          <option value="" disabled>
            --
          </option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      <p className="mt-1 h-4 text-[11px] leading-4 text-gray-500">{hint || ""}</p>
    </div>
  );
}
