import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, LayoutGrid, Package, User as UserIcon, Wallet } from 'lucide-react';
import { useDeliveryStore, dedupeOrdersByIdentity } from '@/modules/DeliveryV2/store/useDeliveryStore';

export default function DeliveryBottomNav({ currentTab = 'feed' }) {
  const navigate = useNavigate();
  const newOrders = useDeliveryStore((state) => state.newOrders);
  const newOrdersCount = useMemo(() => dedupeOrdersByIdentity(newOrders).length, [newOrders]);

  const tabClass = (tab) =>
    `flex flex-col items-center gap-1 transition-all relative ${
      currentTab === tab ? 'text-gray-950 scale-110' : 'text-gray-400 opacity-70'
    }`;

  return (
    <div className="bg-white border-t border-gray-100 px-4 py-3 pb-6 flex justify-between items-center z-[200] shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
      <button onClick={() => navigate('/food/delivery/feed')} className={tabClass('feed')}>
        <LayoutGrid className="w-6 h-6" />
        <span className="text-[11px] font-medium font-sans">Feed</span>
      </button>
      <button onClick={() => navigate('/food/delivery/orders')} className={tabClass('orders')}>
        <Package className="w-6 h-6" />
        <span className="text-[11px] font-medium font-sans">Orders</span>
        {newOrdersCount > 0 && (
          <span className="absolute -top-1 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 flex items-center justify-center text-[9px] font-black text-white border-2 border-white">
            {newOrdersCount > 9 ? '9+' : newOrdersCount}
          </span>
        )}
      </button>
      <button onClick={() => navigate('/food/delivery/pocket')} className={tabClass('pocket')}>
        <Wallet className="w-6 h-6" />
        <span className="text-[11px] font-medium font-sans">Pocket</span>
      </button>
      <button onClick={() => navigate('/food/delivery/history')} className={tabClass('history')}>
        <History className="w-6 h-6" />
        <span className="text-[11px] font-medium font-sans">Trip History</span>
      </button>
      <button onClick={() => navigate('/food/delivery/profile')} className={tabClass('profile')}>
        <UserIcon className="w-6 h-6" />
        <span className="text-[11px] font-medium font-sans">Profile</span>
      </button>
    </div>
  );
}
