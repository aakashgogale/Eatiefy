import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { deliveryAPI } from "@food/api";
import { toast } from "sonner";
import { useCompanyName } from "@food/hooks/useCompanyName";
import useDeliveryBackNavigation from "../../hooks/useDeliveryBackNavigation";

export default function ShowIdCardV2() {
  const companyName = useCompanyName();
  const goBack = useDeliveryBackNavigation();
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);

  // Fetch delivery partner profile data
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const response = await deliveryAPI.getProfile();
        
        if (response?.data?.success && response?.data?.data?.profile) {
          setProfileData(response.data.data.profile);
        } else {
          toast.error("Failed to load profile data");
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
        toast.error("Failed to load ID card data");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  // Format date for validity
  const formatValidDate = () => {
    if (!profileData?.createdAt) return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const createdDate = new Date(profileData.createdAt);
    const validTill = new Date(createdDate);
    validTill.setFullYear(validTill.getFullYear() + 1);
    return validTill.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  /**
   * The partner's real approval state. Returns null until the profile loads, so
   * the card never claims a status it has not read — the previous default of
   * "Active"/green showed a positive status to every partner, approved or not.
   */
  const resolveStatusKey = () => {
    if (!profileData) return null;
    const raw = String(profileData.status || "").trim().toLowerCase();
    if (raw) return raw;
    if (typeof profileData.isActive === "boolean") {
      return profileData.isActive ? "active" : "inactive";
    }
    return null;
  };

  /**
   * Label + colours per status. Each entry pairs a solid background with white
   * text so the label always has contrast, and each carries its own shadow tint
   * (the badge previously hardcoded a green glow for every state).
   */
  const STATUS_STYLES = {
    approved: { label: "Approved", bg: "bg-green-600", shadow: "shadow-green-600/30" },
    active: { label: "Active", bg: "bg-green-600", shadow: "shadow-green-600/30" },
    pending: { label: "Pending", bg: "bg-amber-500", shadow: "shadow-amber-500/30" },
    rejected: { label: "Rejected", bg: "bg-red-600", shadow: "shadow-red-600/30" },
    blocked: { label: "Blocked", bg: "bg-red-600", shadow: "shadow-red-600/30" },
    suspended: { label: "Suspended", bg: "bg-red-600", shadow: "shadow-red-600/30" },
    inactive: { label: "Inactive", bg: "bg-gray-500", shadow: "shadow-gray-500/30" },
    deleted: { label: "Inactive", bg: "bg-gray-500", shadow: "shadow-gray-500/30" },
  };

  const getStatusStyle = () => {
    const key = resolveStatusKey();
    if (!key) return { label: "", bg: "bg-gray-400", shadow: "shadow-gray-400/30" };
    return (
      STATUS_STYLES[key] || {
        // Unknown status: still show it rather than rendering an empty pill.
        label: key.charAt(0).toUpperCase() + key.slice(1),
        bg: "bg-gray-500",
        shadow: "shadow-gray-500/30",
      }
    );
  };

  const getProfileImageUrl = () => {
    if (profileData?.profileImage?.url) return profileData.profileImage.url;
    if (profileData?.documents?.photo) return profileData.documents.photo;
    return "/assets/images/profile_avatar.webp";
  };

  // Get vehicle display text
  const getVehicleDisplay = () => {
    if (!profileData?.vehicle) return null;
    const vehicle = profileData.vehicle;
    const parts = [];
    if (vehicle.type) parts.push(vehicle.type.charAt(0).toUpperCase() + vehicle.type.slice(1));
    if (vehicle.number) parts.push(vehicle.number);
    return parts.length > 0 ? parts.join(" - ") : null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
          <p className="text-gray-600">Loading ID card...</p>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Failed to load ID card data</p>
          <button onClick={goBack} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Go Back</button>
        </div>
      </div>
    );
  }

  const idCardData = {
    name: profileData.name || "Delivery Partner",
    id: profileData.deliveryId || profileData._id?.toString().slice(-8).toUpperCase() || "N/A",
    phone: profileData.phone || "N/A",
    statusStyle: getStatusStyle(),
    validTill: formatValidDate(),
    vehicle: getVehicleDisplay(),
    profileImage: getProfileImageUrl()
  };

  return (
    <div className="min-h-screen bg-black relative">
      <div className="max-w-md mx-auto min-h-screen bg-gray-100 relative shadow-2xl">
        {/* Close Button - Top Right */}
        <button
          onClick={goBack}
          className="absolute top-4 right-4 p-2 hover:bg-gray-200 rounded-full transition-colors z-30 bg-white/50 backdrop-blur-md"
        >
          <X className="w-6 h-6 text-black" />
        </button>

        {/* Top Grey Background Section */}
        <div className="bg-gray-300 h-40 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-transparent" />
          {/* Profile Picture */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10">
            <div className="p-1.5 bg-white rounded-full shadow-2xl">
              <img
                src={idCardData.profileImage}
                alt={idCardData.name}
                className="w-36 h-36 rounded-full object-cover border-4 border-gray-100"
                onError={(e) => {
                  e.target.src = "/assets/images/profile_avatar.webp";
                }}
              />
            </div>
          </div>
        </div>

        {/* Main White Content Area */}
        <div className="bg-white min-h-[calc(100vh-10rem)] relative pt-20 px-6 pb-12">
          <div className="flex flex-col items-center text-center">
            {/* Brand Name */}
            <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-500 mb-2">{companyName}</p>

            {/* Delivery Partner Title */}
            <h1 className="text-4xl font-black text-gray-900 mb-1 leading-tight">PARTNER</h1>
            <h2 className="text-xl font-bold text-gray-400 uppercase tracking-widest mb-6">ID CARD</h2>

            {/* Approval status badge.
                `inline-flex` matters: as a plain inline element the vertical
                padding did not grow the line box, so the pill collided with the
                text above it and the label could be clipped out of view. */}
            {idCardData.statusStyle.label ? (
              <div className="mb-8">
                <span
                  className={`${idCardData.statusStyle.bg} ${idCardData.statusStyle.shadow} inline-flex items-center justify-center text-white px-8 py-2.5 rounded-full text-xs font-black uppercase tracking-[0.2em] leading-none whitespace-nowrap shadow-lg`}
                >
                  {idCardData.statusStyle.label}
                </span>
              </div>
            ) : null}

            {/* Details Grid */}
            <div className="w-full space-y-8 mt-4">
              <div className="flex flex-col items-center">
                 <h3 className="text-2xl font-black text-gray-950 uppercase tracking-tight">{idCardData.name}</h3>
                 <p className="text-gray-400 font-bold uppercase text-[10px] tracking-[0.2em] mt-1">Full Name</p>
              </div>

              <div className="grid grid-cols-2 gap-8 w-full">
                 <div className="flex flex-col items-center">
                    <span className="text-sm font-black text-gray-950">{idCardData.id}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Partner ID</span>
                 </div>
                 <div className="flex flex-col items-center">
                    <span className="text-sm font-black text-gray-950">{idCardData.phone}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Mobile</span>
                 </div>
              </div>

              {idCardData.vehicle && (
                <div className="flex flex-col items-center bg-gray-50 p-4 rounded-2xl border border-gray-100">
                   <span className="text-sm font-black text-gray-950 uppercase">{idCardData.vehicle}</span>
                   <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Registered Vehicle</span>
                </div>
              )}

              <div className="pt-4 border-t border-gray-100">
                 <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-loose">
                   This ID card is issued for essential delivery services only. <br/>
                   Valid On: {idCardData.validTill}
                 </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
