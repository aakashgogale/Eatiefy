import React, { useState, useEffect } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import useDeliveryBackNavigation from '../../hooks/useDeliveryBackNavigation';

/**
 * MyReviewsV2 - Reviews given by customers to the logged-in delivery partner.
 */
export const MyReviewsV2 = () => {
  const goBack = useDeliveryBackNavigation();
  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const response = await deliveryAPI.getMyReviews({ limit: 200 });
        if (response?.data?.success) {
          const data = response.data.data || {};
          setReviews(data.reviews || []);
          setAverageRating(data.averageRating || 0);
          setTotal(data.total || 0);
        }
      } catch (error) {
        toast.error('Failed to load reviews');
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, []);

  const renderStars = (rating) => {
    const count = Math.round(rating || 0);
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`w-4 h-4 ${s <= count ? 'fill-amber-400 text-amber-400' : 'text-gray-300 fill-none'}`}
          />
        ))}
      </div>
    );
  };

  const formatDate = (value) => {
    if (!value) return '';
    try {
      const d = new Date(value);
      return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="min-h-screen bg-white font-poppins pb-20">
      {/* Header */}
      <div className="bg-white px-4 py-5 flex items-center gap-3 fixed top-0 w-full z-50 shadow-sm border-b border-gray-50">
        <button onClick={goBack} className="p-1 hover:bg-gray-50 rounded-full">
          <ArrowLeft className="w-6 h-6 text-gray-950" />
        </button>
        <Star className="w-5 h-5 text-orange-500" />
        <h1 className="text-xl font-black text-gray-950">My Reviews</h1>
        {!loading && (
          <span className="ml-auto px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
            {total}
          </span>
        )}
      </div>

      <div className="pt-24 px-4 space-y-4">
        {loading ? (
          <>
            {/* Average rating skeleton */}
            <div className="bg-slate-50 rounded-2xl p-5 flex items-center justify-between">
              <div className="space-y-2">
                <span className="block w-24 h-3 rounded bg-slate-200 animate-pulse" />
                <span className="block w-16 h-6 rounded bg-slate-200 animate-pulse" />
              </div>
              <span className="w-28 h-5 rounded bg-slate-200 animate-pulse" />
            </div>
            {/* Review card skeletons */}
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="border border-slate-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="w-28 h-4 rounded bg-slate-200 animate-pulse" />
                  <span className="w-20 h-4 rounded bg-slate-200 animate-pulse" />
                </div>
                <span className="block w-full h-3 rounded bg-slate-200 animate-pulse" />
                <span className="block w-2/3 h-3 rounded bg-slate-200 animate-pulse" />
              </div>
            ))}
          </>
        ) : reviews.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Star className="w-10 h-10 text-gray-200" />
            <p className="text-sm font-bold text-gray-400">No reviews yet</p>
            <p className="text-xs text-gray-400 text-center px-8">
              Once customers rate your deliveries, their reviews will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Average rating summary */}
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Average Rating</p>
                <p className="text-3xl font-black text-amber-700 mt-1 flex items-center gap-1.5">
                  {averageRating || '—'}
                  <Star className="w-6 h-6 fill-amber-400 text-amber-400" />
                </p>
              </div>
              {renderStars(averageRating)}
            </div>

            {/* Reviews list */}
            {reviews.map((r, idx) => (
              <div key={r.orderId || idx} className="border border-slate-100 rounded-2xl p-4 space-y-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-900">{r.customer}</span>
                  {renderStars(r.rating)}
                </div>
                {r.review ? (
                  <p className="text-sm text-gray-600 leading-relaxed">{r.review}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No written feedback</p>
                )}
                <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium pt-1">
                  {r.orderId && <span className="font-mono">#{r.orderId}</span>}
                  <span>{formatDate(r.submittedAt || r.deliveredAt)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default MyReviewsV2;
