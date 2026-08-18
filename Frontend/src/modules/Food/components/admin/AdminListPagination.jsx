import React from "react"

/**
 * Orders-style list pagination: rows-per-page + Prev/Next + numbered pages.
 */
export default function AdminListPagination({
  currentPage = 1,
  pageSize = 20,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  itemLabel = "items",
  pageSizeOptions = [10, 20, 50, 100],
  className = "",
}) {
  const totalCount = Math.max(0, Number(totalItems) || 0)
  const size = Math.max(1, Number(pageSize) || 20)
  const page = Math.max(1, Number(currentPage) || 1)
  const totalPages = Math.max(1, Math.ceil(totalCount / size) || 1)

  if (totalCount <= 0) return null

  const setPage = (next) => {
    const safe = Math.min(Math.max(1, next), totalPages)
    if (safe !== page) onPageChange?.(safe)
  }

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-100 bg-white px-4 py-4 sm:px-6 ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500 font-medium">Rows per page:</span>
        <select
          value={size}
          onChange={(e) => {
            const next = Number(e.target.value)
            onPageSizeChange?.(next)
            onPageChange?.(1)
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 cursor-pointer shadow-sm"
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-1 justify-between sm:hidden w-full">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page === 1}
          className="relative inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
          className="relative ml-3 inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Next
        </button>
      </div>

      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between w-full">
        <div className="pl-4">
          <p className="text-sm text-slate-600">
            Showing{" "}
            <span className="font-semibold text-slate-900">
              {Math.min(totalCount, (page - 1) * size + 1)}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-slate-900">
              {Math.min(totalCount, page * size)}
            </span>{" "}
            of <span className="font-semibold text-slate-900">{totalCount}</span> {itemLabel}
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm gap-1" aria-label="Pagination">
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="relative inline-flex items-center rounded-md px-2.5 py-1.5 text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              &lt;
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === totalPages ||
                  (p >= page - 2 && p <= page + 2),
              )
              .map((p, index, arr) => {
                const showEllipsisBefore = index > 0 && p - arr[index - 1] > 1
                return (
                  <React.Fragment key={p}>
                    {showEllipsisBefore && (
                      <span className="px-3 py-1.5 text-slate-400 text-sm">...</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setPage(p)}
                      className={`relative inline-flex items-center px-3.5 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                        page === p
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                )
              })}
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="relative inline-flex items-center rounded-md px-2.5 py-1.5 text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              &gt;
            </button>
          </nav>
        </div>
      </div>
    </div>
  )
}
