import React, { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { ArrowLeft, RotateCcw, ShoppingBag, Utensils, ChevronRight, Loader2 } from "lucide-react"
import { orderAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { toast } from "sonner"

export default function Reorder() {
  const navigate = useNavigate()
  const { replaceCart } = useCart()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const fetchUserOrders = async () => {
      try {
        setLoading(true)
        let fetchedOrders = []

        // Try API first if user is logged in
        try {
          const response = await orderAPI.getOrders({ limit: 50, page: 1 })
          if (response?.data?.success && response?.data?.data?.orders) {
            fetchedOrders = response.data.data.orders
          } else if (response?.data?.orders) {
            fetchedOrders = response.data.orders
          } else if (Array.isArray(response?.data?.data)) {
            fetchedOrders = response.data.data
          }
        } catch (apiErr) {
          console.warn("API orders fetch failed or user not logged in:", apiErr)
        }

        // Fallback or merge with localStorage userOrders
        let localOrders = []
        try {
          const saved = localStorage.getItem("userOrders")
          if (saved) {
            localOrders = JSON.parse(saved)
          }
        } catch {
          // ignore error
        }

        // Combine and deduplicate
        const orderMap = new Map()
        localOrders.forEach((o) => {
          const id = o.id || o._id || o.orderId
          if (id) orderMap.set(id, o)
        })
        fetchedOrders.forEach((o) => {
          const id = o.orderId || o._id || o.id
          if (id) orderMap.set(id, o)
        })

        const allOrders = Array.from(orderMap.values()).sort(
          (a, b) => new Date(b.createdAt || Date.now()) - new Date(a.createdAt || Date.now())
        )

        if (isMounted) {
          setOrders(allOrders)
        }
      } catch (error) {
        console.error("Error loading orders for reorder page:", error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchUserOrders()

    return () => {
      isMounted = false
    }
  }, [])

  const handleReorder = (order) => {
    const items = order.items || []
    if (!items.length) {
      toast.info("No items found in this order to reorder.")
      return
    }

    const restaurantId =
      order.restaurantId?._id ||
      order.restaurantId ||
      order.restaurantSlug ||
      "restaurant"

    const reorderItems = items
      .map((item, index) => {
        const itemId = item.id || item.itemId || item._id
        return {
          id: itemId || `item-${index}`,
          name: item.name || item.foodName || "Item",
          price: Number(item.price || item.unitPrice || 0),
          image: item.image || "",
          restaurant: order.restaurantId?.restaurantName || order.restaurantName || order.restaurant || "Restaurant",
          restaurantId: restaurantId,
          isVeg: item.isVeg !== false,
          quantity: Math.max(1, Number(item.quantity) || 1),
        }
      })
      .filter((item) => item.price > 0 || item.name)

    if (!reorderItems.length) {
      toast.error("No valid items to reorder.")
      return
    }

    replaceCart(reorderItems)
    toast.success("Items added to cart!")

    const targetRoute = typeof restaurantId === "string" && restaurantId !== "restaurant"
      ? `/food/user/restaurants/${restaurantId}`
      : `/food/user/cart`

    navigate(targetRoute)
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#0a0a0a] pb-28 transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800 px-4 py-3.5 flex items-center justify-between shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-1 rounded-full text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base sm:text-lg font-bold tracking-wider text-gray-900 dark:text-white uppercase">
          REORDER
        </h1>
        <div className="w-8" />
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-[#E2AD4B]" />
            <p className="text-sm font-medium">Loading your orders...</p>
          </div>
        ) : orders.length === 0 ? (
          /* Empty State - Matching reference image theme */
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="relative mb-6 flex items-center justify-center">
              <div className="w-48 h-48 sm:w-56 sm:h-56 relative flex items-center justify-center">
                <img
                  src="/assets/empty_reorder_plate.png"
                  alt="Empty Food Orders"
                  className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal opacity-90"
                />
              </div>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-2">
              Uh Oh! You don’t have any food orders
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-xs">
              Order now to avail great discounts!
            </p>

            <Link
              to="/food/user"
              className="inline-flex items-center justify-center px-8 py-3 rounded-xl bg-[#E2AD4B] hover:bg-[#d69f3d] text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all transform active:scale-95"
            >
              Order Now
            </Link>
          </div>
        ) : (
          /* Previous Orders List */
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Past Orders
              </h2>
              <span className="text-xs text-gray-400 font-medium">
                {orders.length} {orders.length === 1 ? "Order" : "Orders"}
              </span>
            </div>

            {orders.map((order, idx) => {
              const restaurantName =
                order.restaurantId?.restaurantName ||
                order.restaurantName ||
                order.restaurant ||
                "Eatiefy Restaurant"

              const orderDate = order.createdAt
                ? new Date(order.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Recent Order"

              const items = order.items || []
              const totalPrice = order.pricing?.total || order.total || 0

              return (
                <div
                  key={order.id || order._id || idx}
                  className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-all"
                >
                  {/* Restaurant & Date Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-950/40 text-[#E2AD4B] flex items-center justify-center font-bold text-base">
                        <Utensils className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-base">
                          {restaurantName}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {orderDate}
                        </p>
                      </div>
                    </div>

                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Delivered
                    </span>
                  </div>

                  {/* Item List */}
                  <div className="py-3 space-y-2">
                    {items.map((item, itemIdx) => (
                      <div
                        key={itemIdx}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                          {/* Veg/Non-Veg icon indicator */}
                          <span
                            className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center p-0.5 ${
                              item.isVeg !== false
                                ? "border-emerald-600"
                                : "border-red-600"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                item.isVeg !== false
                                  ? "bg-emerald-600"
                                  : "bg-red-600"
                              }`}
                            />
                          </span>
                          <span className="font-medium text-xs sm:text-sm">
                            {item.quantity || 1} x {item.name || item.foodName || "Item"}
                          </span>
                        </div>
                        {item.price > 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            ₹{Number(item.price) * (item.quantity || 1)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Total & Action Footer */}
                  <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-gray-400 font-medium block">
                        Total Amount
                      </span>
                      <span className="font-bold text-gray-900 dark:text-white text-base">
                        ₹{totalPrice}
                      </span>
                    </div>

                    <button
                      onClick={() => handleReorder(order)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E2AD4B] hover:bg-[#d69f3d] text-white font-semibold text-sm shadow-sm hover:shadow transition-all active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reorder
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
