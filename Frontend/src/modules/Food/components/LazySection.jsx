import React, { useState, useEffect, useRef } from "react";

/**
 * LazySection Component
 * 
 * Progressively renders below-the-fold sections as they approach the viewport.
 * Uses native IntersectionObserver with a generous 300px margin so sections mount
 * seamlessly before the user scrolls to them with zero visible flicker or layout shift.
 */
export const LazySection = React.memo(({
  children,
  minHeight = "160px",
  rootMargin = "300px 0px",
  threshold = 0.01,
  className = "",
  priority = false, // When true, mounts immediately (e.g. above-the-fold or during scroll restoration)
}) => {
  const [isVisible, setIsVisible] = useState(priority);
  const containerRef = useRef(null);

  useEffect(() => {
    if (priority) {
      setIsVisible(true);
      return;
    }

    if (isVisible) return;

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && (entry.isIntersecting || entry.intersectionRatio > 0)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin,
        threshold,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isVisible, priority, rootMargin, threshold]);

  if (isVisible) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight }}
      aria-hidden="true"
    />
  );
});

export default LazySection;
