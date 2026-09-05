import React from 'react';
import { motion } from 'framer-motion';
import { usePublicAppConfig } from "@food/context/PublicAppConfigContext";

import discountPromoIcon from "@food/assets/category-icons/discount_promo.webp";
import gourmetPromoIcon from "@food/assets/explore more icons/gourmet.webp";
import pricePromoIcon from "@food/assets/category-icons/price_promo.webp";
import collectionPromoIcon from "@food/assets/explore more icons/collection.webp";

export default function PromoRow({ handleVegModeChange, navigate, isVegMode, toggleRef }) {
  const { exploreIcons } = usePublicAppConfig() || {};

  const defaultItems = [
    {
      id: 'offers',
      title: "Hot Deals",
      value: "Offers",
      icon: discountPromoIcon,
      path: '/food/user/offers',
    },
    {
      id: 'gourmet',
      title: "Premium",
      value: "Gourmet",
      icon: gourmetPromoIcon,
      path: '/food/user/gourmet',
    },
    {
      id: 'under-250',
      title: "Under ₹99",
      value: "Eatiefy 99",
      icon: pricePromoIcon,
      path: '/food/user/under-250',
    },
    {
      id: 'collections',
      title: "Favorites",
      value: "Collections",
      icon: collectionPromoIcon,
      path: '/food/user/profile/favorites',
    },
  ];

  const promoCardsData = defaultItems.map((item) => {
    const dbItem = (exploreIcons || []).find(
      (db) => db.label?.toLowerCase() === item.value.toLowerCase()
    );
    if (dbItem) {
      const dbUrl = dbItem.imageUrl || dbItem.iconUrl;
      const rawLink = dbItem.link || dbItem.targetPath;
      let finalLink = item.path;
      if (rawLink) {
        finalLink = rawLink.startsWith('/food') ? rawLink : `/food${rawLink}`;
      }
      return {
        ...item,
        icon: dbUrl || item.icon,
        path: finalLink,
      };
    }
    return item;
  });

  return (
    <div className="w-full max-w-[520px] md:max-w-xl mx-auto px-3 sm:px-4 py-1">
      <div className="bg-white dark:bg-[#1a1a1a] rounded-[2.2rem] py-2 px-3 sm:py-2.5 sm:px-4 border border-gray-100 dark:border-gray-800 shadow-md shadow-gray-200/50 dark:shadow-none grid grid-cols-4 gap-1.5 justify-items-center w-full">
        {promoCardsData.map((promo, idx) => (
          <motion.div
            key={idx}
            ref={promo.id === 'gourmet' ? toggleRef : null}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
            whileHover={{ y: -2, scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center gap-0.5 group cursor-pointer w-full"
            onClick={() => {
              navigate(promo.path);
            }}
          >
            {/* Floating Minimalist Image */}
            <div className="relative w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center p-0.5">
              <img
                src={promo.icon}
                alt={promo.value}
                className="w-full h-full object-contain relative z-20 transition-transform duration-300 group-hover:scale-110 drop-shadow-sm"
               loading="lazy" decoding="async" />
            </div>

            {/* Clean Typography */}
            <div className="flex flex-col items-center text-center w-full">
              <span className="text-[11px] sm:text-[11.5px] font-black text-gray-900 dark:text-gray-100 tracking-tight leading-tight">
                {promo.value}
              </span>
              <span className="text-[8.5px] sm:text-[9.5px] font-bold text-gray-500 dark:text-gray-400 capitalize whitespace-nowrap">
                {promo.title}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
