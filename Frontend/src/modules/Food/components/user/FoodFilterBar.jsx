import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, ChevronDown, BadgePercent, Star, Timer, X } from "lucide-react";

export const SORT_OPTIONS = [
  { id: "relevance", label: "Relevance (Default)" },
  { id: "delivery_time", label: "Delivery Time - Fastest" },
  { id: "rating", label: "Rating" },
  { id: "cost_low_to_high", label: "Cost: Low to High" },
  { id: "cost_high_to_low", label: "Cost: High to Low" },
];

export default function FoodFilterBar({
  sortBy = "relevance",
  onSortChange,
  isVeg = false,
  onVegToggle,
  isNonVeg = false,
  onNonVegToggle,
  rating4Plus = false,
  onRating4PlusToggle,
  hasOffers = false,
  onOffersToggle,
  under30Mins = false,
  onUnder30MinsToggle,
  store99Filter = false,
  onStore99Toggle,
  storeLabel = "99 Store",
  onFilterButtonClick,
  className = "",
}) {
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0 });
  const sortButtonRef = useRef(null);

  const activeSortLabel =
    SORT_OPTIONS.find((opt) => opt.id === sortBy)?.label || "Sort by";
  const isSortActive = Boolean(sortBy && sortBy !== "relevance");

  const countActiveFilters = [
    isSortActive,
    isVeg,
    isNonVeg,
    rating4Plus,
    hasOffers,
    under30Mins,
    store99Filter,
  ].filter(Boolean).length;

  const handleOpenSort = (e) => {
    e.stopPropagation();
    if (!isSortOpen && sortButtonRef.current) {
      const rect = sortButtonRef.current.getBoundingClientRect();
      const popoverWidth = 230;
      const screenWidth = typeof window !== "undefined" ? window.innerWidth : 360;
      let leftPos = rect.left;

      if (leftPos + popoverWidth > screenWidth - 12) {
        leftPos = screenWidth - popoverWidth - 12;
      }
      leftPos = Math.max(12, leftPos);

      setDropdownCoords({
        top: rect.bottom + 6,
        left: leftPos,
      });
    }
    setIsSortOpen((prev) => !prev);
  };

  const handleFilterClick = () => {
    if (onFilterButtonClick) {
      onFilterButtonClick();
    } else {
      setIsSortOpen((prev) => !prev);
    }
  };

  // Close dropdown on scroll or resize
  useEffect(() => {
    if (!isSortOpen) return;
    const handleClose = () => setIsSortOpen(false);
    window.addEventListener("scroll", handleClose, { capture: true, passive: true });
    window.addEventListener("resize", handleClose);
    return () => {
      window.removeEventListener("scroll", handleClose, { capture: true });
      window.removeEventListener("resize", handleClose);
    };
  }, [isSortOpen]);

  return (
    <div className={`relative w-full ${className}`}>
      <div
        className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-2 px-4 scroll-smooth"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          touchAction: "pan-x pan-y pinch-zoom",
        }}
      >
        {/* Main Filter Icon Button */}
        <button
          onClick={handleFilterClick}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
            countActiveFilters > 0
              ? "bg-[#659116] text-white border-[#659116]"
              : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.2]" />
          <span>Filter</span>
          {countActiveFilters > 0 && (
            <span className="ml-0.5 bg-white text-[#659116] text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
              {countActiveFilters}
            </span>
          )}
        </button>

        {/* Sort by Dropdown Button */}
        <button
          ref={sortButtonRef}
          onClick={handleOpenSort}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
            isSortActive
              ? "bg-white dark:bg-[#1a1a1a] text-[#659116] border-[#659116] dark:border-emerald-600"
              : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <span>{isSortActive ? activeSortLabel : "Sort by"}</span>
          {isSortActive ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                if (onSortChange) onSortChange("relevance");
              }}
              className="p-0.5 hover:opacity-75"
            >
              <X className="w-3.5 h-3.5 text-[#659116]" />
            </span>
          ) : (
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${isSortOpen ? "rotate-180" : ""}`} />
          )}
        </button>

        {/* 99 Store Pill */}
        {onStore99Toggle && (
          <button
            onClick={onStore99Toggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              store99Filter
                ? "bg-white dark:bg-[#1a1a1a] text-[#659116] border-[#659116]"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <span className="bg-[#659116] text-white text-[10px] font-black px-1.5 py-0.2 rounded-md">
              99
            </span>
            <span>{storeLabel}</span>
            {store99Filter && <X className="w-3.5 h-3.5 text-[#659116] ml-0.5" />}
          </button>
        )}

        {/* Offers Pill */}
        {onOffersToggle && (
          <button
            onClick={onOffersToggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              hasOffers
                ? "bg-white dark:bg-[#1a1a1a] text-[#659116] border-[#659116]"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <BadgePercent className="w-3.5 h-3.5 text-[#659116]" />
            <span>Offers</span>
            {hasOffers && <X className="w-3.5 h-3.5 text-[#659116] ml-0.5" />}
          </button>
        )}

        {/* Ratings 4.0+ Pill */}
        {onRating4PlusToggle && (
          <button
            onClick={onRating4PlusToggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              rating4Plus
                ? "bg-white dark:bg-[#1a1a1a] text-[#659116] border-[#659116]"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-[#659116] text-[#659116]" />
            <span>Ratings 4.0+</span>
            {rating4Plus && <X className="w-3.5 h-3.5 text-[#659116] ml-0.5" />}
          </button>
        )}

        {/* Under 30 mins / Fast Delivery Pill */}
        {onUnder30MinsToggle && (
          <button
            onClick={onUnder30MinsToggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              under30Mins
                ? "bg-white dark:bg-[#1a1a1a] text-[#659116] border-[#659116]"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Timer className="w-3.5 h-3.5 text-[#659116]" />
            <span>Under 30 mins</span>
            {under30Mins && <X className="w-3.5 h-3.5 text-[#659116] ml-0.5" />}
          </button>
        )}

        {/* Pure Veg Pill */}
        {onVegToggle && (
          <button
            onClick={onVegToggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              isVeg
                ? "bg-white dark:bg-[#1a1a1a] text-emerald-600 dark:text-emerald-400 border-emerald-500 font-bold"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <span>Pure Veg</span>
            {isVeg && <X className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-0.5" />}
          </button>
        )}

        {/* Non Veg Pill */}
        {onNonVegToggle && (
          <button
            onClick={onNonVegToggle}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 shadow-sm ${
              isNonVeg
                ? "bg-white dark:bg-[#1a1a1a] text-red-600 dark:text-red-400 border-red-500 font-bold"
                : "bg-white dark:bg-[#1a1a1a] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <span>Non Veg</span>
            {isNonVeg && <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400 ml-0.5" />}
          </button>
        )}
      </div>

      {/* Floating Dropdown Menu (Anchored directly under Sort By button like Image 2) */}
      {isSortOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[99999]">
            {/* Invisible Click-away Backdrop */}
            <div
              className="fixed inset-0 bg-transparent"
              onClick={() => setIsSortOpen(false)}
            />

            {/* Dropdown Card */}
            <div
              style={{
                top: `${dropdownCoords.top}px`,
                left: `${dropdownCoords.left}px`,
              }}
              className="fixed z-10 w-56 bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 p-2 sm:p-2.5 animate-in fade-in zoom-in-95 duration-150 space-y-0.5"
            >
              {SORT_OPTIONS.map((option) => {
                const isSelected = (sortBy || "relevance") === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (onSortChange) onSortChange(option.id);
                      setIsSortOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                      isSelected
                        ? "text-[#659116] bg-emerald-50/60 dark:bg-emerald-950/40 font-bold"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    <span>{option.label}</span>
                    {/* Theme Radio Circle */}
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
                        isSelected
                          ? "border-[#659116]"
                          : "border-gray-300 dark:border-gray-600"
                      }`}
                    >
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-[#659116]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
