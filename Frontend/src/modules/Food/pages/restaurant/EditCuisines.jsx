import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Lenis from "lenis"
import { ArrowLeft, Search, Check } from "lucide-react"
import { restaurantAPI } from "@food/api"

const CUISINES_STORAGE_KEY = "restaurant_cuisines"

const ALL_CUISINES = [
  "Burger",
  "Chinese",
  "Momos",
  "North Indian",
  "Pizza",
  "Rolls",
  "Sandwich",
  "Shawarma",
  "South Indian",
  "Biryani",
  "Desserts",
  "Ice Cream",
  "Fast Food",
  "Cafe",
  "Italian",
  "Mexican",
  "Thai",
  "Seafood",
  "Salad",
  "Healthy Food",
  "Juices",
  "Beverages",
  "Punjabi",
  "Gujarati",
  "Rajasthani",
  "Mughlai",
  "Street Food",
  "Bakery",
]

const DEFAULT_SELECTED = [
  "Burger",
  "Chinese",
  "Momos",
  "North Indian",
  "Pizza",
  "Rolls",
  "Sandwich",
  "Shawarma",
]

export default function EditCuisines() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Fetch current cuisines from backend
  useEffect(() => {
    const fetchCuisines = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data?.cuisines && Array.isArray(data.cuisines) && data.cuisines.length > 0) {
          setSelected(data.cuisines)
        } else {
          // Fallback to localStorage
          try {
            const saved = localStorage.getItem(CUISINES_STORAGE_KEY)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (Array.isArray(parsed) && parsed.length) {
                setSelected(parsed)
              } else {
                setSelected(DEFAULT_SELECTED)
              }
            } else {
              setSelected(DEFAULT_SELECTED)
            }
          } catch (e) {
            console.error("Error loading cuisines from localStorage:", e)
            setSelected(DEFAULT_SELECTED)
          }
        }
      } catch (error) {
        console.error("Error fetching cuisines:", error)
        // Fallback to localStorage
        try {
          const saved = localStorage.getItem(CUISINES_STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed) && parsed.length) {
              setSelected(parsed)
            } else {
              setSelected(DEFAULT_SELECTED)
            }
          } else {
            setSelected(DEFAULT_SELECTED)
          }
        } catch (e) {
          console.error("Error loading cuisines from localStorage:", e)
          setSelected(DEFAULT_SELECTED)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchCuisines()
  }, [])

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  const handleToggle = (name) => {
    const isSelected = selected.includes(name)
    if (!isSelected && selected.length >= 8) {
      setError("You cannot select more than 8 cuisines")
      // Hide after a short delay
      setTimeout(() => setError(""), 2500)
      return
    }
    setSelected((prev) =>
      isSelected ? prev.filter((c) => c !== name) : [...prev, name]
    )
  }

  const handleUpdate = async () => {
    try {
      // Save to backend API
      const response = await restaurantAPI.updateProfile({ cuisines: selected })
      
      if (response?.data?.data?.restaurant) {
        // Also save to localStorage as backup
        try {
          localStorage.setItem(CUISINES_STORAGE_KEY, JSON.stringify(selected))
          window.dispatchEvent(new Event("cuisinesUpdated"))
        } catch (e) {
          console.error("Error saving cuisines to localStorage:", e)
        }
        navigate(-1)
      } else {
        throw new Error("Invalid response from server")
      }
    } catch (error) {
      console.error("Error updating cuisines:", error)
    }
  }

  const filtered = ALL_CUISINES.filter((name) =>
    name.toLowerCase().includes(search.toLowerCase())
  )

  const recommendedSet = new Set(DEFAULT_SELECTED)

  return (
    <div className="min-h-screen bg-white overflow-x-hidden pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-50 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-6 h-6 text-[#B80B3D]" />
        </button>
        <div className="flex flex-col">
          <h1 className="text-lg font-bold text-gray-900">Edit restaurant cuisines</h1>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cuisines"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-300 text-sm focus-visible:border-black focus-visible:outline-none"
          />
        </div>

        {/* Recommended block */}
        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-gray-900">Recommended</p>
            <span className="text-[11px] font-semibold text-white bg-green-600 px-2 py-0.5 rounded">
              PRE APPROVED
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-2">
            These cuisines will be updated instantly
          </p>

          {filtered
            .filter((name) => recommendedSet.has(name))
            .map((name) => {
              const isSelected = selected.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleToggle(name)}
                  className="w-full flex items-center justify-between py-2 text-left"
                >
                  <span className="text-sm text-gray-900">{name}</span>
                  <span
                    className={`w-5 h-5 border border-[#B80B3D] rounded-sm flex items-center justify-center ${
                      isSelected ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D]" : "bg-white"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                </button>
              )
            })}
        </div>

        {/* Other cuisines */}
        <div className="rounded-xl border border-gray-200">
          {filtered
            .filter((name) => !recommendedSet.has(name))
            .map((name, idx, arr) => {
              const isSelected = selected.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleToggle(name)}
                  className={`w-full flex items-center justify-between py-2 px-4 text-left ${
                    idx < arr.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <span className="text-sm text-gray-900">{name}</span>
                  <span
                    className={`w-5 h-5 border border-black rounded-sm flex items-center justify-center ${
                      isSelected ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D]" : "bg-white"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                </button>
              )
            })}
        </div>
      </div>

      {/* Error bubble */}
      {error && (
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 bg-white rounded-full shadow-lg px-4 py-2 text-xs text-gray-900 border border-gray-200">
          {error}
        </div>
      )}

      {/* Update button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4">
        <button
          type="button"
          onClick={handleUpdate}
          disabled={selected.length === 0}
          className={`w-full h-12 rounded-xl text-base font-bold shadow-lg transition-all active:scale-[0.98] ${
            selected.length === 0
              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
              : "bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white shadow-[#B80B3D]/20"
          }`}
        >
          Update Cuisines
        </button>
      </div>
    </div>
  )
}







