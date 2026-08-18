import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChefHat, MapPin, Phone, 
  ChevronDown, ChevronUp, Package, 
  Navigation, CheckCircle2, Camera, Loader2, Image as ImageIcon
} from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { uploadAPI } from '@food/api';
import { toast } from 'sonner';
import { showUserFacingApiError } from '@/shared/utils/apiError';
import { formatTripDistanceKm } from '@/modules/DeliveryV2/hooks/useProximityCheck';
import { openCamera, openGallery } from "@food/utils/imageUploadUtils";

/**
 * PickupActionModal - Unified White/Green Theme with Slider Actions.
 * Includes Bill Upload feature prior to pickup.
 */
export const PickupActionModal = ({ 
  order, 
  status, 
  isWithinRange, 
  distanceToTarget,
  eta,
  onReachedPickup, 
  onPickedUp,
  onMinimize
}) => {
  const [showItems, setShowItems] = useState(false);
  const [isUploadingBill, setIsUploadingBill] = useState(false);
  const [billImageUploaded, setBillImageUploaded] = useState(false);
  const [billImageUrl, setBillImageUrl] = useState(null);
  const cameraInputRef = useRef(null);

  if (!order) return null;

  const handleBillImageSelect = async (file) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setIsUploadingBill(true);
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: 'appzeto/delivery/bills' });
      if (res?.data?.success && res?.data?.data) {
        setBillImageUrl(res.data.data.url || res.data.data.secure_url);
        setBillImageUploaded(true);
        // toast.success('Bill image uploaded!');
      } else {
        throw new Error('Upload failed');
      }
    } catch (err) {
      showUserFacingApiError(err, 'Failed to upload bill image');
      setBillImageUploaded(false);
      setBillImageUrl(null);
    } finally {
      setIsUploadingBill(false);
    }
  };

  const handleTakeCameraPhoto = () => {
    openCamera({
      onSelectFile: (file) => handleBillImageSelect(file),
      fileNamePrefix: `bill-${order.orderId || order._id}`
    })
  }

  const handlePickFromGallery = () => {
    openGallery({
      onSelectFile: handleBillImageSelect,
      fileNamePrefix: `bill-${order.orderId || order._id}`,
      fallbackInputRef: cameraInputRef,
    })
  }

  const isAtPickup = status === 'REACHED_PICKUP';
  const restaurant = order.restaurantId || order.restaurant || {};
  const restaurantName =
    order.restaurantName ||
    order.restaurant_name ||
    restaurant.restaurantName ||
    restaurant.name ||
    'Restaurant';
  const restaurantAddress =
    order.restaurantAddress ||
    order.restaurant_address ||
    order.restaurantLocation?.address ||
    [restaurant.addressLine1, restaurant.addressLine2, restaurant.area, restaurant.city, restaurant.state, restaurant.pincode]
      .filter(Boolean)
      .join(', ') ||
    restaurant.location?.address ||
    '';
  const restaurantPhone =
    order.restaurantPhone ||
    order.restaurant_phone ||
    restaurant.primaryContactNumber ||
    restaurant.ownerPhone ||
    restaurant.phone ||
    '';
  const restaurantCoords = order.restaurantLocation || null;
  const items = order.items || [];
  const restaurantLogo =
    order.restaurantImage ||
    restaurant.profileImage ||
    restaurant.logo ||
    order.restaurant?.logo ||
    order.restaurant?.profileImage ||
    'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';

  const customerName =
    order.customerName ||
    order.userId?.name ||
    order.user?.name ||
    order.deliveryAddress?.fullName ||
    order.deliveryAddress?.name ||
    'Customer';

  const customerPhone =
    order.customerPhone ||
    order.userPhone ||
    order.userId?.phone ||
    order.user?.phone ||
    order.deliveryAddress?.phone ||
    '';

  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    [
      order.deliveryAddress?.street,
      order.deliveryAddress?.additionalDetails,
      order.deliveryAddress?.landmark,
      order.deliveryAddress?.area,
      order.deliveryAddress?.city,
      order.deliveryAddress?.state,
      order.deliveryAddress?.zipCode || order.deliveryAddress?.pincode,
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(', ') ||
    '';

  const customerLocation = order.customerLocation || order.deliveryLocation || null;

  const handleCallRestaurant = () => {
    const num = String(restaurantPhone || '').replace(/\D/g, '');
    if (!num) {
      toast.error('Restaurant number not available');
      return;
    }
    window.location.href = `tel:${num}`;
  };

  const handleNavigateToRestaurant = () => {
    const lat = parseFloat(restaurantCoords?.lat ?? restaurantCoords?.latitude);
    const lng = parseFloat(restaurantCoords?.lng ?? restaurantCoords?.longitude);
    let mapsUrl;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    } else if (restaurantAddress) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(restaurantAddress)}&travelmode=driving`;
    } else {
      toast.error('Restaurant location not available');
      return;
    }
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCallCustomer = () => {
    const num = String(customerPhone || '').replace(/\D/g, '');
    if (!num) {
      toast.error('Customer number not available');
      return;
    }
    window.location.href = `tel:${num}`;
  };

  const handleNavigateToCustomer = () => {
    const lat = parseFloat(customerLocation?.lat ?? customerLocation?.latitude);
    const lng = parseFloat(customerLocation?.lng ?? customerLocation?.longitude);
    let mapsUrl;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    } else if (customerAddress) {
      mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(customerAddress)}&travelmode=driving`;
    } else {
      toast.error('Customer location not available');
      return;
    }
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-110 p-0 sm:p-4 flex items-end justify-center">
      {/* Background Dim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/40 -z-10"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-6 sm:pb-12 max-h-[84vh] overflow-y-auto"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-2 sm:pb-4 pt-1">
          <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
             <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Restaurant Header Card */}
        <div className="flex items-start justify-between mb-4 pb-4 border-b border-gray-100">
          <div className="flex gap-3 sm:gap-4 min-w-0 flex-1">
            <div className="w-13 h-13 sm:w-14 sm:h-14 bg-white rounded-2xl flex items-center justify-center shadow-md overflow-hidden border border-gray-100 shrink-0">
              <img src={restaurantLogo} alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 flex-1 pr-1">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-green-600">
                <ChefHat className="w-3.5 h-3.5" />
                <span>Restaurant Pickup</span>
              </div>
              <h3 className="text-gray-950 text-base sm:text-lg font-bold leading-tight truncate mt-0.5">{restaurantName}</h3>
              {restaurantAddress ? (
                <p className="text-gray-500 text-xs font-medium mt-0.5 leading-snug line-clamp-2">
                  {restaurantAddress}
                </p>
              ) : null}
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                {isAtPickup ? (
                  <span className="text-green-600 font-extrabold">Reached Location √</span>
                ) : (
                  <span className="text-orange-500">
                    {formatTripDistanceKm(distanceToTarget) === '--'
                      ? 'Locating restaurant…'
                      : `${formatTripDistanceKm(distanceToTarget)} km • ${eta || '--'} min to Store`}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex gap-2 shrink-0 ml-1">
            <button
              type="button"
              onClick={handleCallRestaurant}
              className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
              aria-label="Call restaurant"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNavigateToRestaurant}
              className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
              aria-label="Navigate to restaurant"
            >
              <Navigation className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Customer Drop Card (Requested for SS 2 & SS 3) */}
        <div className="flex items-start justify-between mb-5 pb-4 border-b border-gray-100">
          <div className="flex gap-3 sm:gap-4 min-w-0 flex-1">
            <div className="w-13 h-13 sm:w-14 sm:h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-sm shrink-0 border border-blue-100">
              <MapPin className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1 pr-1">
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-blue-600">
                <MapPin className="w-3.5 h-3.5" />
                <span>Customer Drop</span>
              </div>
              <h3 className="text-gray-950 text-base sm:text-lg font-bold leading-tight truncate mt-0.5">{customerName}</h3>
              {customerAddress ? (
                <p className="text-gray-500 text-xs font-medium mt-0.5 leading-snug line-clamp-2">{customerAddress}</p>
              ) : null}
              {customerPhone ? (
                <p className="text-gray-500 text-[11px] font-semibold mt-0.5">{customerPhone}</p>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2 shrink-0 ml-1">
            <button
              type="button"
              onClick={handleCallCustomer}
              className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100 active:scale-95 transition-all shadow-sm"
              aria-label="Call customer"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNavigateToCustomer}
              className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-md active:scale-95 transition-all"
              aria-label="Navigate to customer"
            >
              <Navigation className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Sliders */}
          <div className="space-y-4 sm:space-y-6">
          {!isAtPickup ? (
            <div>
              <p className="text-center text-[10px] font-bold uppercase tracking-widest mb-3 text-green-600">
                Ready - Swipe to confirm arrival
              </p>
              <ActionSlider 
                key="action-reach"
                label="Slide to Reach" 
                successLabel="Reached!"
                disabled={false}
                onConfirm={onReachedPickup}
                color="bg-green-600"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center items-center gap-3 w-full">
                 {!billImageUploaded && !isUploadingBill && (
                   <>
                      <button
                        onClick={handleTakeCameraPhoto}
                        className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-gray-900 text-white font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                      >
                        <Camera className="w-5 h-5" />
                        <span>Camera</span>
                      </button>
                      <button
                        onClick={handlePickFromGallery}
                        className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-orange-50 text-orange-600 border border-orange-100 font-bold text-[11px] sm:text-xs uppercase tracking-widest active:scale-95 transition-all"
                      >
                        <ImageIcon className="w-5 h-5" />
                        <span>Gallery</span>
                      </button>
                   </>
                 )}

                 {isUploadingBill && (
                    <div className="w-full flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-gray-50 text-gray-400 font-bold text-[11px] sm:text-xs uppercase tracking-widest">
                       <Loader2 className="w-4 h-4 animate-spin" />
                       <span>Uploading...</span>
                    </div>
                 )}

                 {billImageUploaded && (
                    <div className="w-full flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-green-100 text-green-700 font-bold text-[11px] sm:text-xs uppercase tracking-widest">
                       <CheckCircle2 className="w-4 h-4" />
                       <span>Bill Uploaded</span>
                    </div>
                 )}

                 <input
                   ref={cameraInputRef}
                   type="file"
                   accept="image/*"
                   onChange={(e) => handleBillImageSelect(e.target.files[0])}
                   className="hidden"
                 />
              </div>

              <div>
                <p className="text-center text-[10px] font-bold uppercase tracking-widest mb-3 text-green-600">
                  Swipe to pick up
                </p>
                <ActionSlider 
                  key="action-pickup"
                  label="Slide to Pick Up" 
                  successLabel="Picked Up!"
                  disabled={false}
                  onConfirm={() => onPickedUp(billImageUrl)}
                  color="bg-orange-500"
                />
              </div>
            </div>
          )}

          {/* Delivery Instructions (User Note) */}
          {order?.note && (
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3.5 sm:p-4 flex gap-3 items-start">
              <ChefHat className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-1.5">User Instructions</p>
                <p className="text-sm font-bold text-gray-800 leading-snug">"{order.note}"</p>
              </div>
            </div>
          )}

          {/* Collapsible Order Summary */}
          <button 
            onClick={() => setShowItems(!showItems)}
            className="w-full flex items-center justify-between p-3.5 sm:p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3 text-gray-900 font-bold text-xs uppercase tracking-widest">
              <Package className="w-5 h-5 text-gray-400" />
              <span>Order Details ({items.length || 0})</span>
            </div>
            {showItems ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          {showItems && (
            <div className="overflow-hidden space-y-2 px-1">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start p-3 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="text-gray-700 text-sm font-bold">{item.name || 'Item Name'}</span>
                    {item.variantName && (
                      <p className="text-xs text-gray-500 font-medium mt-0.5">{item.variantName}</p>
                    )}
                  </div>
                  <span className="text-green-600 font-bold bg-green-50 px-2.5 py-1 rounded-lg text-xs shrink-0 ml-2">x{item.quantity || 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default PickupActionModal;
