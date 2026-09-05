import React from 'react';
import { MapPin, ChevronDown, Wallet } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useProfile } from "@food/context/ProfileContext";

import outOfZoneBg from '@food/assets/Outofzone_bg.jpg';

const OutOfZoneScreen = ({ location, handleLocationClick }) => {
  const { userProfile } = useProfile();
  const BRAND_NAME = "Ometto"; // Change this for different projects

  const routerLocation = useLocation();
  const initials = React.useMemo(() => {
    if (!userProfile) return "";
    const name = userProfile.firstName || userProfile.name || "";
    return name[0]?.toUpperCase() || "U";
  }, [userProfile]);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#2a1c3d] overflow-hidden fixed inset-0 z-40">
      {/* Navbar Overlay */}
      <div className="absolute top-0 left-0 right-0 pt-6 pb-4 px-4 z-50 bg-transparent">
        <div className="flex items-start gap-3">
          {/* Left: Location Selector - Wrapped in a flex-1 div so the Link itself doesn't stretch across empty space */}
          <div className="flex-1 min-w-0">
            <div
              onClick={handleLocationClick}
              className="inline-flex items-center gap-2 cursor-pointer group max-w-full no-underline"
            >
              <div className="p-1.5 rounded-full group-active:scale-95 transition-all shrink-0">
                <MapPin className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[17px] font-black text-white truncate drop-shadow-md">
                    {(() => {
                      const area = location?.area || location?.subLocality || location?.mainTitle || location?.neighborhood;
                      if (area && !/^-?\d+(\.\d+)?$/.test(area.trim())) return area;
                      return location?.city || "Select Location";
                    })()}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-white/90 shrink-0" />
                </div>
                <span className="text-[12px] font-bold text-white/90 truncate leading-tight drop-shadow-sm">
                  {location?.city || "Pinpoint location"}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Wallet and Profile */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/food/user/wallet"
              state={{ from: routerLocation.pathname }}
              className="h-9 w-9 flex items-center justify-center rounded-full active:scale-90 transition-all"
            >
              <Wallet className="h-5.5 w-5.5 text-white" />
            </Link>

            <Link
              to="/food/user/profile"
              state={{ from: routerLocation.pathname }}
              className="h-9 w-9 relative flex items-center justify-center rounded-full bg-[#FFF5E6] border border-white/60 shadow-2xl cursor-pointer active:scale-90 transition-all overflow-hidden"
            >
              <span className="text-[22px] font-black text-[#DC2626] leading-none tracking-tighter">
                {initials || 'U'}
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* Full Screen Background Image with scale to prevent subpixel edge lines */}
      <div className="absolute inset-0 z-0">
        <img
          src={outOfZoneBg}
          alt="Service not available"
          className="w-full h-full object-cover scale-[1.02]"
        />
      </div>

      {/* Text Context - Positioned independently to avoid layout shifts */}
      <div className="absolute top-[48vh] left-0 w-full -translate-y-1/2 flex flex-col items-center z-10 px-6">
        <div className="text-center">
          <h2 className="text-[28px] font-bold text-white leading-[1.2] mb-4 tracking-tight drop-shadow-md">
            We'll be there soon –<br />hang tight!
          </h2>
          <p className="text-[16px] font-medium text-white/90 leading-[1.5] max-w-[320px] mx-auto drop-shadow-sm">
            Looks like online ordering isn't available<br />at your location yet.
          </p>
        </div>
      </div>

      {/* Brand Logo - Faded watermark style, positioned independently */}
      <div className="absolute top-[71vh] left-0 w-full pl-8 z-10">
        <span className="text-[34px] font-[1000] text-white/30 italic tracking-tighter leading-none mix-blend-overlay">
          {BRAND_NAME}
        </span>
      </div>
    </div>
  );
};

export default OutOfZoneScreen;
