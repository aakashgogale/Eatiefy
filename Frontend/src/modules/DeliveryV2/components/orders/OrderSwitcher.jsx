import React from 'react';
import { resolveOrderKey } from '@/modules/DeliveryV2/store/useDeliveryStore';

export default function OrderSwitcher({ orders = [], focusedOrderId }) {
  if (!Array.isArray(orders) || orders.length <= 1) return null;

  return (
    <div className="px-3 md:px-4 mt-2">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {orders.map((order) => {
          const orderId = resolveOrderKey(order);
          const label = order?.orderId || order?.displayOrderId || orderId;
          const isFocused = focusedOrderId === orderId;
          return (
            <div
              key={orderId}
              className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-wider pointer-events-none select-none ${
                isFocused
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                  : 'bg-white/10 text-white/70 border border-white/15'
              }`}
              aria-current={isFocused ? 'true' : undefined}
            >
              #{label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
