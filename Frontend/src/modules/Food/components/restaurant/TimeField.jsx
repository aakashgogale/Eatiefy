import { Clock } from "lucide-react";
import { normalizeTimeValue, formatTime12Hour } from "@food/utils/outletHours";

/**
 * Time input for outlet hours.
 *
 * Uses the native `<input type="time">` instead of the MUI MobileTimePicker the
 * onboarding screens used before. The MUI clock dial fired `onChange` on every
 * partial interaction (dragging the hour hand emitted intermediate values), which
 * the callers then rejected mid-gesture — so taps appeared to do nothing. The
 * native control commits a whole value at once, opens the platform's own picker
 * on mobile, is keyboard accessible, and drops a heavy dependency.
 *
 * Always emits a canonical "HH:mm" string, or "" when cleared.
 */
export default function TimeField({
  label,
  value,
  onChange,
  id,
  disabled = false,
  invalid = false,
  hint,
  min,
  max,
  presets = [],
}) {
  const normalized = normalizeTimeValue(value);
  const inputId = id || `time-${String(label || "field").toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div
      className={`rounded-md border px-3 py-2 transition-colors ${
        invalid
          ? "border-red-300 bg-red-50/50"
          : "border-gray-200 bg-gray-50/60 focus-within:border-gray-900"
      }`}
    >
      <label htmlFor={inputId} className="mb-2 flex items-center gap-2 cursor-pointer">
        <Clock className={`h-4 w-4 ${invalid ? "text-red-500" : "text-gray-800"}`} />
        <span className="text-xs font-medium text-gray-900">{label}</span>
      </label>

      <input
        id={inputId}
        type="time"
        value={normalized}
        disabled={disabled}
        min={min}
        max={max}
        // Always report the raw value: validation belongs to the form, not the
        // input, so a value is never silently swallowed while being typed.
        onChange={(event) => onChange(normalizeTimeValue(event.target.value))}
        className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-900 outline-none focus:border-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
      />

      {presets.length > 0 && !disabled ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const presetValue = normalizeTimeValue(preset);
            if (!presetValue) return null;
            const active = presetValue === normalized;
            return (
              <button
                key={presetValue}
                type="button"
                onClick={() => onChange(presetValue)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
                }`}
              >
                {formatTime12Hour(presetValue)}
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="mt-1 h-4 text-[11px] leading-4 text-gray-500">
        {hint || (normalized ? formatTime12Hour(normalized) : "")}
      </p>
    </div>
  );
}
