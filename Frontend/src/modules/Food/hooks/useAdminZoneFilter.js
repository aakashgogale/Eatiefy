import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { adminAPI } from "@food/api"

const ZONE_PARAM = "zoneId"
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

export const getZoneId = (zone) => String(zone?._id || zone?.id || "")

export const getZoneLabel = (zone) =>
  zone?.name || zone?.zoneName || zone?.serviceLocation || "Unnamed Zone"

const extractZones = (response) => {
  const data = response?.data?.data
  if (Array.isArray(data?.zones)) return data.zones
  return Array.isArray(data) ? data : []
}

/**
 * Zone filter shared by the admin Restaurant Management pages.
 *
 * The selected zone lives in the URL (`?zoneId=`), so a refresh or a shared link
 * keeps it and every page reads it the same way; "" means all zones. A malformed
 * id, or one that no longer matches a zone once the list has loaded, is dropped
 * rather than sent as a filter that can only return nothing.
 */
export function useAdminZoneFilter() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(true)
  const [zonesLoaded, setZonesLoaded] = useState(false)

  const rawZoneId = searchParams.get(ZONE_PARAM) || ""
  const zoneId = OBJECT_ID_PATTERN.test(rawZoneId) ? rawZoneId : ""

  useEffect(() => {
    let cancelled = false
    // Same params as the other admin zone lookups, so the cached response is shared.
    adminAPI
      .getZones({ page: 1, limit: 1000 })
      .then((response) => {
        if (cancelled) return
        const list = [...extractZones(response)].sort((a, b) =>
          getZoneLabel(a).localeCompare(getZoneLabel(b)),
        )
        setZones(list)
        setZonesLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setZoneId = useCallback(
    (nextZoneId) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (nextZoneId) params.set(ZONE_PARAM, String(nextZoneId))
          else params.delete(ZONE_PARAM)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const selectedZone = useMemo(
    () => (zoneId ? zones.find((zone) => getZoneId(zone) === zoneId) || null : null),
    [zones, zoneId],
  )

  useEffect(() => {
    if (!rawZoneId) return
    const malformed = rawZoneId !== zoneId
    const unknown = zonesLoaded && !selectedZone
    if (malformed || unknown) setZoneId("")
  }, [rawZoneId, zoneId, zonesLoaded, selectedZone, setZoneId])

  return { zones, zonesLoading, zoneId, setZoneId, selectedZone }
}
