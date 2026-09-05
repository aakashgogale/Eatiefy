import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, User, Phone, CheckCircle2, Loader2 } from 'lucide-react';
import AnimatedPage from "@food/components/user/AnimatedPage";

export default function TableEditUserPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, restaurant, guests, date, timeSlot, discount, specialRequest } = location.state || {};

    const initialName = user?.name || "";
    const initialPhone = user?.phone || "";

    const [name, setName] = useState(initialName);
    const [phone, setPhone] = useState(initialPhone);
    const [saving, setSaving] = useState(false);

    const hasChanged = name !== initialName || phone !== initialPhone;

    const handleSave = () => {
        if (saving || !hasChanged) return;
        setSaving(true);
        setTimeout(() => {
            navigate("/food/user/dining/book-confirmation", {
                state: {
                    restaurant,
                    guests,
                    date,
                    timeSlot,
                    discount,
                    specialRequest,
                    user: { ...user, name, phone }
                },
                replace: true
            });
        }, 600);
    };

    return (
        <AnimatedPage className="min-h-screen bg-[#f8f9fa] dark:bg-[#0d0d0d] pb-20">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-white/80 dark:bg-[#0d0d0d]/80 backdrop-blur-xl border-b border-slate-100 dark:border-white/5">
                <div className="max-w-lg mx-auto px-4 h-16 flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 dark:bg-[#1e1e1e] text-slate-900 dark:text-white active:scale-90 transition-all"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Edit Details</h1>
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
                <div className="text-center space-y-2">
                    <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white dark:border-[#1a1a1a] shadow-xl shadow-red-100 dark:shadow-none">
                        <User className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Personalize Booking</h2>
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-[0.15em]">Contact details for the restaurant</p>
                </div>

                <div className="space-y-6">
                    {/* Name Input */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-2">Full Name</label>
                        <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                <User className="w-5 h-5" />
                            </div>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z\s]/g, ""))}
                                placeholder="Enter your full name"
                                className="w-full h-14 pl-12 pr-4 bg-white dark:bg-[#1a1a1a] border border-slate-100 dark:border-white/10 rounded-2xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-[#DC2626] transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
                            />
                        </div>
                    </div>

                    {/* Phone Input */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-2">Mobile Number</label>
                        <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                <Phone className="w-5 h-5" />
                            </div>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="Enter mobile number"
                                className="w-full h-14 pl-12 pr-4 bg-white dark:bg-[#1a1a1a] border border-slate-100 dark:border-white/10 rounded-2xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-[#DC2626] transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
                            />
                        </div>
                    </div>
                </div>

                <div className="pt-10">
                    <button
                        onClick={handleSave}
                        disabled={saving || !hasChanged}
                        className={`w-full h-14 rounded-2xl font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-3 ${
                            hasChanged && !saving
                                ? "bg-gradient-to-br from-[#DC2626] to-[#7f1010] text-white active:scale-95 shadow-[0_4px_16px_rgba(220,38,38,0.4)]"
                                : "bg-[#2a1a1a] dark:bg-[#1e1414] text-[#7a4040] cursor-not-allowed"
                        }`}
                    >
                        {saving ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <CheckCircle2 className="w-5 h-5" />
                        )}
                        {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                        onClick={() => navigate(-1)}
                        className="w-full h-14 mt-4 bg-slate-100 dark:bg-[#1e1e1e] text-slate-500 dark:text-slate-400 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </AnimatedPage>
    );
}
