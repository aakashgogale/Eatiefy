import React, { useState, useEffect } from 'react';
import { ArrowLeft, Edit2, Loader2, Save } from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import useDeliveryBackNavigation from '../../hooks/useDeliveryBackNavigation';
import { showUserFacingApiError } from '@/shared/utils/apiError';
import { normalizeBankDetails, validateBankDetails, lookupIfsc, IFSC_REGEX } from '../../utils/bankDetails';

/**
 * ProfileBankV2 - Restored Old UI for Bank Details.
 */
export const ProfileBankV2 = () => {
  const goBack = useDeliveryBackNavigation();
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    accountHolderName: "",
    accountNumber: "",
    ifscCode: "",
    bankName: "",
    panNumber: ""
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const applyProfile = (profile) => {
    setForm({
      accountHolderName: profile?.documents?.bankDetails?.accountHolderName || "",
      accountNumber: profile?.documents?.bankDetails?.accountNumber || "",
      ifscCode: profile?.documents?.bankDetails?.ifscCode || "",
      bankName: profile?.documents?.bankDetails?.bankName || "",
      panNumber: profile?.documents?.pan?.number || ""
    });
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await deliveryAPI.getProfile();
        if (response?.data?.success) {
           applyProfile(response.data.data.profile);
        }
      } catch (e) { toast.error("Failed to load details"); }
      finally { setLoading(false); }
    };
    fetchProfile();
  }, []);

  /*
   * Saves through PATCH /profile/bank-details. This page used to post to
   * /profile/details, which only handles vehicle/photo fields, so the success
   * toast showed while nothing was stored and the old details returned on refresh.
   */
  const handleSave = async () => {
     if (!form.accountNumber || !form.ifscCode) {
        setErrors({
           ...(form.accountNumber ? {} : { accountNumber: "Account number is required" }),
           ...(form.ifscCode ? {} : { ifscCode: "IFSC code is required" }),
        });
        return toast.error("Account number and IFSC code are required");
     }
     const validationErrors = validateBankDetails(form);
     setErrors(validationErrors);
     const firstError = Object.values(validationErrors)[0];
     if (firstError) return toast.error(firstError);

     const normalized = normalizeBankDetails(form);
     setIsSaving(true);
     try {
        const payload = {
           documents: {
              bankDetails: {
                 accountHolderName: normalized.accountHolderName,
                 accountNumber: normalized.accountNumber,
                 ifscCode: normalized.ifscCode,
                 bankName: normalized.bankName
              },
              pan: { number: normalized.panNumber }
           }
        };
        const response = await deliveryAPI.updateProfile(payload);
        if (!response?.data?.success) {
           throw new Error(response?.data?.message || "Update failed");
        }
        // Show exactly what the server stored.
        const fresh = await deliveryAPI.refreshMe();
        applyProfile(fresh?.data?.data?.user ?? fresh?.data?.data);
        toast.success("Bank details updated");
        setIsEditing(false);
     } catch (e) { showUserFacingApiError(e, "Update failed"); }
     finally { setIsSaving(false); }
  };

  const handleChange = (key, rawValue) => {
     let value = rawValue;
     if (key === "accountNumber") value = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);
     if (key === "ifscCode") value = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 11);
     if (key === "panNumber") value = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
     setForm((prev) => ({ ...prev, [key]: value }));
     if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
     if (key === "ifscCode" && IFSC_REGEX.test(value)) {
        void lookupIfsc(value).then((info) => {
           if (!info?.bankName) return;
           setForm((prev) => (prev.ifscCode === value && !prev.bankName.trim() ? { ...prev, bankName: info.bankName } : prev));
        });
     }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 font-poppins">
       <div className="bg-white px-4 py-5 flex items-center gap-4 fixed top-0 w-full z-50 shadow-sm">
          <button onClick={goBack}><ArrowLeft className="w-6 h-6" /></button>
          <h1 className="text-xl font-black">Bank Details</h1>
          {!isEditing && (
             <button onClick={() => setIsEditing(true)} className="ml-auto p-2 bg-orange-50 text-orange-600 rounded-xl"><Edit2 className="w-4 h-4" /></button>
          )}
       </div>

       <div className="pt-24 px-4 pb-10 space-y-6">
          <div className="space-y-4">
             {Object.entries({
                "Account Holder": "accountHolderName",
                "Account Number": "accountNumber",
                "IFSC Code": "ifscCode",
                "Bank Name": "bankName",
                "PAN Number": "panNumber"
             }).map(([label, key]) => (
                <div key={key} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                   <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">{label}</label>
                   {isEditing ? (
                      <>
                        <input
                           type="text"
                           inputMode={key === "accountNumber" ? "numeric" : undefined}
                           autoComplete="off"
                           autoCapitalize={key === "ifscCode" || key === "panNumber" ? "characters" : undefined}
                           value={form[key]}
                           onChange={(e) => handleChange(key, e.target.value)}
                           className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-sm font-bold text-gray-950 focus:ring-2 focus:ring-orange-500/20 ${errors[key] ? "border-red-300" : "border-gray-100"}`}
                        />
                        {errors[key] && <p className="mt-1.5 text-[11px] font-semibold text-red-500">{errors[key]}</p>}
                      </>
                   ) : (
                      <p className="text-sm font-bold text-gray-950">{form[key] || "Not provided"}</p>
                   )}
                </div>
             ))}
          </div>

          {isEditing && (
             <button 
               onClick={handleSave}
               disabled={isSaving}
               className="w-full bg-black text-white py-5 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center gap-2"
             >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                Save Changes
             </button>
          )}
       </div>
    </div>
  );
};
