import React, { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import dishFallbackImage from '@food/assets/dish_fallback.webp'
import { imageRetryUrl, resolveImageSrc } from '@/shared/utils/mediaUrl'

/*
 * Only these hosts resize on ?w=&q=. Our own /uploads files (nginx static) and
 * most CDNs ignore the parameters, so a 5-width srcset there downloaded the
 * same full-size file under five different cache keys - and on signed URLs
 * (S3, Firebase) the extra parameters invalidate the signature outright.
 */
const RESIZING_HOSTS = new Set(['images.unsplash.com'])

/**
 * OptimizedImage Component
 * 
 * Features:
 * - High-speed native lazy loading (loading="lazy")
 * - Responsive srcset for different screen sizes
 * - WebP/AVIF format support with fallback
 * - Blur placeholder (LQIP) for smooth loading
 * - Preloading for critical images (priority=true)
 * - Proper decoding and fetchpriority
 * - Instant cached image rendering (zero delay/flash for cached assets)
 * - Error handling with fallback
 */
const OptimizedImage = React.memo(({
  src,
  alt,
  className = '',
  priority = false, // For above-the-fold images
  sizes = '100vw',
  objectFit = 'cover',
  placeholder = 'blur',
  blurDataURL,
  responsive = true, // false = single src only (carousels / avoid per-slide request storms)
  fallbackImage,
  onLoad,
  onError,
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState(priority)
  // 0: first try, 1: retried once, 2: gave up -> fallback.
  const [failures, setFailures] = useState(0)
  const imgRef = useRef(null)

  // Relative /uploads paths, localhost/http URLs, { url } objects -> loadable URL.
  const resolvedSrc = useMemo(() => resolveImageSrc(src), [src])

  /*
   * A new source starts clean. The error flag used to stick for the life of
   * the component, so a list row that once failed (a dropped request, or an
   * item whose photo was replaced) kept showing the placeholder for ever.
   */
  useEffect(() => {
    setFailures(0)
    setIsLoaded(priority)
  }, [resolvedSrc, priority])
  const hasError = failures >= 2

  const supportsOptimization = (imageSrc) => {
    if (!responsive) return false
    if (!imageSrc || typeof imageSrc !== 'string') return false
    try {
      return RESIZING_HOSTS.has(new URL(imageSrc).hostname)
    } catch {
      return false
    }
  }

  const appendImageParams = (imageSrc, params) => {
    try {
      const url = new URL(imageSrc)
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value))
      })
      return url.toString()
    } catch {
      return imageSrc
    }
  }

  // Prefer thumbnail widths when sizes looks icon/chip-sized (avoids 1600w downloads for logos)
  const responsiveWidths = useMemo(() => {
    const s = String(sizes || '')
    const looksLikeIcon =
      /^\s*\d{1,3}px\s*$/i.test(s) ||
      /\b(7[0-9]|8[0-9]|9[0-9]|1[01][0-9]|12[0-8])px\b/i.test(s) ||
      /\b2[0-5]vw\b/i.test(s)
    return looksLikeIcon ? [120, 200, 320] : [400, 600, 800, 1200, 1600]
  }, [sizes])

  // Generate responsive srcset (disabled when responsive=false — e.g. dish carousels)
  // After a failure, retry with the plain URL only (no srcset variants).
  const srcSet = useMemo(() => {
    if (failures > 0 || !supportsOptimization(resolvedSrc)) return undefined
    return responsiveWidths
      .map(size => `${appendImageParams(resolvedSrc, { w: size, q: 80 })} ${size}w`)
      .join(', ')
  }, [resolvedSrc, responsive, responsiveWidths, failures])

  // Generate WebP srcset
  const webPSrcSet = useMemo(() => {
    if (failures > 0 || !supportsOptimization(resolvedSrc)) return undefined
    return responsiveWidths
      .map(size => `${appendImageParams(resolvedSrc, { w: size, q: 80, fm: 'webp' })} ${size}w`)
      .join(', ')
  }, [resolvedSrc, responsive, responsiveWidths, failures])

  // Instant Cache Detection: Check if image is already cached/complete in browser cache on mount and source change
  useEffect(() => {
    if (imgRef.current) {
      const img = imgRef.current.querySelector('img')
      if (img && img.complete) {
        setIsLoaded(true)
      }
    }
  }, [resolvedSrc])

  const handleLoad = (e) => {
    setIsLoaded(true)
    if (onLoad) onLoad(e)
  }

  const handleError = (e) => {
    // The fallback itself failing must not loop.
    if (isFallback) return
    setFailures((n) => n + 1)
    if (onError) onError(e)
  }

  // Default blur placeholder (tiny gray square)
  const defaultBlurDataURL = blurDataURL || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U1ZTdlYiIvPjwvc3ZnPg=='
  const DEFAULT_FALLBACK = dishFallbackImage

  // One retry under a new URL (an identical src would not be requested again);
  // signed URLs cannot take a parameter and go straight to the fallback.
  const retrySrc = failures === 1 ? imageRetryUrl(resolvedSrc) : null
  const isFallback = !resolvedSrc || hasError || (failures === 1 && !retrySrc)
  const effectiveSrc = isFallback ? (fallbackImage || DEFAULT_FALLBACK) : (retrySrc || resolvedSrc)

  return (
    <div className={`relative overflow-hidden ${className}`} ref={imgRef}>
      {/* Blur Placeholder */}
      {placeholder === 'blur' && !isLoaded && !isFallback && (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 1 }}
          animate={{ opacity: isLoaded ? 0 : 1 }}
          transition={{ duration: 0.3 }}
          style={{
            backgroundImage: `url(${defaultBlurDataURL})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(20px)',
            transform: 'scale(1.1)',
          }}
        />
      )}

      {/* Loading Skeleton */}
      {!isLoaded && !isFallback && placeholder !== 'empty' && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
      )}

      {/* Actual Image - Rendered immediately */}
      <picture className="absolute inset-0 w-full h-full">
        {/* WebP source for modern browsers */}
        {webPSrcSet && !isFallback && (
          <source
            srcSet={webPSrcSet}
            sizes={sizes}
            type="image/webp"
          />
        )}

        {/* Fallback to original format / fallback image */}
        <motion.img
          src={effectiveSrc}
          srcSet={!isFallback ? srcSet : undefined}
          sizes={!isFallback && supportsOptimization(effectiveSrc) ? sizes : undefined}
          alt={alt || 'Food item'}
          className={`w-full h-full ${objectFit === 'cover' ? 'object-cover' : objectFit === 'contain' ? 'object-contain' : ''} ${priority || isLoaded || isFallback ? 'opacity-100' : 'opacity-0'} ${!priority && 'transition-opacity duration-300'}`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={handleLoad}
          onError={handleError}
          {...props}
        />
      </picture>
    </div>
  )
})

export default OptimizedImage
