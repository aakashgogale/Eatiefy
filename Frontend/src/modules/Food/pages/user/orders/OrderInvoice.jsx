import { useParams, Link } from "react-router-dom"
import { Download, ArrowLeft, FileText, Printer, CheckCircle2 } from "lucide-react"
import { useRef, useState, useEffect } from "react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { useOrders } from "@food/context/OrdersContext"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { orderAPI } from "@food/api"
import { resolveMediaUrl } from "@food/utils/common"

export default function OrderInvoice() {
  const companyName = useCompanyName() || "Eatiefy"
  const { orderId } = useParams()
  const { getOrderById } = useOrders()
  const [order, setOrder] = useState(() => getOrderById?.(orderId) || null)
  const [loading, setLoading] = useState(!order)
  const [error, setError] = useState(null)
  const invoiceRef = useRef(null)

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        setLoading(true)
        const response = await orderAPI.getOrderDetails(orderId)
        if (response?.data?.success && response.data.data?.order) {
          setOrder(response.data.data.order)
        } else if (response?.data?.order) {
          setOrder(response.data.order)
        } else {
          setError("Order not found")
        }
      } catch (err) {
        console.error("Failed to fetch invoice order details:", err)
        setError("Failed to load invoice details")
      } finally {
        setLoading(false)
      }
    }

    if (!order) {
      fetchOrder()
    }
  }, [orderId, order])

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-4 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center py-20">
          <div className="w-9 h-9 border-3 border-[#EB590E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Generating invoice...</p>
        </div>
      </AnimatedPage>
    )
  }

  if (error || !order) {
    return (
      <AnimatedPage className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-4 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center py-20">
          <h1 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">{error || 'Order Not Found'}</h1>
          <p className="text-xs text-slate-500 mb-6">We could not locate the details for this invoice.</p>
          <Link to="/food/user/orders">
            <Button className="bg-[#EB590E] hover:bg-[#d44d08] text-white font-bold rounded-xl px-6">
              Back to Orders
            </Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  const orderNumber = (order?.orderId || order?._id || order?.id || orderId || "").toString().toUpperCase().replace(/^#/, "")
  const orderItems = Array.isArray(order?.items)
    ? order.items
    : Array.isArray(order?.orderItems)
    ? order.orderItems
    : Array.isArray(order?.foodItems)
    ? order.foodItems
    : []

  const pricing = order?.pricing || {}
  const subtotal = Number(pricing.subtotal || pricing.itemsPrice || order.subtotal || 0)
  const deliveryFee = Number(pricing.deliveryFee || order.deliveryFee || 0)
  const tax = Number(pricing.tax || pricing.gst || order.tax || 0)
  const discount = Number(pricing.discount || order.discount || 0)
  const total = Number(pricing.total || order.totalAmount || order.total || (subtotal + deliveryFee + tax - discount))

  const restaurantName =
    order?.restaurantName ||
    order?.restaurantId?.restaurantName ||
    order?.restaurantId?.name ||
    order?.restaurant?.name ||
    "Eatiefy Partner Restaurant"

  const deliveryAddress =
    order?.deliveryAddress?.formattedAddress ||
    order?.address?.formattedAddress ||
    order?.address?.street ||
    order?.addressLine1 ||
    "Delivered to Customer Location"

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString || Date.now())
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return "Delivered"
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPDF = () => {
    window.print()
  }

  return (
    <AnimatedPage className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-gray-900 dark:text-white p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <ScrollReveal>
          <div className="flex items-center justify-between gap-3 sm:gap-4 mb-2 no-print">
            <div className="flex items-center gap-3">
              <Link to={`/food/user/orders/${orderId}/track`}>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Tax Invoice</h1>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Order #{orderNumber.slice(-6)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handlePrint}
                className="flex items-center gap-1.5 text-xs sm:text-sm h-9 bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 rounded-xl"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Print</span>
              </Button>
              <Button
                onClick={handleDownloadPDF}
                className="bg-[#EB590E] hover:bg-[#D94F0C] flex items-center gap-1.5 text-xs sm:text-sm h-9 rounded-xl shadow-md text-white font-bold"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </Button>
            </div>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.05}>
          <Card ref={invoiceRef} className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl shadow-sm overflow-hidden print:shadow-none print:border-none">
            <CardContent className="p-5 sm:p-8 md:p-10">
              {/* Invoice Top Header */}
              <div className="pb-6 border-b border-gray-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-7 w-7 text-[#EB590E]" />
                    <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">TAX INVOICE</h2>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-[#EB590E]">{companyName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Online Food Ordering & Delivery</p>
                </div>
                <div className="sm:text-right">
                  <Badge className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1 text-xs font-bold uppercase rounded-full">
                    {order?.status || 'DELIVERED'}
                  </Badge>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Invoice ID: <span className="font-bold text-gray-900 dark:text-white">INV-{orderNumber.slice(-8)}</span>
                  </p>
                </div>
              </div>

              {/* Order Info & Billed To Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-gray-100 dark:border-zinc-800 text-xs sm:text-sm">
                <div>
                  <h3 className="font-bold text-gray-400 dark:text-gray-500 uppercase text-[10px] tracking-wider mb-2">Billed From</h3>
                  <p className="font-bold text-gray-900 dark:text-white text-base">{restaurantName}</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{order?.restaurantAddress || 'Authorized Merchant Partner'}</p>
                </div>
                <div className="sm:text-right">
                  <h3 className="font-bold text-gray-400 dark:text-gray-500 uppercase text-[10px] tracking-wider mb-2">Delivered & Billed To</h3>
                  <p className="font-bold text-gray-900 dark:text-white">{order?.customerName || order?.userId?.name || 'Customer'}</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 leading-relaxed max-w-sm sm:ml-auto">
                    {deliveryAddress}
                  </p>
                  <p className="text-xs text-gray-500 mt-1.5">
                    <strong>Date:</strong> {formatDate(order?.createdAt || order?.deliveredAt)}
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div className="py-6 border-b border-gray-100 dark:border-zinc-800">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-3">Order Items</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-zinc-800 text-gray-500 dark:text-gray-400">
                        <th className="py-2.5 text-left font-semibold">Item</th>
                        <th className="py-2.5 text-center font-semibold">Qty</th>
                        <th className="py-2.5 text-right font-semibold">Price</th>
                        <th className="py-2.5 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
                      {orderItems.map((item, idx) => {
                        const itemPrice = Number(item?.price || 0)
                        const itemQty = Number(item?.quantity || 1)
                        const itemTotal = itemPrice * itemQty
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/30">
                            <td className="py-3 text-left">
                              <div className="flex items-center gap-2.5">
                                <span className="font-semibold text-gray-900 dark:text-white">{item?.name || "Dish Item"}</span>
                                {item?.variantName && (
                                  <span className="text-[10px] bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded">
                                    {item.variantName}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 text-center text-gray-600 dark:text-gray-400">{itemQty}</td>
                            <td className="py-3 text-right text-gray-600 dark:text-gray-400">₹{itemPrice.toFixed(0)}</td>
                            <td className="py-3 text-right font-bold text-gray-900 dark:text-white">₹{itemTotal.toFixed(0)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total Calculation Breakdown */}
              <div className="pt-6">
                <div className="max-w-xs ml-auto space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Item Subtotal:</span>
                    <span className="font-medium text-gray-900 dark:text-white">₹{subtotal.toFixed(0)}</span>
                  </div>
                  {deliveryFee > 0 && (
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>Delivery Partner Fee:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{deliveryFee.toFixed(0)}</span>
                    </div>
                  )}
                  {tax > 0 && (
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>Taxes & GST:</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{tax.toFixed(0)}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Coupon Discount:</span>
                      <span>-₹{discount.toFixed(0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base sm:text-lg font-black pt-3 border-t-2 border-[#EB590E] text-gray-900 dark:text-white">
                    <span>Total Amount:</span>
                    <span className="text-[#EB590E]">₹{total.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400 pt-1">
                    <span>Payment Mode:</span>
                    <span className="uppercase font-semibold text-gray-600 dark:text-gray-300">{order?.paymentMethod || 'ONLINE'}</span>
                  </div>
                </div>
              </div>

              {/* Footer Note */}
              <div className="mt-8 pt-6 border-t border-gray-100 dark:border-zinc-800 text-center text-xs text-gray-400 space-y-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300">Thank you for dining with {companyName}!</p>
                <p>This is a computer-generated tax invoice and does not require a physical signature.</p>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Bottom Navigation */}
        <div className="flex gap-3 no-print pt-2">
          <Link to={`/food/user/orders/${orderId}/track`} className="flex-1">
            <Button variant="outline" className="w-full h-11 rounded-2xl border-gray-200 dark:border-zinc-800 text-gray-800 dark:text-white font-bold">
              Track Order
            </Button>
          </Link>
          <Link to="/food/user/orders" className="flex-1">
            <Button className="w-full h-11 rounded-2xl bg-[#EB590E] hover:bg-[#d44d08] text-white font-bold">
              All Orders
            </Button>
          </Link>
        </div>
      </div>
    </AnimatedPage>
  )
}
