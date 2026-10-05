import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { getZoneId, getZoneLabel, useAdminZoneFilter } from "@food/hooks/useAdminZoneFilter"

const defaultToDraft = (value) => (value == null ? "" : String(value))

/**
 * State for an admin settings page that has a platform default plus optional
 * per-zone values (the backend's `{ zoneId, defaults, overridden,
 * zoneOverrides }` shape). The zone comes from `?zoneId=` like every other
 * admin zone filter; "" is the default for all zones.
 *
 * `fields`, `toDraft(value, field, data)` and the API functions must be stable
 * (module-level), or the settings reload on every render. `save(key, values)`
 * sends only `values` - one field per card, so
 * saving one value for a zone never pins the others as overrides; a `null`
 * value clears that zone's override.
 */
export function useZoneScopedSettings({ fields, fetchSettings, saveSettings, label, toDraft = defaultToDraft }) {
  const { zones, zonesLoading, zoneId, setZoneId, selectedZone } = useAdminZoneFilter()
  const [settings, setSettings] = useState(null)
  const [drafts, setDrafts] = useState(() => Object.fromEntries(fields.map((field) => [field, ""])))
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)
  // Only the newest request for the current scope may write state.
  const requestSeqRef = useRef(0)

  const zoneName = selectedZone ? getZoneLabel(selectedZone) : ""

  const applyServerData = useCallback(
    (data, onlyFields = fields) => {
      setSettings(data)
      setDrafts((prev) => ({
        ...prev,
        ...Object.fromEntries(onlyFields.map((field) => [field, toDraft(data?.[field], field, data)])),
      }))
    },
    [fields, toDraft],
  )

  useEffect(() => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    fetchSettings(zoneId ? { zoneId } : {})
      .then((res) => {
        if (seq === requestSeqRef.current) applyServerData(res?.data?.data || {})
      })
      .catch((error) => {
        if (seq === requestSeqRef.current) {
          toast.error(error?.response?.data?.message || `Failed to load ${label}`)
        }
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false)
      })
  }, [zoneId, fetchSettings, applyServerData, label])

  const save = useCallback(
    async (key, values, successMessage) => {
      const seq = ++requestSeqRef.current
      setSavingKey(key)
      try {
        const res = await saveSettings({ ...(zoneId ? { zoneId } : {}), ...values })
        // Only the saved fields are reset; an unsaved edit in another card stays.
        if (seq === requestSeqRef.current) applyServerData(res?.data?.data || {}, Object.keys(values))
        toast.success(successMessage)
        return true
      } catch (error) {
        toast.error(error?.response?.data?.message || `Failed to save ${label}`)
        return false
      } finally {
        setSavingKey(null)
      }
    },
    [zoneId, saveSettings, applyServerData, label],
  )

  const setDraft = useCallback((field, value) => {
    setDrafts((prev) => ({ ...prev, [field]: value }))
  }, [])

  /** Zones that override at least one of this page's values. */
  const zoneOverrides = useMemo(
    () => (settings?.zoneOverrides || []).filter((row) => fields.some((field) => row[field] != null)),
    [settings, fields],
  )
  const overriddenZoneIds = useMemo(() => new Set(zoneOverrides.map((row) => row.zoneId)), [zoneOverrides])
  const zoneNameById = useMemo(
    () => new Map(zones.map((zone) => [getZoneId(zone), getZoneLabel(zone)])),
    [zones],
  )

  return {
    zones,
    zonesLoading,
    zoneId,
    setZoneId,
    zoneName,
    settings,
    drafts,
    setDraft,
    loading,
    savingKey,
    isBusy: loading || savingKey !== null,
    save,
    isOverridden: (field) => Boolean(zoneId && settings?.overridden?.[field]),
    defaultValue: (field) => settings?.defaults?.[field],
    savedValue: (field) => settings?.[field],
    zoneOverrides,
    overriddenZoneIds,
    zoneNameById,
  }
}
