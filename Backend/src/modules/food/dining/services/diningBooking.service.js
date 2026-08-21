import mongoose from 'mongoose';
import { FoodDiningBooking } from '../models/diningBooking.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { notifyOwnerSafely } from '../../../../core/notifications/firebase.service.js';

// Format database booking document into the exact JSON shape required by the frontend
function formatBooking(bookingDoc) {
    if (!bookingDoc) return null;
    const booking = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;
    
    // Format restaurant details
    let restaurantObj = null;
    if (booking.restaurantId && typeof booking.restaurantId === 'object') {
        const rest = booking.restaurantId;
        const coverImage = Array.isArray(rest.coverImages)
            ? rest.coverImages.map(img => typeof img === 'string' ? img : img?.url || '').find(Boolean)
            : '';
        const profilePhoto = typeof rest.profileImage === 'string'
            ? rest.profileImage
            : (rest.profileImage?.url || '');

        restaurantObj = {
            _id: rest._id,
            id: rest._id,
            name: rest.restaurantName || rest.name || 'Restaurant',
            restaurantName: rest.restaurantName || rest.name || 'Restaurant',
            profileImage: rest.profileImage || null,
            image: coverImage || profilePhoto || '',
            location: rest.location || null,
            slug: rest.slug || ''
        };
    } else if (booking.restaurantId) {
        restaurantObj = {
            _id: booking.restaurantId,
            id: booking.restaurantId,
            name: 'Restaurant',
            restaurantName: 'Restaurant',
            profileImage: null,
            image: '',
            location: null,
            slug: ''
        };
    }

    // Format user details
    let userObj = null;
    if (booking.userId && typeof booking.userId === 'object') {
        const u = booking.userId;
        userObj = {
            _id: u._id,
            id: u._id,
            name: booking.customerName || u.name || 'Guest',
            phone: booking.customerPhone || u.phone || '',
            email: u.email || ''
        };
    } else if (booking.userId) {
        userObj = {
            _id: booking.userId,
            id: booking.userId,
            name: booking.customerName || 'Guest',
            phone: booking.customerPhone || '',
            email: ''
        };
    }

    return {
        _id: booking._id,
        id: booking._id,
        bookingId: booking.bookingId,
        restaurantId: booking.restaurantId?._id || booking.restaurantId,
        restaurant: restaurantObj,
        userId: booking.userId?._id || booking.userId,
        user: userObj,
        customerName: booking.customerName || userObj?.name || '',
        customerPhone: booking.customerPhone || userObj?.phone || '',
        guests: booking.guests,
        date: booking.date,
        timeSlot: booking.timeSlot,
        specialRequest: booking.specialRequest || '',
        pricingModel: booking.pricingModel || 'free',
        bookingFee: Number(booking.bookingFee || 0),
        coverChargePerPerson: Number(booking.coverChargePerPerson || 0),
        totalAmount: Number(booking.totalAmount || 0),
        costForTwo: booking.costForTwo || '',
        offer: booking.offer || '',
        status: booking.status || 'pending',
        review: booking.review || null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
    };
}

export async function createBooking(userId, payload) {
    const rawRestaurantId = payload.restaurant || payload.restaurantId || payload.restaurantRef?._id || payload.restaurantRef?.id;
    if (!rawRestaurantId) {
        throw new Error('Valid Restaurant ID is required');
    }

    let restaurant = null;
    if (mongoose.Types.ObjectId.isValid(rawRestaurantId)) {
        restaurant = await FoodRestaurant.findById(rawRestaurantId).lean();
    }
    if (!restaurant) {
        restaurant = await FoodRestaurant.findOne({
            $or: [
                { slug: String(rawRestaurantId) },
                { restaurantName: new RegExp(`^${rawRestaurantId}$`, 'i') },
                { name: new RegExp(`^${rawRestaurantId}$`, 'i') }
            ]
        }).lean();
    }
    if (!restaurant) {
        throw new Error('Restaurant not found');
    }

    const restaurantId = restaurant._id;

    // Calculate dynamic booking and cover charges based on restaurant's dining settings
    const guests = Math.max(1, Number(payload.guests) || 1);
    const pricingModel = restaurant?.diningSettings?.pricingModel || 'free';
    const bookingFee = pricingModel === 'fixed_fee' ? Number(restaurant?.diningSettings?.bookingFee || 0) : 0;
    const coverChargePerPerson = pricingModel === 'cover_charge' ? Number(restaurant?.diningSettings?.coverChargePerPerson || 0) : 0;
    const totalAmount = pricingModel === 'fixed_fee'
        ? bookingFee
        : (pricingModel === 'cover_charge' ? coverChargePerPerson * guests : 0);

    // Generate unique display-friendly booking ID: TB + 8 digits
    const uniqueDigits = Math.floor(10000000 + Math.random() * 90000000);
    const bookingId = `TB${uniqueDigits}`;

    const newBooking = new FoodDiningBooking({
        bookingId,
        restaurantId,
        userId,
        customerName: String(payload.customerName || payload.name || '').trim(),
        customerPhone: String(payload.customerPhone || payload.phone || '').trim(),
        guests,
        date: new Date(payload.date),
        timeSlot: String(payload.timeSlot || '').trim(),
        specialRequest: String(payload.specialRequest || '').trim(),
        pricingModel,
        bookingFee,
        coverChargePerPerson,
        totalAmount,
        costForTwo: String(restaurant?.diningSettings?.costForTwo || restaurant?.costForTwo || ''),
        offer: String(restaurant?.diningSettings?.offer || restaurant?.offer || ''),
        status: 'pending'
    });

    await newBooking.save();

    // Populate relations to match frontend structure
    const populated = await FoodDiningBooking.findById(newBooking._id)
        .populate('restaurantId')
        .populate('userId');

    const result = formatBooking(populated);

    const formattedDate = new Date(payload.date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        weekday: 'short'
    });

    // Real-time socket event & audible alert to restaurant
    try {
        const io = getIO();
        if (io) {
            const restIdStr = String(restaurantId);
            io.to(rooms.restaurant(restIdStr)).emit('new_dining_booking', result);
            io.to(restIdStr).emit('new_dining_booking', result);
            io.to(rooms.restaurant(restIdStr)).emit('play_notification_sound', {
                type: 'dining_booking',
                bookingId: result.bookingId,
                title: 'New Table Reservation',
                message: `New booking for ${result.guests} guest(s) on ${formattedDate} at ${result.timeSlot}`
            });
            io.to(rooms.admin()).emit('new_dining_booking', result);
        }
    } catch (socketErr) {
        console.warn('[DINING_SOCKET_WARN] Failed to emit new_dining_booking:', socketErr?.message);
    }

    // Create In-App Notification for Restaurant
    try {
        await FoodNotification.create({
            ownerType: 'RESTAURANT',
            ownerId: restaurantId,
            title: 'New Table Booking Request 🍽️',
            message: `Booking #${bookingId} received for ${result.guests} guest(s) on ${formattedDate} at ${result.timeSlot}.`,
            link: '/food/restaurant/dining-reservations',
            category: 'dining',
            source: 'DINING_BOOKING',
            metadata: {
                bookingId: newBooking._id,
                customBookingId: bookingId,
                guests: result.guests,
                timeSlot: result.timeSlot
            }
        });
    } catch (notifErr) {
        console.warn('[DINING_NOTIF_WARN] Failed to create restaurant notification:', notifErr?.message);
    }

    // Send push notification to restaurant owner if tokens exist
    try {
        if (restaurant.fcmTokenMobile || restaurant.fcmTokens?.length) {
            await notifyOwnerSafely({
                ownerType: 'RESTAURANT',
                ownerId: restaurantId,
                payload: {
                    title: 'New Table Booking 🍽️',
                    body: `New booking request for ${result.guests} guest(s) at ${result.timeSlot} on ${formattedDate}.`,
                    data: {
                        type: 'dining_booking',
                        bookingId: String(newBooking._id)
                    }
                }
            });
        }
    } catch (pushErr) {
        console.warn('[DINING_PUSH_WARN] Failed to send push to restaurant:', pushErr?.message);
    }

    return result;
}

export async function listUserBookings(userId) {
    const docs = await FoodDiningBooking.find({ userId })
        .populate('restaurantId')
        .populate('userId')
        .sort({ date: -1, createdAt: -1 });

    return docs.map(formatBooking).filter(Boolean);
}

export async function listRestaurantBookings(restaurantIdentifier, authInfo = {}) {
    let restaurantId = restaurantIdentifier;

    // Resolve restaurant ID if a slug was passed
    if (!mongoose.Types.ObjectId.isValid(restaurantIdentifier)) {
        const rest = await FoodRestaurant.findOne({ slug: restaurantIdentifier }).select('_id').lean();
        if (!rest) return [];
        restaurantId = rest._id;
    }

    // Owner check: role is RESTAURANT and user ID matches restaurant ID
    const isAuthorizedOwner = authInfo.requesterRole === 'RESTAURANT' && 
        String(authInfo.requesterId) === String(restaurantId);

    const docs = await FoodDiningBooking.find({ restaurantId })
        .populate('restaurantId')
        .populate('userId')
        .sort({ date: -1, createdAt: -1 });

    const formatted = docs.map(formatBooking).filter(Boolean);

    // If request is public (availability check), redact user personal details to protect privacy
    if (!isAuthorizedOwner) {
        return formatted.map((b) => ({
            ...b,
            user: {
                _id: b.user?._id || null,
                id: b.user?.id || null,
                name: 'Guest',
                phone: '',
                email: ''
            },
            specialRequest: ''
        }));
    }

    return formatted;
}

export async function updateBookingStatus(bookingId, status, restaurantId) {
    const booking = await FoodDiningBooking.findById(bookingId);
    if (!booking) {
        throw new Error('Booking not found');
    }

    if (booking.restaurantId.toString() !== restaurantId.toString()) {
        throw new Error('Unauthorized status update for this restaurant');
    }

    const normalizedStatus = String(status || '').trim().toLowerCase();
    booking.status = normalizedStatus;
    await booking.save();

    const populated = await FoodDiningBooking.findById(booking._id)
        .populate('restaurantId')
        .populate('userId');

    const result = formatBooking(populated);
    const restName = populated?.restaurantId?.restaurantName || populated?.restaurantId?.name || 'Restaurant';
    const formattedDate = new Date(populated.date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        weekday: 'short'
    });

    const isConfirmed = normalizedStatus === 'confirmed' || normalizedStatus === 'accepted';
    const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'rejected';

    const notifTitle = isConfirmed
        ? 'Table Reservation Confirmed! 🎉'
        : isCancelled
        ? 'Table Reservation Update'
        : `Booking Status: ${normalizedStatus.toUpperCase()}`;

    const notifMessage = isConfirmed
        ? `Your table reservation for ${populated.guests} guest(s) at ${restName} on ${formattedDate} at ${populated.timeSlot} is CONFIRMED! Please reach 15 minutes before your time.`
        : isCancelled
        ? `Your table reservation request at ${restName} on ${formattedDate} could not be confirmed.`
        : `Your table reservation status is now ${normalizedStatus}.`;

    // Real-time socket event to user
    try {
        const io = getIO();
        if (io && booking.userId) {
            const targetUserId = String(booking.userId?._id || booking.userId);
            io.to(rooms.user(targetUserId)).emit('dining_booking_update', {
                bookingId: booking._id,
                status: booking.status,
                restaurantId: booking.restaurantId,
                booking: result
            });

            io.to(rooms.user(targetUserId)).emit('play_notification_sound', {
                type: 'dining_booking_status',
                bookingId: result.bookingId,
                title: notifTitle,
                message: notifMessage
            });
        }
    } catch (socketErr) {
        console.warn('[DINING_SOCKET_WARN] Failed to emit dining_booking_update:', socketErr?.message);
    }

    // In-app Notification for User
    try {
        const targetUserId = booking.userId?._id || booking.userId;
        if (targetUserId) {
            await FoodNotification.create({
                ownerType: 'USER',
                ownerId: targetUserId,
                title: notifTitle,
                message: notifMessage,
                link: '/food/user/bookings',
                category: 'dining',
                source: 'DINING_BOOKING',
                metadata: {
                    bookingId: booking._id,
                    customBookingId: booking.bookingId,
                    status: normalizedStatus,
                    restaurantName: restName,
                    guests: populated.guests,
                    timeSlot: populated.timeSlot
                }
            });
        }
    } catch (notifErr) {
        console.warn('[DINING_NOTIF_WARN] Failed to create user notification:', notifErr?.message);
    }

    // Push Notification to user
    try {
        const targetUserId = booking.userId?._id || booking.userId;
        if (targetUserId) {
            await notifyOwnerSafely({
                ownerType: 'USER',
                ownerId: targetUserId,
                payload: {
                    title: notifTitle,
                    body: notifMessage,
                    data: {
                        type: 'dining_booking_status',
                        bookingId: String(booking._id),
                        status: normalizedStatus
                    }
                }
            });
        }
    } catch (pushErr) {
        console.warn('[DINING_PUSH_WARN] Failed to send push to user:', pushErr?.message);
    }

    return result;
}

export async function submitBookingReview(bookingId, userId, rating, comment) {
    const booking = await FoodDiningBooking.findById(bookingId);
    if (!booking) {
        throw new Error('Booking not found');
    }

    if (booking.userId.toString() !== userId.toString()) {
        throw new Error('Unauthorized feedback submission');
    }

    booking.review = {
        rating: Math.min(5, Math.max(1, Number(rating) || 5)),
        comment: String(comment || '').trim(),
        createdAt: new Date()
    };

    await booking.save();

    const populated = await FoodDiningBooking.findById(booking._id)
        .populate('restaurantId')
        .populate('userId');

    return formatBooking(populated);
}
