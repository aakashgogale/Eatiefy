import React, { useState, useEffect, useRef } from 'react';

/**
 * Parses Cloudinary URL and returns clean valid source
 */
const getOptimizedUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  return url;
};

const CloudinaryImage = ({
  src,
  alt = '',
  className = '',
  widths = [200, 400, 800, 1200],
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  if (!src) {
    return <div className={`bg-gray-200 animate-pulse ${className}`} {...props} />;
  }

  const isCloudinary = typeof src === 'string' && src.includes('cloudinary.com');

  if (!isCloudinary) {
    return (
      <img
        ref={imgRef}
        src={inView ? src : undefined}
        alt={alt}
        className={className}
        loading="lazy"
        {...props}
      />
    );
  }

  const lqip = getOptimizedUrl(src, null, true);
  const srcset = widths.map((w) => `${getOptimizedUrl(src, w)} ${w}w`).join(', ');
  const defaultSrc = getOptimizedUrl(src, widths[1] || 400);

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ display: 'inline-block' }}>
      {/* LQIP Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500 ease-in-out"
        style={{
          backgroundImage: `url(${lqip})`,
          opacity: isLoaded ? 0 : 1,
          filter: 'blur(10px)',
          transform: 'scale(1.1)', // Prevent white edges during blur
        }}
      />
      {/* Actual Image */}
      <img
        ref={imgRef}
        src={inView ? defaultSrc : undefined}
        srcSet={inView ? srcset : undefined}
        sizes="(max-width: 600px) 200px, (max-width: 900px) 400px, 800px"
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        {...props}
      />
    </div>
  );
};

export default CloudinaryImage;
