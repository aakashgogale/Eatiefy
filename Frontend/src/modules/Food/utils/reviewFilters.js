/**
 * Search + filter + sort for the Reviews tab. Reviews are already fully loaded
 * client-side, so this is one pass over that data — searching never issues an
 * extra API request. Search runs before sorting so the selected sort order
 * still applies to the matched set.
 */
export const applyReviewFilters = (reviews = [], { search = "", filters = {} } = {}) => {
  let filtered = [...reviews]

  const query = String(search || "").trim().toLowerCase()
  if (query) {
    filtered = filtered.filter((review) =>
      [
        review.reviewText,
        review.userName,
        review.orderNumber,
        review.outlet,
        review.date,
        review.rating != null ? String(review.rating) : "",
      ].some((field) => String(field || "").toLowerCase().includes(query))
    )
  }

  // Filter by star rating if selected
  if (filters.reviewType && filters.reviewType.length > 0) {
    filtered = filtered.filter((r) => {
      if (r.rating == null) return false
      return filters.reviewType.includes(Math.round(r.rating))
    })
  }

  if (filters.sortBy) {
    filtered.sort((a, b) => {
      const dateA = a.sortTimestamp ?? 0
      const dateB = b.sortTimestamp ?? 0
      if (filters.sortBy === "newest") return dateB - dateA
      if (filters.sortBy === "oldest") return dateA - dateB
      if (filters.sortBy === "bestRated") return (b.rating ?? 0) - (a.rating ?? 0)
      if (filters.sortBy === "worstRated") return (a.rating ?? 0) - (b.rating ?? 0)
      return 0
    })
  }

  return filtered
}
