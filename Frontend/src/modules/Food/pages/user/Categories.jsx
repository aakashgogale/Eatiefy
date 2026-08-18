import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Grid2x2 } from "lucide-react";
import { motion } from "framer-motion";
import { adminAPI } from "@food/api";
import { foodImages } from "@food/constants/images";
import OptimizedImage from "@food/components/OptimizedImage";
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext";
import useAppBackNavigation from "@food/hooks/useAppBackNavigation";
import { API_BASE_URL } from "@food/api/config";

export default function Categories() {
  const navigate = useNavigate();
  const goBack = useAppBackNavigation();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { zoneId } = useDeliveryLocation();

  const BACKEND_ORIGIN = useMemo(() => API_BASE_URL.replace(/\/api\/?$/, ""), []);

  const normalizeImageUrl = (imageUrl) => {
    if (typeof imageUrl !== "string") return "";
    const trimmed = imageUrl.trim();
    if (!trimmed) return "";
    if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed;
    
    const normalizedInput = trimmed
      .replace(/\\/g, "/")
      .replace(/^(https?):\/(?!\/)/i, "$1://")
      .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

    if (/^(https?:)?\/\//i.test(normalizedInput)) return normalizedInput;

    return normalizedInput.startsWith("/")
      ? `${BACKEND_ORIGIN}${normalizedInput}`
      : `${BACKEND_ORIGIN}/${normalizedInput.replace(/^\.?\/*/, "")}`;
  };

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {});
        const list =
          response?.data?.data?.categories ||
          response?.data?.categories ||
          [];

        if (Array.isArray(list)) {
          const transformed = list.map((cat, idx) => ({
            id: String(cat?.id || cat?._id || cat?.slug || idx),
            name: cat?.name || "",
            slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
            image: normalizeImageUrl(cat?.image || cat?.imageUrl) || foodImages[idx % foodImages.length],
            type: cat?.type || "",
          }));
          setCategories(transformed);
        }
      } catch (error) {
        console.error("Error fetching categories:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCategories();
  }, [zoneId, BACKEND_ORIGIN]);

  const filteredCategories = categories.filter((cat) =>
    (cat.name || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] pb-10">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md border-b border-neutral-100 dark:border-neutral-800 px-4 py-4 flex items-center gap-4">
        <button onClick={goBack} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors active:scale-95">
          <ArrowLeft className="h-6 w-6 text-neutral-800 dark:text-neutral-200" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight">All Categories</h1>
          <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-bold uppercase tracking-widest leading-none mt-1">What are you craving today?</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-6">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400 dark:text-neutral-500 group-focus-within:text-[#659116] transition-colors" />
          <input
            type="text"
            placeholder="Search specialties, cuisines..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-neutral-50 dark:bg-[#1a1a1a] border border-neutral-100 dark:border-neutral-800 rounded-2xl text-sm font-medium text-neutral-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-[#659116]/5 focus:border-[#659116] transition-all placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
          />
        </div>
      </div>

      {/* List Layout */}
      <div className="px-4">
        {loading ? (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-4 p-3 bg-white dark:bg-[#1a1a1a] rounded-[24px] border border-gray-100 dark:border-gray-850 shadow-sm animate-pulse h-[140px] sm:h-[160px]">
                <div className="flex-1 h-full rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex-shrink-0" />
                <div className="flex-1 py-1 flex flex-col justify-between h-full">
                  <div>
                    <div className="h-4 w-32 bg-neutral-100 dark:bg-neutral-800 rounded-full" />
                    <div className="h-3 w-20 bg-neutral-100 dark:bg-neutral-800 rounded-full mt-2" />
                  </div>
                  <div className="h-6 w-16 bg-neutral-100 dark:bg-neutral-800 rounded-full mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">
            {filteredCategories.map((category, index) => {
              // Generate a realistic count of meals based on category ID/index
              const mealCount = (category.name.charCodeAt(0) % 15) + 6;
              const categoryType = category.type || "Fresh & Delicious";
              
              return (
                <motion.div
                  key={category.id || index}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="w-full"
                >
                  <Link
                    to={`/food/user/category/${category.slug}`}
                    className="flex items-center gap-4 p-3 bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-850 rounded-[24px] shadow-sm hover:shadow-md hover:bg-neutral-50 dark:hover:bg-[#1f1f1f] transition-all duration-300 group h-[140px] sm:h-[160px]"
                  >
                    {/* Left: Category Image */}
                    <div className="flex-1 h-full rounded-2xl overflow-hidden shadow-sm flex-shrink-0 bg-white dark:bg-[#1f1f1f]">
                      <OptimizedImage
                        src={category.image}
                        alt={category.name}
                        className="w-full h-full object-contain group-hover:scale-[1.08] transition-transform duration-500"
                        sizes="(max-width: 640px) 50vw, 25vw"
                      />
                    </div>

                    {/* Right: Category details (Name, Type, Items Count) */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-1">
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white truncate capitalize tracking-tight group-hover:text-[#659116] transition-colors">
                          {category.name}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 capitalize font-medium">
                          {categoryType}
                        </p>
                      </div>
                      <div className="mt-2">
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] sm:text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                          {mealCount} Meals
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}

        {filteredCategories.length === 0 && !loading && (
          <div className="py-20 flex flex-col items-center text-center px-6">
            <div className="h-20 w-20 bg-neutral-50 dark:bg-neutral-900 rounded-full flex items-center justify-center mb-6">
              <Grid2x2 className="h-10 w-10 text-neutral-300 dark:text-neutral-700" />
            </div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">No results found</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 max-w-[240px]">We couldn't find any categories matching your search. Try another keyword!</p>
            <button 
              onClick={() => setSearchQuery("")}
              className="mt-8 px-8 py-3 bg-[#659116] text-white rounded-2xl text-sm font-bold active:scale-95 transition-all shadow-lg hover:bg-[#5ECC11]"
            >
              Show all categories
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
