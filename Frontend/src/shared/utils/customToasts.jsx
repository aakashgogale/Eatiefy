import React from "react";
import { Trash2, CheckCircle2, Bell } from "lucide-react";
import { toast } from "sonner";

const NOTIF_TOAST_ID = "app-notification-toast";

export const showNotificationToast = ({ title, message } = {}) => {
  toast.dismiss(NOTIF_TOAST_ID);
  toast.custom(() => (
    <div className="w-[calc(100vw-32px)] sm:w-[380px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-3xl pointer-events-auto flex items-center gap-4 p-3.5 border border-gray-50 animate-in fade-in slide-in-from-top-4">
      <div className="flex-shrink-0">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center shadow-lg">
          <img
            src="/assets/images/ometto-toast-logo.png"
            alt="Ometto"
            className="w-7 h-7 object-contain brightness-0 invert"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
          <Bell className="w-5 h-5 text-white hidden" />
        </div>
      </div>
      <div className="flex-1 pr-1 min-w-0">
        <p className="text-[13px] font-bold text-gray-900 leading-tight truncate">{title || "Notification"}</p>
        {message && (
          <p className="text-[12px] font-medium text-gray-500 mt-0.5 line-clamp-2 leading-snug">{message}</p>
        )}
      </div>
    </div>
  ), {
    id: NOTIF_TOAST_ID,
    duration: 6000,
    position: 'top-center',
  });
};

export const showOmettoBrandedToast = ({ title, message, id = "ometto-branded-toast", duration = 4000 } = {}) => {
  toast.custom(
    () => (
      <div className="w-[calc(100vw-32px)] sm:w-[380px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-3xl pointer-events-auto flex items-center gap-4 p-3.5 border border-gray-50 animate-in fade-in slide-in-from-top-4 z-[11000]">
        <div className="flex-shrink-0">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center p-1.5 shadow-lg">
            <img
              src="/assets/images/ometto-toast-logo.png"
              alt="Ometto"
              className="w-full h-full object-contain brightness-0 invert"
            />
          </div>
        </div>
        <div className="flex-1 pr-2 min-w-0">
          <p className="text-[14px] font-bold text-gray-800 leading-tight">{title}</p>
          {message ? (
            <p className="text-[13px] font-medium text-gray-500 mt-1">{message}</p>
          ) : null}
        </div>
      </div>
    ),
    {
      id,
      duration,
      position: "top-center",
    }
  );
};

export const showAddressRemovedToast = () => {
  showOmettoBrandedToast({
    title: "Address Removed Successfully",
    id: "address-removed-toast",
  });
};

export const showAccountDeletedToast = () => {
  toast.custom(() => (
    <div className="flex items-center gap-3 bg-[#f0fdf4] border border-[#bbf7d0] px-4 py-3 rounded-xl shadow-lg min-w-[300px] animate-in fade-in slide-in-from-top-4">
      <div className="relative">
        <Trash2 className="w-6 h-6 text-[#ef4444]" />
        <div className="absolute -top-1 -right-1 bg-white rounded-full">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#22c55e] fill-[#22c55e] stroke-white" />
        </div>
      </div>
      <p className="text-[#15803d] font-bold text-sm">Account Deleted successfully</p>
    </div>
  ), {
    duration: 4000,
  });
};
