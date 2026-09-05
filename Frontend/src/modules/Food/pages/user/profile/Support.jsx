import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Textarea } from "@food/components/ui/textarea"
import { Card, CardContent } from "@food/components/ui/card"
import { orderAPI, restaurantAPI, supportAPI, authAPI } from "@food/api"
import { toast } from "sonner"
import { ArrowLeft, Building2, HelpCircle, ShoppingBag, ChevronRight } from "lucide-react"

export default function Support() {
  const [step, setStep] = useState(() => sessionStorage.getItem("support_step") || "pick")
  const [type, setType] = useState(() => sessionStorage.getItem("support_type") || "")
  const [orders, setOrders] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [selectedOrder, setSelectedOrder] = useState(() => {
    const saved = sessionStorage.getItem("support_selectedOrder");
    return saved ? JSON.parse(saved) : null;
  })
  const [selectedRestaurant, setSelectedRestaurant] = useState(() => {
    const saved = sessionStorage.getItem("support_selectedRestaurant");
    return saved ? JSON.parse(saved) : null;
  })
  const [issueType, setIssueType] = useState(() => sessionStorage.getItem("support_issueType") || "")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tickets, setTickets] = useState([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingRestaurants, setLoadingRestaurants] = useState(false)
  const [orderSearch, setOrderSearch] = useState("")
  const [restaurantSearch, setRestaurantSearch] = useState("")
  const [orderSearchFocused, setOrderSearchFocused] = useState(false)
  const [restaurantSearchFocused, setRestaurantSearchFocused] = useState(false)

  useEffect(() => {
    sessionStorage.setItem("support_step", step)
    sessionStorage.setItem("support_type", type)
    sessionStorage.setItem("support_issueType", issueType)
    if (selectedOrder) sessionStorage.setItem("support_selectedOrder", JSON.stringify(selectedOrder))
    else sessionStorage.removeItem("support_selectedOrder")
    if (selectedRestaurant) sessionStorage.setItem("support_selectedRestaurant", JSON.stringify(selectedRestaurant))
    else sessionStorage.removeItem("support_selectedRestaurant")
  }, [step, type, issueType, selectedOrder, selectedRestaurant])

  useEffect(() => {
    setLoadingTickets(true)
    authAPI
      .getCurrentUser()
      .catch(() => null)
      .finally(async () => {
        try {
          const res = await supportAPI.getMyTickets()
          const list = res?.data?.data?.tickets || res?.data?.tickets || []
          setTickets(list)
        } catch (_) {}
        setLoadingTickets(false)
      })

    // If we restored state and need orders/restaurants loaded for current step
    if (step === "choose_order" || step === "order_issue") fetchOrders()
    if (step === "choose_restaurant" || step === "restaurant_issue") fetchRestaurants()
  }, [])

  const orderIssues = ["Item missing", "Wrong item", "Not delivered", "Payment issue"]
  const restaurantIssues = ["Bad service", "Wrong info", "Other"]

  const fetchOrders = async () => {
    setLoadingOrders(true)
    try {
      const res = await orderAPI.getOrders({ limit: 10, page: 1 })
      const list = res?.data?.data?.orders || res?.data?.orders || []
      setOrders(list)
    } catch {
      toast.error("Failed to load orders")
    } finally {
      setLoadingOrders(false)
    }
  }

  const fetchRestaurants = async () => {
    setLoadingRestaurants(true)
    try {
      const res = await restaurantAPI.getRestaurants({ limit: 20, page: 1 })
      const list = res?.data?.data?.restaurants || res?.data?.restaurants || []
      setRestaurants(list)
    } catch {
      toast.error("Failed to load restaurants")
    } finally {
      setLoadingRestaurants(false)
    }
  }

  const handlePick = (t) => {
    setType(t)
    setOrderSearch("")
    setRestaurantSearch("")
    if (t === "order") {
      fetchOrders()
      setStep("choose_order")
    } else if (t === "restaurant") {
      fetchRestaurants()
      setStep("choose_restaurant")
    } else {
      setStep("other_form")
    }
  }

  const submitTicket = async (payload) => {
    setSubmitting(true)
    try {
      const res = await supportAPI.createTicket(payload)
      const data = res?.data
      if (!data?.success) throw new Error(data?.message || "Failed")
      toast.success("Ticket created")
      setTickets((prev) => [data?.data?.ticket, ...prev])
      setStep("pick")
      setType("")
      setSelectedOrder(null)
      setSelectedRestaurant(null)
      setIssueType("")
      setSubject("")
      setDescription("")
    } catch (e) {
      const message =
        e?.response?.data?.message ||
        e?.message ||
        "Failed to create ticket"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const statusClasses = (status) => {
    const s = String(status || "").toLowerCase()
    if (s === "resolved" || s === "closed") return "bg-green-100 text-green-700"
    if (s === "open") return "bg-amber-100 text-amber-700"
    return "bg-slate-100 text-slate-700"
  }

  const getOrderLabel = (order) => {
    const restaurantName = order?.restaurantName || order?.restaurantId?.restaurantName || order?.restaurant?.restaurantName || "Restaurant"
    const dateValue = order?.createdAt || order?.date
    const dateLabel = dateValue ? new Date(dateValue).toLocaleDateString() : "No date"
    const amount = order?.pricing?.total ?? order?.total ?? 0
    return `${restaurantName} • ${dateLabel} • ₹${amount}`
  }

  const getRestaurantLabel = (restaurant) => {
    const name = restaurant?.restaurantName || restaurant?.name || "Restaurant"
    const location = restaurant?.city || restaurant?.area || ""
    return `${name}${location ? ` • ${location}` : ""}`
  }

  const filteredOrders = orders.filter((order) => {
    const q = orderSearch.trim().toLowerCase()
    if (!q) return true
    const restaurantName = (order?.restaurantName || order?.restaurant?.restaurantName || "").toLowerCase()
    const orderId = String(order?._id || order?.id || "").toLowerCase()
    return restaurantName.includes(q) || orderId.includes(q)
  })

  const filteredRestaurants = restaurants.filter((restaurant) => {
    const q = restaurantSearch.trim().toLowerCase()
    if (!q) return true
    const name = String(restaurant?.restaurantName || restaurant?.name || "").toLowerCase()
    const city = String(restaurant?.city || restaurant?.area || "").toLowerCase()
    const id = String(restaurant?._id || restaurant?.id || "").toLowerCase()
    return name.includes(q) || city.includes(q) || id.includes(q)
  })

  const handleOrderSearchChange = (value) => {
    setOrderSearch(value)
  }

  const handleRestaurantSearchChange = (value) => {
    setRestaurantSearch(value)
  }

  const navigate = useNavigate()

  const handleTopBack = (e) => {
    if (step === "pick") {
      e.preventDefault();
      navigate(-1);
      return;
    }
    e.preventDefault();
    if (step === "order_issue") setStep("choose_order");
    else if (step === "restaurant_issue") setStep("choose_restaurant");
    else setStep("pick");
  }

  const TicketList = () => (
    <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">My Tickets</h3>
          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {tickets.length}
          </span>
        </div>

        {loadingTickets ? (
          <p className="text-sm text-slate-500">Loading tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-slate-500">No tickets yet</p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <div key={t._id || t.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-[#171717]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      #{String(t._id || t.id).slice(-6)} • {t.type} • {t.issueType}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${statusClasses(t.status)}`}>
                    {t.status}
                  </span>
                </div>
                {t.adminResponse ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">Reply: {t.adminResponse}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a]">
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 pb-20">
        {/* Header */}
        <div className="flex items-center mb-6 md:mb-8">
          <div
            onClick={handleTopBack}
            className="h-10 w-10 md:h-11 md:w-11 flex items-center justify-center bg-white dark:bg-[#1a1a1a] rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_15px_rgba(0,0,0,0.08)] active:scale-95 transition-all cursor-pointer border border-slate-100 dark:border-gray-800"
          >
            <ArrowLeft className="h-5 w-5 text-slate-800 dark:text-white" />
          </div>
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white ml-4">Help & Support</h1>
        </div>

        <Card className="bg-gradient-to-br from-[#DC2626]/5 to-white dark:from-[#DC2626]/10 dark:to-[#1a1a1a] rounded-2xl shadow-sm border border-[#DC2626]/10 dark:border-gray-800 mb-5 md:mb-6 overflow-hidden">
          <CardContent className="p-5 md:p-6 relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#DC2626]/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
            <div className="relative z-10">
              <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">How can we help you?</h2>
              <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 mt-1.5">Raise a support ticket and track updates seamlessly.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800 mb-3">
          <CardContent className="p-4 space-y-4">
            {step === "pick" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button onClick={() => handlePick("order")} className="group w-full bg-white dark:bg-[#1a1a1a] border border-slate-100 dark:border-gray-800 rounded-2xl p-5 text-left hover:border-[#DC2626]/30 dark:hover:border-[#DC2626]/50 hover:shadow-[0_8px_20px_rgba(220,38,38,0.06)] transition-all">
                  <div className="flex items-center justify-between">
                    <div className="bg-slate-50 dark:bg-gray-800/80 rounded-full p-3 group-hover:bg-[#DC2626]/10 transition-colors">
                      <ShoppingBag className="h-5 w-5 md:h-6 md:w-6 text-slate-700 dark:text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                  </div>
                  <p className="mt-4 text-base md:text-lg font-bold text-slate-900 dark:text-white group-hover:text-[#DC2626] transition-colors">Order Issue</p>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1.5 leading-relaxed">Missing item, wrong item, delivery issue</p>
                </button>

                <button onClick={() => handlePick("restaurant")} className="group w-full bg-white dark:bg-[#1a1a1a] border border-slate-100 dark:border-gray-800 rounded-2xl p-5 text-left hover:border-[#DC2626]/30 dark:hover:border-[#DC2626]/50 hover:shadow-[0_8px_20px_rgba(220,38,38,0.06)] transition-all">
                  <div className="flex items-center justify-between">
                    <div className="bg-slate-50 dark:bg-gray-800/80 rounded-full p-3 group-hover:bg-[#DC2626]/10 transition-colors">
                      <Building2 className="h-5 w-5 md:h-6 md:w-6 text-slate-700 dark:text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                  </div>
                  <p className="mt-4 text-base md:text-lg font-bold text-slate-900 dark:text-white group-hover:text-[#DC2626] transition-colors">Restaurant Issue</p>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1.5 leading-relaxed">Service, listing info, behavior report</p>
                </button>

                <button onClick={() => handlePick("other")} className="group w-full bg-white dark:bg-[#1a1a1a] border border-slate-100 dark:border-gray-800 rounded-2xl p-5 text-left hover:border-[#DC2626]/30 dark:hover:border-[#DC2626]/50 hover:shadow-[0_8px_20px_rgba(220,38,38,0.06)] transition-all">
                  <div className="flex items-center justify-between">
                    <div className="bg-slate-50 dark:bg-gray-800/80 rounded-full p-3 group-hover:bg-[#DC2626]/10 transition-colors">
                      <HelpCircle className="h-5 w-5 md:h-6 md:w-6 text-slate-700 dark:text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-[#DC2626] transition-colors" />
                  </div>
                  <p className="mt-4 text-base md:text-lg font-bold text-slate-900 dark:text-white group-hover:text-[#DC2626] transition-colors">Other Issue</p>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1.5 leading-relaxed">Account, app, payment or general query</p>
                </button>
              </div>
            )}

            {step === "choose_order" && (
              <div className="space-y-4">
                <div className="border-b border-slate-100 dark:border-gray-800 pb-3 mb-4">
                  <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Order Issue</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Select an order below to report your issue</p>
                </div>
                {loadingOrders ? (
                  <p className="text-sm text-slate-500 bg-slate-50 dark:bg-[#111] p-4 rounded-xl text-center border border-slate-100 dark:border-gray-800">Loading orders...</p>
                ) : orders.length > 0 ? (
                  <div className="space-y-2">
                    <Input
                      value={orderSearch}
                      onChange={(e) => handleOrderSearchChange(e.target.value)}
                      onFocus={() => setOrderSearchFocused(true)}
                      onBlur={() => setTimeout(() => setOrderSearchFocused(false), 200)}
                      placeholder="Search order"
                      className="mb-3 h-12 bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
                    />
                    {orderSearchFocused && orderSearch.trim().length > 0 && (
                      <div className="max-h-[250px] overflow-y-auto space-y-1 border border-slate-200 dark:border-gray-800 rounded-lg p-1.5 bg-slate-50 dark:bg-[#111111]">
                      {filteredOrders.map((o) => (
                        <div
                          key={o._id || o.id}
                          onClick={() => {
                            setSelectedOrder(o)
                            setStep("order_issue")
                          }}
                          className="p-3.5 text-sm md:text-base text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#222222] hover:shadow-sm rounded-lg cursor-pointer transition-all border border-transparent hover:border-slate-200 dark:hover:border-gray-700"
                        >
                          {getOrderLabel(o)}
                        </div>
                      ))}
                      {filteredOrders.length === 0 && (
                        <p className="text-sm text-slate-500 p-3 text-center">No matching orders found</p>
                      )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 bg-slate-50 dark:bg-[#111] p-4 rounded-xl text-center border border-slate-100 dark:border-gray-800">No recent orders found</p>
                )}
                <div className="pt-4 mt-2 border-t border-slate-100 dark:border-gray-800">
                  <Button variant="outline" onClick={() => setStep("pick")} className="w-full h-12 rounded-xl font-semibold border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-[#222] text-slate-700 dark:text-slate-300 transition-all">Go Back</Button>
                </div>
              </div>
            )}

            {step === "order_issue" && selectedOrder && (
              <div className="space-y-4">
                <div className="border-b border-slate-100 dark:border-gray-800 pb-3 mb-4">
                  <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Order Issue Details</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">What went wrong with your order?</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {orderIssues.map((it) => (
                    <Button key={it} variant={issueType === it ? "default" : "outline"} onClick={() => setIssueType(it)}>{it}</Button>
                  ))}
                </div>
                <Textarea placeholder="Describe the issue (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[100px] placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl text-base p-4" />
                <div className="flex flex-col sm:flex-row gap-3 mt-4">
                  <Button 
                    onClick={() => submitTicket({ type: "order", orderId: selectedOrder._id || selectedOrder.id, issueType, description })} 
                    disabled={!issueType || submitting}
                    className="flex-1 bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold h-12 rounded-xl shadow-[0_4px_14px_rgba(220,38,38,0.25)] hover:shadow-[0_6px_20px_rgba(220,38,38,0.3)] transition-all"
                  >
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")} className="h-12 rounded-xl font-medium border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-[#222]">Cancel</Button>
                </div>
              </div>
            )}

            {step === "choose_restaurant" && (
              <div className="space-y-4">
                <div className="border-b border-slate-100 dark:border-gray-800 pb-3 mb-4">
                  <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Restaurant Issue</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Select a restaurant below to report your issue</p>
                </div>
                {loadingRestaurants ? (
                  <p className="text-sm text-slate-500 bg-slate-50 dark:bg-[#111] p-4 rounded-xl text-center border border-slate-100 dark:border-gray-800">Loading restaurants...</p>
                ) : restaurants.length > 0 ? (
                  <div className="space-y-2">
                    <Input
                      value={restaurantSearch}
                      onChange={(e) => handleRestaurantSearchChange(e.target.value)}
                      onFocus={() => setRestaurantSearchFocused(true)}
                      onBlur={() => setTimeout(() => setRestaurantSearchFocused(false), 200)}
                      placeholder="Search restaurant"
                      className="mb-3 h-12 bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
                    />
                    {restaurantSearchFocused && restaurantSearch.trim().length > 0 && (
                      <div className="max-h-[250px] overflow-y-auto space-y-1 border border-slate-200 dark:border-gray-800 rounded-lg p-1.5 bg-slate-50 dark:bg-[#111111]">
                      {filteredRestaurants.map((r) => (
                        <div 
                          key={r._id || r.id} 
                          onClick={() => {
                            setSelectedRestaurant(r)
                            setStep("restaurant_issue")
                          }}
                          className="p-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#222222] hover:shadow-sm rounded-md cursor-pointer transition-all border border-transparent hover:border-slate-200 dark:hover:border-gray-700"
                        >
                          {getRestaurantLabel(r)}
                        </div>
                      ))}
                      {filteredRestaurants.length === 0 && (
                        <p className="text-sm text-slate-500 p-3 text-center">No matching restaurants found</p>
                      )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 bg-slate-50 dark:bg-[#111] p-4 rounded-xl text-center border border-slate-100 dark:border-gray-800">No restaurants found</p>
                )}
                <div className="pt-4 mt-2 border-t border-slate-100 dark:border-gray-800">
                  <Button variant="outline" onClick={() => setStep("pick")} className="w-full h-12 rounded-xl font-semibold border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-[#222] text-slate-700 dark:text-slate-300 transition-all">Go Back</Button>
                </div>
              </div>
            )}

            {step === "restaurant_issue" && selectedRestaurant && (
              <div className="space-y-4">
                <div className="border-b border-slate-100 dark:border-gray-800 pb-3 mb-4">
                  <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">Restaurant Issue Details</h2>
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">What went wrong with the restaurant?</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {restaurantIssues.map((it) => (
                    <Button key={it} variant={issueType === it ? "default" : "outline"} onClick={() => setIssueType(it)}>{it}</Button>
                  ))}
                </div>
                <Textarea placeholder="Describe the issue (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[100px] placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl text-base p-4" />
                <div className="flex flex-col sm:flex-row gap-3 mt-4">
                  <Button 
                    onClick={() => submitTicket({ type: "restaurant", restaurantId: selectedRestaurant._id || selectedRestaurant.id, issueType, description })} 
                    disabled={!issueType || submitting}
                    className="flex-1 bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold h-12 rounded-xl shadow-[0_4px_14px_rgba(220,38,38,0.25)] hover:shadow-[0_6px_20px_rgba(220,38,38,0.3)] transition-all"
                  >
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")} className="h-12 rounded-xl font-medium border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-[#222]">Cancel</Button>
                </div>
              </div>
            )}

            {step === "other_form" && (
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">Other Issue Details</h3>
                <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-12 bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white" />
                <Textarea placeholder="Describe your issue" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[120px] bg-slate-50 dark:bg-[#111] border-slate-200 dark:border-gray-800 focus-visible:ring-2 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-800 focus-visible:border-transparent rounded-xl p-4 text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white" />
                <div className="flex flex-col sm:flex-row gap-3 mt-4">
                  <Button 
                    onClick={() => submitTicket({ type: "other", issueType: subject || "Other", description })} 
                    disabled={!subject || submitting}
                    className="flex-1 bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold h-12 rounded-xl shadow-[0_4px_14px_rgba(220,38,38,0.25)] hover:shadow-[0_6px_20px_rgba(220,38,38,0.3)] transition-all"
                  >
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => { setSubject(""); setDescription(""); setStep("pick"); }} className="h-12 rounded-xl font-medium border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-[#222]">Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <TicketList />
      </div>
    </AnimatedPage>
  )
}
