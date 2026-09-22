import { forwardRef, useEffect, useMemo, useState } from "react"
import { imageRetryUrl, resolveImageSrc } from "@/shared/utils/mediaUrl"
import dishFallbackImage from "@food/assets/dish_fallback.webp"

/**
 * Drop-in <img> for dish photos coming from the API.
 *
 * Stored image values are not uniform (relative "/uploads/..." paths,
 * localhost or http URLs, objects with a `url` field), and a raw <img src>
 * either requested the wrong host or showed the browser's broken-image icon.
 * This resolves the value to a loadable URL, retries once (a dropped request
 * on mobile data is common while a menu scrolls), then shows the fallback -
 * and never loops if the fallback itself fails.
 *
 * `as` renders another element with the same props, e.g. `as={motion.img}`.
 */
const SafeImage = forwardRef(function SafeImage(
  { src, fallbackSrc = dishFallbackImage, onError, as: Tag = "img", loading = "lazy", decoding = "async", ...props },
  ref,
) {
  // `src={item.image || fallback}` is common: the fallback needs no resolving.
  const resolved = useMemo(
    () => (src && src === fallbackSrc ? "" : resolveImageSrc(src) || ""),
    [src, fallbackSrc],
  )
  // 0: first try, 1: one retry, 2: fallback.
  const [attempt, setAttempt] = useState(0)

  // A new image (item edited, list row reused) gets a fresh start.
  useEffect(() => {
    setAttempt(0)
  }, [resolved])

  const retryUrl = attempt === 1 ? imageRetryUrl(resolved) : null
  const showFallback = !resolved || attempt >= 2 || (attempt === 1 && !retryUrl)
  const current = showFallback ? fallbackSrc : retryUrl || resolved

  const handleError = (event) => {
    if (typeof onError === "function") onError(event)
    if (showFallback) return
    setAttempt((value) => value + 1)
  }

  return (
    <Tag
      ref={ref}
      src={current}
      loading={loading}
      decoding={decoding}
      onError={handleError}
      {...props}
    />
  )
})

export default SafeImage
