import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, DollarSign, CheckCircle2,
  QrCode, Loader2, X, RefreshCw, Package
} from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { showUserFacingApiError } from '@/shared/utils/apiError';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useKeyboardAwareSheet } from '@food/hooks/useIsKeyboardOpen';

const Backdrop = ({ onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-black/40 -z-10 pointer-events-auto"
    onClick={onClose}
  />
);

export const extractUserNote = (order) => {
  if (!order) return '';
  if (typeof order.note === 'string' && order.note.trim()) return order.note.trim();
  if (typeof order.userNote === 'string' && order.userNote.trim()) return order.userNote.trim();
  if (typeof order.customerNote === 'string' && order.customerNote.trim()) return order.customerNote.trim();
  if (typeof order.deliveryNote === 'string' && order.deliveryNote.trim()) return order.deliveryNote.trim();
  if (typeof order.deliveryInstructions === 'string' && order.deliveryInstructions.trim()) return order.deliveryInstructions.trim();
  if (typeof order.deliveryInstruction === 'string' && order.deliveryInstruction.trim()) return order.deliveryInstruction.trim();
  if (typeof order.instructions === 'string' && order.instructions.trim()) return order.instructions.trim();
  if (typeof order.orderNotes === 'string' && order.orderNotes.trim()) return order.orderNotes.trim();
  if (typeof order.restaurantNote === 'string' && order.restaurantNote.trim()) return order.restaurantNote.trim();
  if (typeof order.deliveryAddress?.deliveryInstructions === 'string' && order.deliveryAddress.deliveryInstructions.trim()) return order.deliveryAddress.deliveryInstructions.trim();
  if (typeof order.deliveryAddress?.instructions === 'string' && order.deliveryAddress.instructions.trim()) return order.deliveryAddress.instructions.trim();
  if (typeof order.deliveryAddress?.note === 'string' && order.deliveryAddress.note.trim()) return order.deliveryAddress.note.trim();
  if (typeof order.address?.deliveryInstructions === 'string' && order.address.deliveryInstructions.trim()) return order.address.deliveryInstructions.trim();
  if (typeof order.address?.instructions === 'string' && order.address.instructions.trim()) return order.address.instructions.trim();
  if (typeof order.address?.note === 'string' && order.address.note.trim()) return order.address.note.trim();
  return '';
};

const DeliveryInstructionsPanel = ({ note, order }) => {
  const text = String(note || extractUserNote(order) || '').trim();
  if (!text) return null;

  return (
    <div className="w-full rounded-2xl sm:rounded-3xl mb-6 overflow-hidden border border-orange-200 bg-orange-50/70 shadow-sm">
      <div className="bg-orange-500 bg-gradient-to-r from-orange-500 to-amber-500 px-4 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-white/20 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shrink-0">
            <Package className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div>
            <p className="text-[11px] font-black text-white uppercase tracking-[0.15em] leading-tight">
              User Note / Delivery Instruction
            </p>
            <p className="text-[10px] sm:text-[11px] font-semibold text-white/95 leading-tight">
              Read before handover
            </p>
          </div>
        </div>
      </div>
      <div className="bg-orange-50 px-4 sm:px-5 py-3.5 sm:py-4">
        <p className="text-sm font-bold text-gray-950 leading-relaxed break-words">
          “{text}”
        </p>
      </div>
    </div>
  );
};

const OtpModal = ({ order, onVerified, onClose }) => {
  const [otp, setOtp] = useState(['', '', '', '']);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const inputRefs = [useRef(), useRef(), useRef(), useRef()];
  // Keeps the handover-code inputs above the on-screen keyboard.
  const { keyboardOpen, sheetProps } = useKeyboardAwareSheet({ gap: 12 });

  useEffect(() => {
    const savedCode = order?.deliveryVerification?.dropOtp?.code;
    if (savedCode && String(savedCode).length === 4) {
      setOtp(String(savedCode).split(''));
    }
    const timer = setTimeout(() => {
      inputRefs[0].current?.focus();
    }, 500);
    return () => clearTimeout(timer);
  }, [order?.deliveryVerification?.dropOtp?.code]);

  const orderId = order?.orderId || order?._id || 'ORD';

  const handleOtpChange = (index, rawValue) => {
    const value = String(rawValue || '').replace(/\D/g, '');
    // Pasted or autofilled full code: spread it across the boxes.
    if (value.length > 1) {
      const digits = value.slice(0, 4 - index).split('');
      const newOtp = [...otp];
      digits.forEach((d, i) => { newOtp[index + i] = d; });
      setOtp(newOtp);
      inputRefs[Math.min(index + digits.length, 3)].current?.focus();
      return;
    }
    if (rawValue && !value) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    if (value && index < 3) inputRefs[index + 1].current?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs[index - 1].current?.focus();
  };

  const verifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length < 4) return;
    setIsVerifyingOtp(true);
    try {
      const res = await deliveryAPI.verifyDropOtp(orderId, otpString);
      if (res?.data?.success) {
        setIsOtpVerified(true);
        // toast.success("OTP Verified Successfully");
        setTimeout(() => onVerified(otpString), 600);
      }
    } catch (err) {
      showUserFacingApiError(err, 'Invalid OTP entered');
      throw err;
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const isAlreadyVerified = order?.deliveryVerification?.dropOtp?.verified;

  return (
    <div
      className="fixed inset-0 z-120 p-0 sm:p-4 flex items-end justify-center pointer-events-none"
      // Shrink the overlay to the area above the keyboard so the sheet sits on top of it.
      style={keyboardOpen ? { bottom: sheetProps.style.bottom } : undefined}
    >
      <Backdrop onClose={onClose} />
      <motion.div
        ref={sheetProps.ref}
        onFocusCapture={sheetProps.onFocusCapture}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        style={keyboardOpen ? { maxHeight: sheetProps.style.maxHeight } : undefined}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-6 sm:pb-12 pointer-events-auto max-h-[84vh] overflow-y-auto overscroll-contain"
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isOtpVerified ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Handover Code</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Step 1 of Verification</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <DeliveryInstructionsPanel order={order} note={order?.note} />

        <div className="flex justify-center gap-2.5 sm:gap-3 mb-6 sm:mb-8">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              aria-label={`Handover code digit ${i + 1}`}
              disabled={isOtpVerified}
              value={digit}
              onChange={(e) => handleOtpChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={`w-12 sm:w-14 h-16 sm:h-18 bg-gray-50 border-2 rounded-2xl text-center text-2xl sm:text-3xl font-bold transition-all ${isOtpVerified ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 focus:border-green-600 text-gray-700'
                }`}
            />
          ))}
        </div>

        <ActionSlider
          key="action-otp"
          label={isVerifyingOtp ? "Verifying..." : isAlreadyVerified ? "Code already verified ✓" : "Slide to Verify OTP"}
          successLabel="Verified!"
          disabled={otp.some(d => !d) || isVerifyingOtp || isOtpVerified || isAlreadyVerified}
          onConfirm={verifyOtp}
          color="bg-gray-900"
        />
      </motion.div>
    </div>
  );
};

const PaymentModal = ({ order, otpString, onComplete, onClose }) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [collectQrLink, setCollectQrLink] = useState(null);
  const [cropView, setCropView] = useState(true);
  const [qrDetails, setQrDetails] = useState({
    imageUrl: null,
    rawImageUrl: null,
    qrDataUrl: null,
    rawBase64: null,
    upiUri: null,
    isPoster: true,
  });
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const isInitialPaid = ['paid', 'captured', 'authorized'].includes(String(order?.payment?.status || "").toLowerCase());
  const [paymentStatus, setPaymentStatus] = useState(isInitialPaid ? 'paid' : 'idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const pollingRef = useRef(null);

  const orderId = order?._id || order?.orderId || order?.order_id || 'ORD';
  const amountToCollect = Number(order?.pricing?.total ?? order?.amountToCollect ?? order?.total ?? order?.amount ?? 0);

  const checkPaymentSync = useCallback(async () => {
    try {
      const res = await deliveryAPI.getPaymentStatus(orderId);
      const data = res?.data?.data || res?.data || {};
      const status = String(data?.payment?.status || data?.status || "").toLowerCase();
      const isPaidResponse = Boolean(data?.isPaid || ['paid', 'captured', 'authorized'].includes(status));
      if (isPaidResponse) {
        setPaymentStatus('paid');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        toast.success("Payment Received Successfully via Razorpay!");
        setShowQrModal(false);
        // Auto-close modal and confirm order upon successful payment
        if (onComplete) {
          setTimeout(() => {
            onComplete(otpString, 'qr');
          }, 400);
        }
      }
    } catch (e) {
      console.warn('[PaymentModal] Error checking payment status:', e?.message || e);
    }
  }, [orderId, onComplete, otpString]);

  const handleManualCheck = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await deliveryAPI.getPaymentStatus(orderId);
      const data = res?.data?.data || res?.data || {};
      const status = String(data?.payment?.status || data?.status || "").toLowerCase();
      const isPaidResponse = Boolean(data?.isPaid || ['paid', 'captured', 'authorized'].includes(status));
      if (isPaidResponse) {
        setPaymentStatus('paid');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        toast.success("Payment Received Successfully via Razorpay!");
        setShowQrModal(false);
        if (onComplete) {
          setTimeout(() => {
            onComplete(otpString, 'qr');
          }, 400);
        }
      } else {
        toast.info("Payment not detected yet. Please ensure customer completed payment.");
      }
    } catch (e) {
      toast.error("Could not sync payment status");
    } finally {
      setIsSyncing(false);
    }
  };

  // Automatic 5-second interval timer that polls payment status while modal is active
  useEffect(() => {
    if (!showQrModal || paymentStatus === 'paid') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(() => {
      checkPaymentSync();
    }, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [showQrModal, paymentStatus, checkPaymentSync]);

  const generateQr = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await deliveryAPI.createCollectQr(orderId, {
        name: order?.userName || order?.customerName || order?.userId?.name || 'Customer',
        phone: order?.userPhone || order?.customerPhone || order?.userId?.phone || ''
      });
      const data = res?.data?.data || res?.data || {};
      const img = data.imageUrl || data.rawImageUrl || null;
      const upi = data.upiUri || (String(data.shortUrl || '').startsWith('upi://') ? data.shortUrl : null);

      setQrDetails({
        imageUrl: img,
        rawImageUrl: data.rawImageUrl || null,
        qrDataUrl: data.qrDataUrl || null,
        rawBase64: data.rawBase64 || null,
        upiUri: upi,
        isPoster: data.isPoster !== undefined ? Boolean(data.isPoster) : false,
      });

      // Prefer the clean UPI intent for the scanner; only accept a link as a
      // last resort if it is a upi:// or data-image (never an rzp.io web link).
      const link = upi || (img && (img.startsWith('data:image/') || img.startsWith('upi://')) ? img : null) || null;
      if (upi || (img && (img.startsWith('data:image/'))) || data.qrDataUrl) {
        setCollectQrLink(link);
        setPaymentStatus('pending');
        setShowQrModal(true);
      } else {
        toast.error("Could not generate a direct UPI QR. Please retry or collect cash.");
      }
    } catch (e) {
      console.error('[PaymentModal] QR Generation failed:', e);
      showUserFacingApiError(e, "QR Generation failed");
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const isPaid = paymentStatus === 'paid';
  const [isCashPayment, setIsCashPayment] = useState(false);

  // Toggle handlers
  const handleCashSelection = () => {
    setIsCashPayment(true);
  };

  const handleQrSelection = () => {
    setIsCashPayment(false);
    generateQr();
  };

  const qrImageSrc = useMemo(() => {
    // The scanner MUST get a QR that encodes the raw `upi://pay?...` intent so it
    // opens GPay/PhonePe/Paytm directly. We never render — nor re-encode — a
    // Razorpay rzp.io poster/link, because scanning that only opens a web redirect.

    // 1. Prefer the real UPI intent string: encode it ourselves.
    if (qrDetails.upiUri && qrDetails.upiUri.startsWith('upi://')) {
      return `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=10&data=${encodeURIComponent(qrDetails.upiUri)}`;
    }
    // 2. Server-regenerated clean QR matrix (data URL of the upi:// QR).
    if (qrDetails.qrDataUrl && qrDetails.qrDataUrl.startsWith('data:image/')) {
      return qrDetails.qrDataUrl;
    }
    // 3. Direct base64 / clean image URLs produced by our backend.
    if (qrDetails.imageUrl && (qrDetails.imageUrl.startsWith('data:image/') || qrDetails.imageUrl.includes('/qr-image'))) {
      return qrDetails.imageUrl;
    }
    if (qrDetails.rawImageUrl && qrDetails.rawImageUrl.startsWith('data:image/')) {
      return qrDetails.rawImageUrl;
    }
    // 4. Fallback to collectQrLink ONLY when it is itself a UPI intent or a data image.
    if (collectQrLink) {
      if (collectQrLink.startsWith('data:image/')) return collectQrLink;
      if (collectQrLink.startsWith('upi://')) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=10&data=${encodeURIComponent(collectQrLink)}`;
      }
    }
    // Never fall back to encoding an http(s)/rzp.io link — that is the broken
    // "opens a web page" behaviour we are fixing.
    return '';
  }, [qrDetails, collectQrLink]);

  return (
    <>
      <div className="fixed inset-0 z-120 p-0 sm:p-4 flex items-end justify-center pointer-events-none">
        <Backdrop onClose={onClose} />
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-6 sm:pb-12 pointer-events-auto max-h-[84vh] overflow-y-auto"
        >
          <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isPaid ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                <DollarSign className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Collect Payment</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Step 2 of Verification</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <DeliveryInstructionsPanel order={order} note={order?.note} />

          <div className="bg-amber-50 rounded-3xl p-4 sm:p-6 border border-amber-100 mb-6 sm:mb-8">
            <div className="flex justify-between items-center mb-6">
              <div>
                <p className="text-amber-700 text-[10px] font-bold uppercase tracking-widest mb-1">
                  {isPaid ? "Amount Paid Online" : "Cash to Collect"}
                </p>
                <p className="text-amber-950 text-3xl sm:text-4xl font-bold">₹{amountToCollect.toFixed(2)}</p>
              </div>
              {isPaid && <div className="bg-green-500 text-white px-4 py-2 rounded-full text-[10px] font-bold">PAID ✓</div>}
            </div>

            {!isPaid && (
              <div className="space-y-3">
                <button
                  onClick={handleQrSelection}
                  disabled={isGeneratingQr}
                  className={`w-full py-3.5 sm:py-4 border-2 rounded-2xl font-bold text-[11px] sm:text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${!isCashPayment && paymentStatus === 'pending'
                    ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-inner'
                    : 'bg-white border-amber-200 text-amber-800'
                    }`}
                >
                  {isGeneratingQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-5 h-5" />}
                  {paymentStatus === 'pending' && !isCashPayment ? 'QR Active - Waiting...' : 'Show Payment QR'}
                </button>

                <button
                  onClick={handleCashSelection}
                  className={`w-full py-3.5 sm:py-4 border-2 rounded-2xl font-bold text-[11px] sm:text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${isCashPayment
                    ? 'bg-[#15498b] border-[#15498b] text-white shadow-lg shadow-[#15498b]/30'
                    : 'bg-white border-amber-200 text-amber-800'
                    }`}
                >
                  <DollarSign className="w-5 h-5" />
                  Cash Payment
                </button>
              </div>
            )}
          </div>

          {/* If the driver collects physical cash, they can directly slide this, bypassing QR. Unless cash is selected or it's paid, lock slider. */}
          <ActionSlider
            key="action-payment"
            label={isCashPayment ? "Slide to Confirm Cash" : "Slide to Complete Order"}
            successLabel="Delivered! ✓"
            disabled={!isPaid && !isCashPayment}
            onConfirm={async () => {
              try {
                // Pass the payment method to completion if needed
                await onComplete(otpString, isCashPayment ? 'cash' : 'qr');
              } catch (e) {
                // Slider handles reset
                throw e;
              }
            }}
            color="bg-green-600"
          />
        </motion.div>
      </div>

      <AnimatePresence>
        {showQrModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-200 bg-black/80 flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
            onClick={() => setShowQrModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-5 sm:p-7 flex flex-col items-center text-center shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 text-emerald-600 text-[11px] font-bold tracking-wider uppercase mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Live Dynamic UPI QR
              </div>
              <h3 className="text-gray-950 font-black text-xl mb-1">Scan to Pay</h3>
              <p className="text-gray-500 text-sm mb-4 font-semibold">Amount to Pay: <span className="text-gray-950 font-bold">₹{amountToCollect.toFixed(2)}</span></p>

              <div className="flex flex-col items-center gap-3 bg-gray-50 rounded-3xl border-2 border-gray-100 p-4 mb-4 w-full">
                {/* Fixed square container with rounded corners, border, and hidden overflow */}
                <div className="relative w-64 h-64 sm:w-72 sm:h-72 aspect-square rounded-2xl sm:rounded-3xl border-2 border-gray-200 bg-white shadow-sm overflow-hidden flex items-center justify-center">
                  {qrImageSrc ? (
                    <img
                      src={qrImageSrc}
                      alt="Scan to Pay QR"
                      className={`w-full h-full transition-transform duration-300 ${
                        cropView && qrDetails.isPoster
                          ? 'object-cover scale-[1.7] -translate-y-[2%] object-center'
                          : 'object-contain p-2 scale-100'
                      }`}
                      onError={(e) => {
                        console.warn('[PaymentModal] Primary QR image error, checking fallback');
                        if (qrDetails.rawBase64 && e.currentTarget.src !== qrDetails.rawBase64) {
                          e.currentTarget.src = qrDetails.rawBase64;
                          return;
                        }
                        if (qrDetails.qrDataUrl && e.currentTarget.src !== qrDetails.qrDataUrl) {
                          e.currentTarget.src = qrDetails.qrDataUrl;
                          return;
                        }
                        if (qrDetails.upiUri && !e.currentTarget.src.includes(encodeURIComponent(qrDetails.upiUri))) {
                          e.currentTarget.src = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=10&data=${encodeURIComponent(qrDetails.upiUri)}`;
                          return;
                        }
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 text-gray-400">
                      <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                      <p className="text-xs font-semibold">Generating QR Code...</p>
                    </div>
                  )}
                </div>

                {qrDetails.isPoster && (
                  <button
                    type="button"
                    onClick={() => setCropView(prev => !prev)}
                    className="text-[11px] font-bold text-gray-500 hover:text-gray-800 transition-colors py-0.5 px-2.5 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <span>{cropView ? "Cropped QR Matrix View" : "Full Poster View"}</span>
                    <span className="text-gray-400 font-normal">({cropView ? "tap for full" : "tap to crop"})</span>
                  </button>
                )}

                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider py-1 px-3 bg-white rounded-full border border-gray-200 w-full">
                  <span>GPay</span>
                  <span>•</span>
                  <span>PhonePe</span>
                  <span>•</span>
                  <span>Paytm</span>
                  <span>•</span>
                  <span>BHIM UPI</span>
                </div>

                <button
                  onClick={handleManualCheck}
                  disabled={isSyncing}
                  className="w-full flex gap-2 items-center justify-center bg-[#15498b] hover:bg-[#0f3568] text-white px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-[#15498b]/30 active:scale-95 transition-all disabled:opacity-60"
                >
                  {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Check Payment Status
                </button>
              </div>

              <button
                onClick={() => setShowQrModal(false)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs uppercase tracking-widest active:scale-95 transition-all"
              >
                Close QR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const DeliveryVerificationModal = ({ order, onComplete, onClose }) => {
  const alreadyVerified = !!order?.deliveryVerification?.dropOtp?.verified;
  const paymentMethod = (
    order?.paymentMethod ||
    order?.payment?.method ||
    order?.transaction?.payment?.method ||
    order?.transaction?.paymentMethod ||
    'cod'
  ).toLowerCase();
  const isCod = ['cash', 'cod', 'cash_on_delivery', 'razorpay_qr'].includes(paymentMethod);

  // Determine initial step: skip OTP if already verified
  const [step, setStep] = useState(() => {
    if (alreadyVerified) {
      return isCod ? 'payment' : 'complete';
    }
    return 'otp';
  });
  const [verifiedOtp, setVerifiedOtp] = useState(() => (alreadyVerified ? (order?.deliveryVerification?.dropOtp?.code || '') : ''));

  const handleOtpVerified = (otpValue) => {
    setVerifiedOtp(otpValue);
    // After OTP is verified: COD → show payment panel, Online → show complete button
    setStep(isCod ? 'payment' : 'complete');
  };

  // If OTP was already verified on mount and it's a non-COD order, auto-complete
  useEffect(() => {
    if (step === 'complete' && !isCod && order) {
      onComplete(verifiedOtp);
    }
  }, []); // only on mount

  if (!order) return null;

  return (
    <AnimatePresence mode="wait">
      {step === 'otp' && (
        <OtpModal
          key="otp-modal"
          order={order}
          onVerified={handleOtpVerified}
          onClose={onClose || (() => { })}
        />
      )}
      {step === 'payment' && (
        <PaymentModal
          key="payment-modal"
          order={order}
          otpString={verifiedOtp}
          onComplete={onComplete}
          onClose={onClose || (() => { })}
        />
      )}
      {step === 'complete' && (
        <div className="fixed inset-0 z-120 p-0 sm:p-4 flex items-end justify-center pointer-events-none">
          <Backdrop onClose={onClose || (() => { })} />
          <motion.div
            key="complete-modal"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-6 sm:pb-12 pointer-events-auto max-h-[84vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-green-100 text-green-600">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">OTP Verified</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">Payment Received Online</p>
              </div>
            </div>
            <ActionSlider
              key="action-complete"
              label="Slide to Complete Delivery"
              successLabel="Delivered! ✓"
              onConfirm={async () => {
                await onComplete(verifiedOtp);
              }}
              color="bg-green-600"
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
