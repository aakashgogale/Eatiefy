import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, ArrowLeft, Save, X, Hand, Shapes, Search } from "lucide-react"
import { adminAPI } from "@food/api"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Zone drawing limits.
const MIN_POINTS = 3
const MAX_POINTS = 10

// Order points radially (by angle around their centroid) so the polygon edges never
// self-intersect, while KEEPING every clicked point (unlike a convex hull, which would
// drop points that fall inside the shape). Accepts LatLng objects or {lat,lng} and
// returns an array of {lat, lng}.
const orderPointsRadially = (pts) => {
  const points = pts
    .map(p => ({
      lat: typeof p.lat === 'function' ? p.lat() : p.lat,
      lng: typeof p.lng === 'function' ? p.lng() : p.lng,
    }))
    .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number')

  if (points.length < 3) return points

  const cx = points.reduce((s, p) => s + p.lng, 0) / points.length
  const cy = points.reduce((s, p) => s + p.lat, 0) / points.length

  return [...points].sort((a, b) =>
    Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx)
  )
}


export default function AddZone() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditMode = !!id && !window.location.pathname.includes('/view/')
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const polygonRef = useRef(null)
  const markersRef = useRef([])
  const pathMarkersRef = useRef([])
  // Manual drawing state (DrawingManager is deprecated/removed by Google).
  const mapClickListenerRef = useRef(null)
  const drawPointsRef = useRef([]) // LatLng[] collected while drawing
  const isDrawingRef = useRef(false)
  
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    country: "India",
    zoneName: "",
    unit: "kilometer",
  })
  
  const [coordinates, setCoordinates] = useState([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [locationSearch, setLocationSearch] = useState("")
  const [existingZones, setExistingZones] = useState([])
  const autocompleteInputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const existingZonesPolygonsRef = useRef([])

  useEffect(() => {
    fetchExistingZones()
    loadGoogleMaps()
    if (isEditMode && id) {
      fetchZone()
    }
  }, [id, isEditMode])

  // Center map on India when country is selected
  useEffect(() => {
    if (formData.country === "India" && mapInstanceRef.current) {
      const indiaCenter = { lat: 20.5937, lng: 78.9629 }
      mapInstanceRef.current.setCenter(indiaCenter)
      mapInstanceRef.current.setZoom(5)
    }
  }, [formData.country])

  // Initialize Places Autocomplete when map is loaded
  useEffect(() => {
    if (mapLoading || !mapInstanceRef.current || !autocompleteInputRef.current || !window.google?.maps?.places || autocompleteRef.current) {
      return
    }

    const autocomplete = new window.google.maps.places.Autocomplete(autocompleteInputRef.current, {
      // No `geocode` type — it routes predictions through Geocoding-style endpoints.
      componentRestrictions: { country: 'in' }, // Restrict to India
      fields: ['geometry', 'formatted_address', 'name'],
    })

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (place.geometry && place.geometry.location && mapInstanceRef.current) {
        const location = place.geometry.location
        mapInstanceRef.current.setCenter(location)
        mapInstanceRef.current.setZoom(15) // Zoom in when location is selected

        // Set the search input value
        setLocationSearch(place.formatted_address || place.name || "")
      }
    })

    autocompleteRef.current = autocomplete

    // The Places suggestion dropdown (.pac-container) is appended to <body> and
    // can render behind the map / modal. Force it on top so suggestions are visible.
    if (!document.getElementById('pac-container-zindex-fix')) {
      const style = document.createElement('style')
      style.id = 'pac-container-zindex-fix'
      style.textContent = '.pac-container { z-index: 10000 !important; }'
      document.head.appendChild(style)
    }
  }, [mapLoading])

  // Draw existing polygon when in edit mode and coordinates are loaded
  useEffect(() => {
    if (isEditMode && coordinates.length >= 3 && mapInstanceRef.current && window.google && !mapLoading) {
      debugLog("Drawing existing polygon in edit mode, coordinates:", coordinates.length)
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          // Ensure manual drawing mode is off when editing an existing polygon.
          isDrawingRef.current = false
          setIsDrawing(false)
          mapInstanceRef.current.setOptions({ draggableCursor: null })
          drawExistingPolygon(window.google, mapInstanceRef.current, coordinates)
        }
      }, 500)
    }
  }, [isEditMode, coordinates.length, mapLoading])


  const fetchExistingZones = async () => {
    try {
      const response = await adminAPI.getZones({ limit: 1000 })
      if (response.data?.success && response.data.data?.zones) {
        // Filter out the current zone if in edit mode
        const zones = isEditMode && id 
          ? response.data.data.zones.filter(zone => zone._id !== id)
          : response.data.data.zones
        setExistingZones(zones)
      }
    } catch (error) {
      debugError("Error fetching existing zones:", error)
      setExistingZones([])
    }
  }

  const fetchZone = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getZoneById(id)
      if (response.data?.success && response.data.data?.zone) {
        const zoneData = response.data.data.zone
        setFormData({
          country: zoneData.country || "India",
          zoneName: zoneData.name || zoneData.zoneName || "",
          unit: zoneData.unit || "kilometer",
        })
        
        if (zoneData.coordinates && zoneData.coordinates.length > 0) {
          setCoordinates(zoneData.coordinates)
        }
      }
    } catch (error) {
      debugError("Error fetching zone:", error)
      alert("Failed to load zone")
      navigate("/admin/food/zone-setup")
    } finally {
      setLoading(false)
    }
  }

  // Wait until a condition is true, polling every 100ms up to `timeoutMs`.
  const waitFor = async (predicate, timeoutMs = 8000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true
      await new Promise(r => setTimeout(r, 100))
    }
    return predicate()
  }

  const loadGoogleMaps = async () => {
    try {
      const apiKey = await getGoogleMapsApiKey()
      setGoogleMapsApiKey(apiKey || "loaded")

      if (!apiKey) {
        setMapLoading(false)
        return
      }

      // We only need `places` (search autocomplete) and `geometry`. We do NOT use the
      // `drawing` library — Google has retired DrawingManager (it throws "no longer
      // available"). We draw polygons manually via map clicks instead. So we can happily
      // reuse whatever Maps script another page already loaded (they all include places).

      const existingScript = Array.from(document.getElementsByTagName("script"))
        .find(s => s.src?.includes("maps.googleapis.com/maps/api/js"))

      if (!window.google?.maps && !existingScript) {
        // No maps script yet -> inject our own with the libraries we actually use.
        await new Promise((resolve) => {
          const script = document.createElement("script")
          script.id = "google-maps-sdk"
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&v=weekly`
          script.async = true
          script.defer = true
          script.onload = () => resolve(true)
          script.onerror = () => resolve(false)
          document.head.appendChild(script)
        })
      }

      // Wait for the core maps object (loaded by us or another page).
      const ready = await waitFor(() => !!window.google?.maps)
      if (!ready) {
        debugError("Google Maps failed to load")
        setMapLoading(false)
        return
      }

      initializeMap(window.google)
    } catch (error) {
      debugError("Error loading Google Maps:", error)
      setMapLoading(false)
    }
  }

  const initializeMap = (google) => {
    if (!mapRef.current) return

    // Initial location (India center)
    const initialLocation = { lat: 20.5937, lng: 78.9629 }

    // Create map
    const map = new google.maps.Map(mapRef.current, {
      center: initialLocation,
      zoom: 5,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE]
      },
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      scrollwheel: true, // Enable mouse wheel zoom
      gestureHandling: 'greedy', // Allow zoom with mouse wheel and touch gestures
      disableDoubleClickZoom: false, // Allow double-click zoom
      clickableIcons: false, // Don't let POI labels swallow map clicks while drawing
    })

    mapInstanceRef.current = map

    // NOTE: google.maps.drawing.DrawingManager has been retired by Google and throws
    // "The DrawingManager functionality in the Maps JavaScript API is no longer
    // available". So we implement manual polygon drawing using the core Maps API:
    // while in drawing mode, each map click adds a vertex; the polygon + vertex markers
    // are rebuilt live and stay editable after drawing finishes.
    pathMarkersRef.current = []

    // Add a map-click listener that appends a vertex while drawing is active.
    mapClickListenerRef.current = google.maps.event.addListener(map, 'click', (event) => {
      if (!isDrawingRef.current) return
      // Enforce maximum number of points.
      if (drawPointsRef.current.length >= MAX_POINTS) {
        alert(`You can add at most ${MAX_POINTS} points. Click "Finish Drawing" to complete the zone.`)
        return
      }
      drawPointsRef.current.push(event.latLng)
      renderDrawingPolygon(google, map)
    })

    setMapLoading(false)

    // Existing zones will be drawn by useEffect when data is ready

    // If in edit mode and coordinates are already loaded, draw the polygon
    if (isEditMode && coordinates.length >= 3) {
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          drawExistingPolygon(window.google, mapInstanceRef.current, coordinates)
        }
      }, 500) // Small delay to ensure map is fully loaded
    }
  }

  // Draw existing zones on the map
  const drawExistingZonesOnMap = (google, map) => {
    if (!existingZones || existingZones.length === 0) return

    // Clear previous existing zone polygons
    existingZonesPolygonsRef.current.forEach(polygon => {
      if (polygon) polygon.setMap(null)
    })
    existingZonesPolygonsRef.current = []

    existingZones.forEach((zone, index) => {
      if (!zone.coordinates || zone.coordinates.length < 3) return

      // Convert coordinates to LatLng array
      const path = zone.coordinates.map(coord => {
        const lat = typeof coord === 'object' ? (coord.latitude || coord.lat) : null
        const lng = typeof coord === 'object' ? (coord.longitude || coord.lng) : null
        if (lat === null || lng === null) return null
        return new google.maps.LatLng(lat, lng)
      }).filter(Boolean)

      if (path.length < 3) return

      // Create polygon for existing zone with different color (gray/blue)
      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#3b82f6", // Blue color for existing zones
        strokeOpacity: 0.6,
        strokeWeight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.15, // Lighter opacity so new zone stands out
        editable: false, // Not editable
        draggable: false,
        clickable: true,
        zIndex: 0 // Lower z-index so new zone appears on top
      })

      polygon.setMap(map)
      existingZonesPolygonsRef.current.push(polygon)

      // Add info window on click
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px;">
            <strong>${zone.name || zone.zoneName || 'Unnamed Zone'}</strong><br/>
            <small>Country: ${zone.country || 'N/A'}</small>
          </div>
        `
      })

      polygon.addListener('click', () => {
        infoWindow.setPosition(polygon.getPath().getAt(0))
        infoWindow.open(map)
      })
    })
  }

  // Redraw existing zones when zones data changes or map is ready
  useEffect(() => {
    if (!mapLoading && mapInstanceRef.current && existingZones.length > 0 && window.google) {
      drawExistingZonesOnMap(window.google, mapInstanceRef.current)
    }
  }, [existingZones, mapLoading])

  const updateCoordinatesFromPolygon = (polygon) => {
    const path = polygon.getPath()
    const coords = []
    path.forEach((latLng) => {
      coords.push({
        latitude: latLng.lat(),
        longitude: latLng.lng()
      })
    })
    setCoordinates(coords)
  }

  const drawExistingPolygon = (google, map, coords) => {
    if (!coords || coords.length < 3) {
      debugLog("drawExistingPolygon: Not enough coordinates", coords?.length)
      return
    }

    debugLog("drawExistingPolygon: Drawing polygon with", coords.length, "coordinates")

    // Clear existing polygon
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
    }

    // Clear existing markers
    if (pathMarkersRef.current && pathMarkersRef.current.length > 0) {
      pathMarkersRef.current.forEach(marker => marker.setMap(null))
      pathMarkersRef.current = []
    }

    // Convert coordinates to LatLng array
    const path = coords.map(coord => {
      const lat = typeof coord === 'object' ? (coord.latitude || coord.lat) : null
      const lng = typeof coord === 'object' ? (coord.longitude || coord.lng) : null
      if (lat === null || lng === null) {
        debugError("Invalid coordinate in drawExistingPolygon:", coord)
        return null
      }
      return new google.maps.LatLng(lat, lng)
    }).filter(Boolean)

    if (path.length < 3) {
      debugError("Not enough valid coordinates after conversion")
      return
    }

    // Create polygon
    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: "#9333ea",
      strokeOpacity: 0.8,
      strokeWeight: 3,
      fillColor: "#9333ea",
      fillOpacity: 0.35,
      editable: true,
      draggable: false,
      clickable: false
    })

    polygon.setMap(map)
    polygonRef.current = polygon
    
    // Ensure polygon is editable
    polygon.setEditable(true)
    polygon.setDraggable(false)
    debugLog("Polygon created and set to editable:", polygon.getEditable())

    // Fit map to polygon bounds
    const bounds = new google.maps.LatLngBounds()
    path.forEach(latLng => bounds.extend(latLng))
    map.fitBounds(bounds)
    debugLog("Map fitted to polygon bounds")

    // NOTE: We intentionally do NOT add separate circle markers on the vertices.
    // An editable polygon already shows its own draggable white vertex handles
    // (and midpoint handles to add points) — exactly like the old DrawingManager.
    // Extra markers on top would intercept the mouse and block dragging.
    pathMarkersRef.current = []
    debugLog("drawExistingPolygon: editable polygon created")

    // Update coordinates when the polygon is edited (vertex dragged / added / removed).
    const handlePolygonEdit = () => {
      updateCoordinatesFromPolygon(polygon)
    }

    const polygonPath = polygon.getPath()
    google.maps.event.addListener(polygonPath, 'set_at', handlePolygonEdit)
    google.maps.event.addListener(polygonPath, 'insert_at', handlePolygonEdit)
    google.maps.event.addListener(polygonPath, 'remove_at', handlePolygonEdit)
    
    debugLog("Event listeners attached for polygon editing")
  }

  // Build the vertex markers for a given set of LatLngs.
  const renderVertexMarkers = (google, map, latLngs) => {
    if (pathMarkersRef.current?.length) {
      pathMarkersRef.current.forEach(m => m.setMap(null))
    }
    pathMarkersRef.current = latLngs.map((latLng, i) => new google.maps.Marker({
      position: latLng,
      map,
      clickable: false, // don't block map clicks while drawing
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#9333ea",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 1000,
      title: `Point ${i + 1}`,
    }))
  }

  // Live-render the polygon being drawn (called on every map click while drawing).
  const renderDrawingPolygon = (google, map) => {
    const points = drawPointsRef.current

    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }

    // Order points radially around their centroid so edges never overlap, while still
    // keeping every clicked point. Below 3 points just use them as-is.
    const ordered = points.length >= 3
      ? orderPointsRadially(points)
      : points.map(p => ({ lat: p.lat(), lng: p.lng() }))

    if (ordered.length >= 2) {
      polygonRef.current = new google.maps.Polygon({
        paths: ordered,
        fillColor: "#9333ea",
        fillOpacity: 0.35,
        strokeColor: "#9333ea",
        strokeWeight: 2,
        clickable: false,
        editable: false,
        zIndex: 1,
      })
      polygonRef.current.setMap(map)
    }

    renderVertexMarkers(google, map, points)

    setCoordinates(ordered.map(p => ({
      latitude: parseFloat(p.lat.toFixed(6)),
      longitude: parseFloat(p.lng.toFixed(6)),
    })))
  }

  // Convert the in-progress points into a final editable polygon.
  const finishDrawing = () => {
    const google = window.google
    const map = mapInstanceRef.current
    if (!google || !map) return

    const points = drawPointsRef.current
    if (points.length < MIN_POINTS) {
      // Not enough points yet — keep drawing mode on.
      alert(`Please click at least ${MIN_POINTS} points on the map to form a zone.`)
      return false
    }

    // Replace the preview polygon with a finalized editable one and wire up edit events.
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }
    if (pathMarkersRef.current?.length) {
      pathMarkersRef.current.forEach(m => m.setMap(null))
      pathMarkersRef.current = []
    }

    // Radially order so the final polygon has no overlapping edges, keeping all points.
    const ordered = orderPointsRadially(points)
    const coords = ordered.map(p => ({
      latitude: parseFloat(p.lat.toFixed(6)),
      longitude: parseFloat(p.lng.toFixed(6)),
    }))
    setCoordinates(coords)
    drawExistingPolygon(google, map, coords) // reuse: draws editable polygon + markers + listeners
    return true
  }

  const toggleDrawingMode = () => {
    const google = window.google
    const map = mapInstanceRef.current
    if (!google || !map) {
      alert("Map is still loading. Please wait a moment and try again.")
      return
    }

    if (isDrawing) {
      // Finish drawing -> finalize the polygon.
      const ok = finishDrawing()
      if (ok === false) return // not enough points; stay in drawing mode
      isDrawingRef.current = false
      setIsDrawing(false)
      map.setOptions({ draggableCursor: null })
      // Re-enable existing-zone info windows now that drawing is done.
      existingZonesPolygonsRef.current.forEach(p => p?.setOptions?.({ clickable: true }))
    } else {
      // Start a fresh drawing session.
      clearDrawing()
      drawPointsRef.current = []
      isDrawingRef.current = true
      setIsDrawing(true)
      map.setOptions({ draggableCursor: 'crosshair' })
      // Make existing zones non-clickable so taps over them add points instead of
      // opening their info windows.
      existingZonesPolygonsRef.current.forEach(p => p?.setOptions?.({ clickable: false }))
    }
  }

  const clearDrawing = () => {
    drawPointsRef.current = []
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }
    // Clear all markers
    if (pathMarkersRef.current && pathMarkersRef.current.length > 0) {
      pathMarkersRef.current.forEach(marker => marker.setMap(null))
      pathMarkersRef.current = []
    }
    setCoordinates([])
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.zoneName) {
      alert("Please enter a zone name")
      return
    }

    if (!formData.country) {
      alert("Please select a country")
      return
    }

    if (coordinates.length < 3) {
      alert("Please draw at least 3 points on the map to create a zone")
      return
    }

    try {
      setLoading(true)
      
      // Validate coordinates format
      if (!coordinates || coordinates.length < 3) {
        alert("Please draw at least 3 points on the map")
        setLoading(false)
        return
      }

      // Ensure coordinates have correct format
      const validCoordinates = coordinates.map(coord => {
        if (typeof coord === 'object' && coord.latitude !== undefined && coord.longitude !== undefined) {
          return {
            latitude: parseFloat(coord.latitude),
            longitude: parseFloat(coord.longitude)
          }
        }
        return coord
      })

      const zoneData = {
        name: formData.zoneName,
        zoneName: formData.zoneName,
        country: formData.country,
        unit: formData.unit || "kilometer",
        coordinates: validCoordinates,
        isActive: true
      }

      debugLog("Sending zone data:", zoneData)

      if (isEditMode && id) {
        // Update existing zone
        const response = await adminAPI.updateZone(id, zoneData)
        debugLog("Zone updated successfully:", response)
        alert("Zone updated successfully!")
      } else {
        // Create new zone
        const response = await adminAPI.createZone(zoneData)
        debugLog("Zone created successfully:", response)
        alert("Zone created successfully!")
      }
      navigate("/admin/food/zone-setup")
    } catch (error) {
      debugError("Error creating zone:", error)
      
      // Handle different types of errors
      let errorMessage = "Failed to create zone. Please try again."
      
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error' || !error.response) {
        // Network error - backend not running or CORS issue
        errorMessage = "Cannot connect to server. Please make sure the backend server is running."
        debugError("Network error: Backend server might not be running")
      } else if (error.response) {
        // API error with response
        errorMessage = error.response.data?.message || 
                      error.response.data?.error || 
                      error.message || 
                      `Server error: ${error.response.status}`
        debugError("API error:", error.response.data)
        debugError("Error status:", error.response.status)
      } else {
        // Other errors
        errorMessage = error.message || errorMessage
      }
      
      alert(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate("/admin/food/zone-setup")}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {isEditMode ? "Edit Zone" : "Add New Zone"}
              </h1>
              <p className="text-sm text-slate-600">
                {isEditMode ? "Update delivery zone for customer" : "Create a delivery zone for customer"}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Panel - Form */}
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Zone Details</h2>
                
                <div className="space-y-4">
                  {/* Country Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Country <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.country}
                      onChange={(e) => handleInputChange("country", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="India">India</option>
                    </select>
                  </div>

                  {/* Zone Name */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Create Zone name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.zoneName}
                      onChange={(e) => handleInputChange("zoneName", e.target.value)}
                      placeholder="Enter zone name"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  {/* Select Unit */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Select Unit <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.unit}
                      onChange={(e) => handleInputChange("unit", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="kilometer">Kilometers (km)</option>
                      <option value="miles">Miles (mi)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel - Map */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Draw Zone on Map</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleDrawingMode}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      isDrawing
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    <Shapes className="w-4 h-4" />
                    <span>{isDrawing ? "Finish Drawing" : "Start Drawing"}</span>
                  </button>
                  {coordinates.length > 0 && (
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    ref={autocompleteInputRef}
                    type="text"
                    placeholder="Search location on map..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {isDrawing && (
                  <p className="text-xs text-blue-600 mt-2">
                    Click on the map to add points ({MIN_POINTS}&ndash;{MAX_POINTS}), then click <strong>Finish Drawing</strong>.
                  </p>
                )}
                {coordinates.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Points drawn: <strong>{coordinates.length}</strong>
                    {coordinates.length < 3 && (
                      <span className="text-red-600 ml-2">(Minimum 3 points required)</span>
                    )}
                  </p>
                )}
              </div>

              <div className="relative" style={{ height: "600px" }}>
                <div ref={mapRef} className="w-full h-full rounded-lg" />
                
                {mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-slate-600">Loading map...</p>
                    </div>
                  </div>
                )}

                {!googleMapsApiKey && !mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center p-6">
                      <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-sm text-slate-600">Google Maps API key not found</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => navigate("/admin/food/zone-setup")}
              className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || coordinates.length < 3 || !formData.zoneName || !formData.country}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Zone</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


