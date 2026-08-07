import { useState, useEffect } from 'react';

export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    saveData: false,
    effectiveType: '4g', // 'slow-2g', '2g', '3g', or '4g'
  });

  useEffect(() => {
    if (typeof navigator === 'undefined') return;

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    const updateStatus = () => {
      setNetworkStatus({
        online: navigator.onLine,
        saveData: connection?.saveData === true,
        effectiveType: connection?.effectiveType || '4g',
      });
    };

    updateStatus();

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    if (connection) {
      connection.addEventListener('change', updateStatus);
    }

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      if (connection) {
        connection.removeEventListener('change', updateStatus);
      }
    };
  }, []);

  const isSlowConnection = networkStatus.saveData || ['slow-2g', '2g', '3g'].includes(networkStatus.effectiveType);

  return { ...networkStatus, isSlowConnection };
}
