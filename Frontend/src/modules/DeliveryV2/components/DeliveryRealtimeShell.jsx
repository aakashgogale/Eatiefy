import React, { createContext, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { useDeliveryNotifications } from '@food/hooks/useDeliveryNotifications';
import { useRiderLocationSync } from '@/modules/DeliveryV2/hooks/useRiderLocationSync';

const DeliveryNotificationsContext = createContext(null);

export function useDeliveryNotificationsContext() {
  const ctx = useContext(DeliveryNotificationsContext);
  if (!ctx) {
    throw new Error('useDeliveryNotificationsContext must be used within DeliveryRealtimeShell');
  }
  return ctx;
}

/**
 * Keeps delivery socket + order queue alive across Feed / Orders / Pocket routes.
 */
export default function DeliveryRealtimeShell() {
  const notifications = useDeliveryNotifications();
  // Single GPS source for every delivery screen; publishes live location for active orders.
  useRiderLocationSync({
    emitLocation: notifications.emitLocation,
    isSocketConnected: notifications.isConnected,
  });

  return (
    <DeliveryNotificationsContext.Provider value={notifications}>
      <Outlet />
    </DeliveryNotificationsContext.Provider>
  );
}
