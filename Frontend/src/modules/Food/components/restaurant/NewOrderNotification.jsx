import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, ShoppingBag, MapPin, Clock, IndianRupee, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * New Order Notification Component
 * Displays a notification popup when a new order is received
 */
export default function NewOrderNotification({ order, onClose, onViewOrder }) {
  const navigate = useNavigate();
  const [showAllItems, setShowAllItems] = useState(false);
  const VISIBLE_LIMIT = 4;

  if (!order) return null;

  const handleViewOrder = () => {
    if (onViewOrder) {
      onViewOrder(order);
    } else {
      navigate(`/restaurant/orders/${order.orderMongoId || order.orderId}`);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -50 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed top-4 left-4 right-4 z-50 max-w-md mx-auto"
      >
        <div className="bg-white rounded-2xl shadow-2xl border-2 border-green-500 overflow-hidden">
          {/* Header with bell icon */}
          <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <Bell className="w-6 h-6 text-white animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-bold text-lg">New Order!</h3>
                  {order.orderType === "takeaway" ? (
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      Takeaway
                    </span>
                  ) : order.orderType === "dining" ? (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      Dining
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      Delivery
                    </span>
                  )}
                </div>
                <p className="text-white/90 text-sm">Order #{order.orderId}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Order Details */}
          <div className="p-6">
            <div className="space-y-4">
              {/* Total Amount */}
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl">
                <div className="flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-green-600" />
                  <span className="text-gray-600 font-medium">Total Amount</span>
                </div>
                <span className="text-2xl font-bold text-green-600">
                  ₹{order.total?.toFixed(2) || '0.00'}
                </span>
              </div>

              {/* Items */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Order Items ({order.items?.length || 0})</h4>
                <div className="space-y-2.5">
                  {(showAllItems ? order.items : order.items?.slice(0, VISIBLE_LIMIT))?.map((item, index) => {
                    const isVeg = item.isVeg !== false && item.veg !== false && !String(item.type || '').toLowerCase().includes('non');
                    const variantText = 
                      (typeof item.variantName === 'string' && item.variantName.trim()) ||
                      (typeof item.variant === 'string' && item.variant.trim()) ||
                      (typeof item.variant === 'object' && item.variant?.name) ||
                      (typeof item.selectedVariant === 'string' && item.selectedVariant.trim()) ||
                      (typeof item.selectedVariant === 'object' && item.selectedVariant?.name) ||
                      (typeof item.variant_name === 'string' && item.variant_name.trim()) ||
                      (typeof item.variation === 'string' && item.variation.trim()) ||
                      (typeof item.variation === 'object' && item.variation?.name) ||
                      (typeof item.size === 'string' && item.size.trim()) ||
                      (typeof item.portion === 'string' && item.portion.trim()) ||
                      (typeof item.option === 'string' && item.option.trim()) ||
                      (typeof item.choice === 'string' && item.choice.trim()) ||
                      '';
                    const itemAddons = Array.isArray(item.addons) ? item.addons : Array.isArray(item.selectedAddons) ? item.selectedAddons : [];

                    return (
                      <div
                        key={index}
                        className="flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50/90 via-white to-slate-50/70 p-3 sm:p-3.5 rounded-xl border border-slate-200/90 shadow-xs"
                      >
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <div className={`w-4 sm:w-5 h-4 sm:h-5 border-2 shrink-0 rounded-[4px] flex items-center justify-center p-[2px] mt-0.5 ${isVeg ? "border-emerald-600 bg-emerald-50/80" : "border-rose-600 bg-rose-50/80"}`}>
                            <div className={`w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full ${isVeg ? "bg-emerald-600" : "bg-rose-600"}`} />
                          </div>
                          <span className="shrink-0 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-gray-900 text-amber-400 font-black text-xs sm:text-sm tracking-wider shadow-xs border border-gray-800">
                            {item.quantity}×
                          </span>
                          {item.image && (
                            <div className="w-8 sm:w-9 h-8 sm:h-9 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0 mt-0.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            </div>
                          )}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm sm:text-base font-extrabold text-gray-950 leading-snug">
                              {item.name}
                            </span>
                            {variantText && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-rose-900 bg-rose-100 border-2 border-rose-300 px-2.5 py-0.5 rounded-lg shadow-xs">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                                  {variantText}
                                </span>
                              </div>
                            )}
                            {itemAddons.length > 0 && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {itemAddons.map((addon, aIdx) => (
                                  <span key={aIdx} className="inline-flex items-center text-xs font-bold text-slate-800 bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded-md">
                                    + {typeof addon === 'string' ? addon : addon.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-sm sm:text-base font-black text-gray-900 shrink-0 ml-2 bg-gray-100/90 border border-gray-200 px-2.5 py-1 rounded-lg">
                          ₹{(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}

                  {/* Expand / Collapse button */}
                  {order.items?.length > VISIBLE_LIMIT && (
                    <button
                      onClick={() => setShowAllItems(prev => !prev)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors text-xs font-semibold"
                    >
                      {showAllItems ? (
                        <><ChevronUp className="w-4 h-4" /> Show less</>
                      ) : (
                        <><ChevronDown className="w-4 h-4" /> +{order.items.length - VISIBLE_LIMIT} more items</>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Takeaway / Delivery Address */}
              {order.orderType === "takeaway" ? (
                <div className="flex items-start gap-2.5 p-3 bg-orange-50 rounded-lg border border-orange-100">
                  <ShoppingBag className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-orange-700 font-semibold mb-0.5">Order Type</p>
                    <p className="text-sm text-orange-950 font-bold">
                      Takeaway — Customer will pick up from restaurant.
                    </p>
                  </div>
                </div>
              ) : order.orderType === "dining" ? (
                <div className="flex items-start gap-2.5 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <ShoppingBag className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-blue-700 font-semibold mb-0.5">Order Type</p>
                    <p className="text-sm text-blue-950 font-bold">
                      Dining — In-restaurant table service.
                    </p>
                  </div>
                </div>
              ) : (
                order.customerAddress && (
                  <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                    <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 mb-1">Delivery Address</p>
                      <p className="text-sm text-gray-800">
                        {order.customerAddress.street || order.customerAddress.label || 'Address'}
                        {order.customerAddress.city && `, ${order.customerAddress.city}`}
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Estimated Time */}
              {order.estimatedDeliveryTime && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>Est. delivery: {order.estimatedDeliveryTime} mins</span>
                </div>
              )}

              {/* Note */}
              {order.note && (
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <p className="text-xs text-yellow-800 font-medium mb-1">Note:</p>
                  <p className="text-sm text-yellow-900">{order.note}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={handleViewOrder}
                className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingBag className="w-5 h-5" />
                View Order
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}








