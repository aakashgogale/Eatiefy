import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

/**
 * PrefetchLink
 * Wraps react-router-dom's Link to implement prefetching on hover, conditionally disabled for slow networks.
 */
const PrefetchLink = ({ to, prefetchRoute, children, className, ...props }) => {
  const { isSlowConnection } = useNetworkStatus();
  const hasPrefetched = useRef(false);
  const navigate = useNavigate();

  const handlePrefetch = () => {
    if (isSlowConnection || hasPrefetched.current || !prefetchRoute) return;
    
    // Attempt to prefetch the chunk if a dynamic import function is passed
    try {
      prefetchRoute();
      hasPrefetched.current = true;
    } catch (e) {
      console.error('Prefetch failed:', e);
    }
  };

  return (
    <Link
      to={to}
      className={className}
      onMouseEnter={handlePrefetch}
      onTouchStart={handlePrefetch}
      {...props}
    >
      {children}
    </Link>
  );
};

export default PrefetchLink;
