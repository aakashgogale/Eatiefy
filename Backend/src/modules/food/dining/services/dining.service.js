import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDiningCategory } from '../models/diningCategory.model.js';
import { FoodDiningRestaurant } from '../models/diningRestaurant.model.js';

const slugify = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

const toObjectIdArray = (values) =>
    Array.from(
        new Set(
            (Array.isArray(values) ? values : [values])
                .map((value) => String(value || '').trim())
                .filter((value) => mongoose.Types.ObjectId.isValid(value))
        )
    ).map((value) => new mongoose.Types.ObjectId(value));

async function syncRestaurantDiningSettings(restaurantId, diningDoc, extraUpdates = {}) {
    const primaryCategory = diningDoc?.primaryCategoryId
        ? await FoodDiningCategory.findById(diningDoc.primaryCategoryId).select('slug').lean()
        : null;

    const setObj = {
        'diningSettings.isEnabled': Boolean(diningDoc?.isEnabled),
        'diningSettings.maxGuests': Math.max(1, Number(diningDoc?.maxGuests) || 6),
        'diningSettings.diningType': primaryCategory?.slug || 'family-dining'
    };

    if (extraUpdates.coverImage) {
        setObj.coverImage = extraUpdates.coverImage;
        setObj.coverImages = [{ url: extraUpdates.coverImage }, extraUpdates.coverImage];
        setObj['diningSettings.coverImage'] = extraUpdates.coverImage;
    }
    if (extraUpdates.costForTwo !== undefined) {
        setObj.costForTwo = extraUpdates.costForTwo;
        setObj['diningSettings.costForTwo'] = extraUpdates.costForTwo;
    }
    if (extraUpdates.offer !== undefined) {
        setObj.offer = extraUpdates.offer;
        setObj['diningSettings.offer'] = extraUpdates.offer;
    }
    if (extraUpdates.pricingModel !== undefined) {
        setObj['diningSettings.pricingModel'] = extraUpdates.pricingModel;
    }
    if (extraUpdates.bookingFee !== undefined) {
        setObj['diningSettings.bookingFee'] = Number(extraUpdates.bookingFee) || 0;
    }
    if (extraUpdates.coverChargePerPerson !== undefined) {
        setObj['diningSettings.coverChargePerPerson'] = Number(extraUpdates.coverChargePerPerson) || 0;
    }

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        { $set: setObj },
        { new: false }
    );
}

async function syncCategoryRestaurantLinks(restaurantId, categoryIds) {
    await FoodDiningCategory.updateMany(
        { restaurantIds: restaurantId, _id: { $nin: categoryIds } },
        { $pull: { restaurantIds: restaurantId } }
    );

    if (categoryIds.length > 0) {
        await FoodDiningCategory.updateMany(
            { _id: { $in: categoryIds } },
            { $addToSet: { restaurantIds: restaurantId } }
        );
    }
}

function mapCategory(doc) {
    return {
        _id: doc._id,
        name: doc.name,
        slug: doc.slug,
        imageUrl: doc.imageUrl || '',
        isActive: doc.isActive !== false,
        sortOrder: doc.sortOrder || 0,
        restaurantCount: Array.isArray(doc.restaurantIds) ? doc.restaurantIds.length : 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
}

function getRestaurantZone(restaurant) {
    return (
        restaurant?.location?.area ||
        restaurant?.location?.city ||
        restaurant?.area ||
        restaurant?.city ||
        'N/A'
    );
}

function getRestaurantImage(restaurant) {
    const coverImage = Array.isArray(restaurant?.coverImages)
        ? restaurant.coverImages
            .map((image) => (typeof image === 'string' ? image : image?.url || ''))
            .find(Boolean)
        : '';
    if (coverImage) return coverImage;

    const menuImage = Array.isArray(restaurant?.menuImages)
        ? restaurant.menuImages
            .map((image) => (typeof image === 'string' ? image : image?.url || ''))
            .find(Boolean)
        : '';
    if (menuImage) return menuImage;

    const value = restaurant?.profileImage;
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value?.url || '';
}

function mapDiningRestaurant(restaurant, diningDoc, categoriesById) {
    const categoryIds = (diningDoc?.categoryIds || []).map((id) => String(id));
    const categories = categoryIds
        .map((id) => categoriesById.get(id))
        .filter(Boolean)
        .map((category) => ({
            _id: category._id,
            name: category.name,
            slug: category.slug,
            imageUrl: category.imageUrl || ''
        }));

    const primaryCategoryId = diningDoc?.primaryCategoryId ? String(diningDoc.primaryCategoryId) : '';
    const primaryCategory = categories.find((category) => String(category._id) === primaryCategoryId) || categories[0] || null;

    return {
        _id: restaurant._id,
        id: restaurant._id,
        name: restaurant.restaurantName || restaurant.name || 'N/A',
        restaurantName: restaurant.restaurantName || restaurant.name || 'N/A',
        ownerName: restaurant.ownerName || 'N/A',
        ownerPhone: restaurant.ownerPhone || restaurant.phone || 'N/A',
        pureVegRestaurant: diningDoc?.pureVegRestaurant === true || restaurant?.pureVegRestaurant === true,
        zone: getRestaurantZone(restaurant),
        city: restaurant?.location?.city || restaurant?.city || '',
        status: restaurant.status,
        isActive: restaurant.status === 'approved',
        rating: Number(restaurant.rating || 0),
        logo: getRestaurantImage(restaurant),
        categories,
        categoryIds,
        primaryCategoryId: primaryCategory?._id || null,
        diningSettings: {
            isEnabled: Boolean(diningDoc?.isEnabled),
            maxGuests: Math.max(1, Number(diningDoc?.maxGuests || restaurant?.diningSettings?.maxGuests) || 6),
            pureVegRestaurant: diningDoc?.pureVegRestaurant === true || restaurant?.pureVegRestaurant === true,
            diningType: primaryCategory?.slug || restaurant?.diningSettings?.diningType || '',
            pricingModel: restaurant?.diningSettings?.pricingModel || 'free',
            bookingFee: Number(restaurant?.diningSettings?.bookingFee || 0),
            coverChargePerPerson: Number(restaurant?.diningSettings?.coverChargePerPerson || 0),
            costForTwo: restaurant?.diningSettings?.costForTwo || restaurant?.costForTwo || '',
            offer: restaurant?.diningSettings?.offer || restaurant?.offer || '',
            coverImage: restaurant?.diningSettings?.coverImage || ''
        }
    };
}

export async function listDiningCategoriesAdmin(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const [categories, total] = await Promise.all([
        FoodDiningCategory.find({})
            .sort({ sortOrder: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('name slug imageUrl isActive sortOrder restaurantIds createdAt updatedAt')
            .lean(),
        FoodDiningCategory.countDocuments({})
    ]);

    return {
        categories: categories.map(mapCategory),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit))
        }
    };
}

export async function createDiningCategory(body = {}) {
    const name = String(body.name || '').trim();
    if (!name) {
        throw new ValidationError('Category name is required');
    }

    const slug = slugify(body.slug || name);
    if (!slug) {
        throw new ValidationError('Category slug is required');
    }

    const existing = await FoodDiningCategory.findOne({ slug }).lean();
    if (existing) {
        throw new ValidationError('Dining category already exists');
    }

    const created = await FoodDiningCategory.create({
        name,
        slug,
        imageUrl: String(body.imageUrl || '').trim(),
        isActive: body.isActive !== false,
        sortOrder: Number(body.sortOrder) || 0
    });

    return mapCategory(created.toObject());
}

export async function updateDiningCategory(id, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    const doc = await FoodDiningCategory.findById(id);
    if (!doc) return null;

    if (body.name !== undefined) {
        doc.name = String(body.name || '').trim();
    }
    if (body.slug !== undefined || body.name !== undefined) {
        const nextSlug = slugify(body.slug || doc.name);
        const conflict = await FoodDiningCategory.findOne({ slug: nextSlug, _id: { $ne: doc._id } }).lean();
        if (conflict) {
            throw new ValidationError('Dining category slug already exists');
        }
        doc.slug = nextSlug;
    }
    if (body.imageUrl !== undefined) {
        doc.imageUrl = String(body.imageUrl || '').trim();
    }
    if (body.isActive !== undefined) {
        doc.isActive = body.isActive !== false;
    }
    if (body.sortOrder !== undefined) {
        doc.sortOrder = Number(body.sortOrder) || 0;
    }

    await doc.save();

    const linkedDiningDocs = await FoodDiningRestaurant.find({ categoryIds: doc._id }).select('_id restaurantId').lean();
    await Promise.all(linkedDiningDocs.map(async (item) => {
        await syncRestaurantDiningSettings(item.restaurantId, await FoodDiningRestaurant.findById(item._id).lean());
    }));

    return mapCategory(doc.toObject());
}

export async function deleteDiningCategory(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    const category = await FoodDiningCategory.findByIdAndDelete(id).lean();
    if (!category) return null;

    const categoryId = new mongoose.Types.ObjectId(id);
    const diningDocs = await FoodDiningRestaurant.find({ categoryIds: categoryId });

    for (const doc of diningDocs) {
        doc.categoryIds = (doc.categoryIds || []).filter((value) => String(value) !== id);
        if (doc.primaryCategoryId && String(doc.primaryCategoryId) === id) {
            doc.primaryCategoryId = doc.categoryIds[0] || null;
        }
        if (typeof doc.pureVegRestaurant !== 'boolean') {
            const sourceRestaurant = await FoodRestaurant.findById(doc.restaurantId).select('pureVegRestaurant').lean();
            doc.pureVegRestaurant = sourceRestaurant?.pureVegRestaurant === true;
        }
        await doc.save();
        await syncRestaurantDiningSettings(doc.restaurantId, doc);
    }

    return { id };
}

export async function listDiningRestaurantsAdmin(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const [restaurants, total, categories] = await Promise.all([
        FoodRestaurant.find({})
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('restaurantName ownerName ownerPhone profileImage coverImages menuImages location area city status rating pureVegRestaurant diningSettings')
            .lean(),
        FoodRestaurant.countDocuments({}),
        FoodDiningCategory.find({})
            .select('name slug imageUrl')
            .limit(200)
            .lean()
    ]);

    const diningDocs = restaurants.length
        ? await FoodDiningRestaurant.find({ restaurantId: { $in: restaurants.map((r) => r._id) } })
            .select('restaurantId categoryIds primaryCategoryId isEnabled maxGuests pureVegRestaurant')
            .limit(limit)
            .lean()
        : [];

    const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
    const diningByRestaurantId = new Map(diningDocs.map((doc) => [String(doc.restaurantId), doc]));

    const items = restaurants.map((restaurant) =>
        mapDiningRestaurant(restaurant, diningByRestaurantId.get(String(restaurant._id)), categoriesById)
    );

    return {
        restaurants: items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit))
        }
    };
}

export async function updateDiningRestaurant(restaurantId, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;

    const restaurant = await FoodRestaurant.findById(restaurantId).lean();
    if (!restaurant) return null;

    let diningDoc = await FoodDiningRestaurant.findOne({ restaurantId });
    if (!diningDoc) {
        diningDoc = new FoodDiningRestaurant({
            restaurantId,
            pureVegRestaurant: restaurant.pureVegRestaurant === true
        });
    }

    const categoryIds = body.categoryIds !== undefined
        ? toObjectIdArray(body.categoryIds)
        : (diningDoc.categoryIds || []);

    const validCategories = categoryIds.length > 0
        ? await FoodDiningCategory.find({ _id: { $in: categoryIds } }).select('_id').lean()
        : [];
    const validCategoryIds = validCategories.map((category) => category._id);

    if (body.categoryIds !== undefined) {
        diningDoc.categoryIds = validCategoryIds;
    }
    if (body.isEnabled !== undefined) {
        diningDoc.isEnabled = body.isEnabled === true;
    }
    if (body.maxGuests !== undefined) {
        diningDoc.maxGuests = Math.max(1, parseInt(body.maxGuests, 10) || 6);
    }
    if (body.pureVegRestaurant !== undefined) {
        if (typeof body.pureVegRestaurant === 'boolean') {
            diningDoc.pureVegRestaurant = body.pureVegRestaurant;
        } else if (typeof body.pureVegRestaurant === 'string') {
            const normalized = body.pureVegRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                diningDoc.pureVegRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                diningDoc.pureVegRestaurant = false;
            }
        }
    }

    if (body.primaryCategoryId !== undefined) {
        diningDoc.primaryCategoryId = mongoose.Types.ObjectId.isValid(body.primaryCategoryId)
            ? new mongoose.Types.ObjectId(body.primaryCategoryId)
            : null;
    }

    const primaryCategoryIsAllowed = diningDoc.primaryCategoryId
        && validCategoryIds.some((categoryId) => String(categoryId) === String(diningDoc.primaryCategoryId));

    if (!primaryCategoryIsAllowed) {
        diningDoc.primaryCategoryId = validCategoryIds[0] || null;
    }
    if (typeof diningDoc.pureVegRestaurant !== 'boolean') {
        diningDoc.pureVegRestaurant = restaurant.pureVegRestaurant === true;
    }

    await diningDoc.save();
    await syncCategoryRestaurantLinks(restaurant._id, validCategoryIds);
    await syncRestaurantDiningSettings(restaurant._id, diningDoc, {
        coverImage: body.coverImage || body.imageUrl || body.image,
        costForTwo: body.costForTwo,
        offer: body.offer,
        pricingModel: body.pricingModel,
        bookingFee: body.bookingFee,
        coverChargePerPerson: body.coverChargePerPerson
    });

    const categoryLookupIds = diningDoc.categoryIds || [];
    const categories = categoryLookupIds.length
        ? await FoodDiningCategory.find({ _id: { $in: categoryLookupIds } })
            .select('name slug imageUrl')
            .lean()
        : [];
    const categoriesById = new Map(categories.map((category) => [String(category._id), category]));

    return mapDiningRestaurant(restaurant, diningDoc.toObject(), categoriesById);
}

export async function listDiningCategoriesPublic(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const categories = await FoodDiningCategory.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .limit(limit)
        .select('name slug imageUrl isActive sortOrder restaurantIds createdAt updatedAt')
        .lean();
    return categories.map(mapCategory);
}

export async function listDiningRestaurantsPublic(query = {}) {
    const categoryValue = String(query.category || '').trim();
    const cityValue = String(query.city || '').trim();

    // 1. Base filter: strictly only dining-enabled and approved restaurants
    const restaurantFilter = {
        'diningSettings.isEnabled': true,
        status: 'approved'
    };

    // 2. Category filter if provided
    if (categoryValue) {
        const category = await FoodDiningCategory.findOne({
            $or: [
                mongoose.Types.ObjectId.isValid(categoryValue) ? { _id: categoryValue } : null,
                { slug: categoryValue.toLowerCase() }
            ].filter(Boolean)
        }).lean();

        if (category) {
            restaurantFilter._id = { $in: category.restaurantIds || [] };
        }
    }

    // 3. City/location filter if provided
    if (cityValue) {
        restaurantFilter.$or = [
            { city: { $regex: cityValue, $options: 'i' } },
            { 'location.city': { $regex: cityValue, $options: 'i' } },
            { area: { $regex: cityValue, $options: 'i' } },
            { 'location.area': { $regex: cityValue, $options: 'i' } },
            { 'location.formattedAddress': { $regex: cityValue, $options: 'i' } }
        ];
    }

    // 4. Fetch restaurants
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    let restaurants = await FoodRestaurant.find(restaurantFilter)
        .sort({ rating: -1, updatedAt: -1 })
        .select('restaurantName restaurantNameNormalized ownerName ownerPhone profileImage coverImages menuImages cuisines location area city status rating diningSettings estimatedDeliveryTime estimatedDeliveryTimeMinutes featuredDish featuredPrice offer openingTime closingTime openDays isAcceptingOrders costForTwo pureVegRestaurant')
        .limit(limit)
        .lean();

    // Fallback if strict location yielded 0 results
    if (restaurants.length === 0 && cityValue) {
        delete restaurantFilter.$or;
        restaurants = await FoodRestaurant.find(restaurantFilter)
            .sort({ rating: -1, updatedAt: -1 })
            .select('restaurantName restaurantNameNormalized ownerName ownerPhone profileImage coverImages menuImages cuisines location area city status rating diningSettings estimatedDeliveryTime estimatedDeliveryTimeMinutes featuredDish featuredPrice offer openingTime closingTime openDays isAcceptingOrders costForTwo pureVegRestaurant')
            .limit(limit)
            .lean();
    }

    if (restaurants.length === 0) {
        return [];
    }

    const restaurantIds = restaurants.map(r => r._id);

    // 5. Fetch dining metadata from FoodDiningRestaurant
    const diningMetadata = await FoodDiningRestaurant.find({
        restaurantId: { $in: restaurantIds }
    })
    .select('restaurantId categoryIds maxGuests pureVegRestaurant primaryCategoryId')
    .populate('categoryIds', 'name slug imageUrl')
    .limit(limit)
    .lean();

    const metadataMap = new Map();
    diningMetadata.forEach(m => {
        metadataMap.set(String(m.restaurantId), m);
    });

    // 6. Map combined results
    return restaurants.map((r) => {
        const meta = metadataMap.get(String(r._id));
        return {
            ...r,
            restaurant: r,
            categories: meta?.categoryIds || [],
            diningSettings: {
                isEnabled: true,
                maxGuests: Math.max(1, Number(meta?.maxGuests || r.diningSettings?.maxGuests) || 6),
                pureVegRestaurant: r.pureVegRestaurant === true || meta?.pureVegRestaurant === true,
                diningType: meta?.categoryIds?.[0]?.slug || r.diningSettings?.diningType || 'family-dining',
                costForTwo: r.diningSettings?.costForTwo || r.costForTwo || '₹600 for two',
                offer: r.diningSettings?.offer || r.offer || '',
                coverImage: r.diningSettings?.coverImage || r.coverImages?.[0]?.url || r.profileImage || '',
            }
        };
    });
}

export async function listDiningRequestsAdmin(query = {}) {
    const filter = {
        'diningSettings.requestStatus': 'pending'
    };

    const requests = await FoodRestaurant.find(filter)
        .sort({ 'diningSettings.requestedAt': -1, updatedAt: -1 })
        .select('restaurantName ownerName ownerPhone ownerEmail profileImage coverImages location area city rating diningSettings cuisines costForTwo offer pureVegRestaurant')
        .lean();

    return requests;
}

export async function approveDiningRequestAdmin(restaurantId, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;

    const restaurant = await FoodRestaurant.findById(restaurantId);
    if (!restaurant) return null;

    const currentDiningSettings = restaurant.diningSettings || {};

    const maxGuests = Math.max(1, parseInt(body.maxGuests ?? currentDiningSettings.maxGuests ?? 6, 10) || 6);
    const diningType = String(body.diningType ?? currentDiningSettings.diningType ?? 'family-dining').trim() || 'family-dining';
    const costForTwo = String(body.costForTwo ?? currentDiningSettings.costForTwo ?? '').trim();
    const offer = String(body.offer ?? currentDiningSettings.offer ?? '').trim();
    const coverImage = String(body.coverImage ?? currentDiningSettings.coverImage ?? '').trim();
    const coverImages = Array.isArray(body.coverImages) && body.coverImages.length > 0
        ? body.coverImages
        : (coverImage ? [{ url: coverImage }] : (currentDiningSettings.coverImages || []));

    const pricingModel = ['free', 'fixed_fee', 'cover_charge'].includes(body.pricingModel)
        ? body.pricingModel
        : (currentDiningSettings.pricingModel || 'free');
    const bookingFee = body.bookingFee !== undefined
        ? Math.max(0, Number(body.bookingFee) || 0)
        : Number(currentDiningSettings.bookingFee || 0);
    const coverChargePerPerson = body.coverChargePerPerson !== undefined
        ? Math.max(0, Number(body.coverChargePerPerson) || 0)
        : Number(currentDiningSettings.coverChargePerPerson || 0);
    const mealPeriods = Array.isArray(body.mealPeriods) && body.mealPeriods.length > 0
        ? body.mealPeriods
        : (currentDiningSettings.mealPeriods || ['lunch', 'dinner']);

    // 1. Update Restaurant Document
    restaurant.diningSettings = {
        ...currentDiningSettings,
        isEnabled: true,
        isApproved: true,
        requestStatus: 'approved',
        reviewedAt: new Date(),
        rejectionReason: '',
        maxGuests,
        diningType,
        pricingModel,
        bookingFee,
        coverChargePerPerson,
        mealPeriods,
        costForTwo,
        offer,
        coverImage,
        coverImages
    };

    if (costForTwo) restaurant.costForTwo = costForTwo;
    if (offer) restaurant.offer = offer;

    await restaurant.save();

    // 2. Sync to FoodDiningRestaurant
    try {
        let diningDoc = await FoodDiningRestaurant.findOne({ restaurantId });
        if (!diningDoc) {
            diningDoc = new FoodDiningRestaurant({
                restaurantId,
                pureVegRestaurant: restaurant.pureVegRestaurant === true
            });
        }
        diningDoc.isEnabled = true;
        diningDoc.maxGuests = maxGuests;
        diningDoc.pureVegRestaurant = restaurant.pureVegRestaurant === true;

        // Try to link primary category by slug
        if (diningType) {
            const category = await FoodDiningCategory.findOne({ slug: diningType.toLowerCase() }).select('_id').lean();
            if (category) {
                diningDoc.primaryCategoryId = category._id;
                diningDoc.categoryIds = [category._id];
                await syncCategoryRestaurantLinks(restaurantId, [category._id]);
            }
        }
        await diningDoc.save();
    } catch (syncErr) {
        console.warn('[DINING_APPROVE_SYNC_WARN]', syncErr?.message);
    }

    // 3. Notify Restaurant Owner
    try {
        const { FoodNotification } = await import('../../../../core/notifications/models/notification.model.js');
        const { getIO, rooms } = await import('../../../../config/socket.js');
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        const io = getIO();

        if (io) {
            io.to(rooms.restaurant(restaurantId)).emit('dining_request_approved', {
                restaurantId,
                restaurantName: restaurant.restaurantName,
                diningSettings: restaurant.diningSettings
            });
        }

        await FoodNotification.create({
            ownerType: 'RESTAURANT',
            ownerId: restaurant._id,
            title: 'Dining Activation Approved! 🎉',
            message: `Congratulations! Your dining feature has been approved by admin and is now LIVE for table bookings.`,
            link: '/food/restaurant/dining-reservations',
            category: 'dining',
            source: 'ADMIN_BROADCAST',
            metadata: {
                restaurantId,
                approvedAt: new Date()
            }
        });

        await notifyOwnerSafely({
            ownerType: 'RESTAURANT',
            ownerId: restaurantId,
            payload: {
                title: 'Dining Approved! 🎉',
                body: 'Your restaurant is now active and live on Eatiefy Dining for table reservations.',
                data: {
                    type: 'dining_activation_approved',
                    restaurantId: String(restaurantId)
                }
            }
        });
    } catch (notifErr) {
        console.warn('[DINING_NOTIF_WARN]', notifErr?.message);
    }

    return restaurant;
}

export async function rejectDiningRequestAdmin(restaurantId, reason = '') {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;

    const restaurant = await FoodRestaurant.findById(restaurantId);
    if (!restaurant) return null;

    const currentDiningSettings = restaurant.diningSettings || {};

    restaurant.diningSettings = {
        ...currentDiningSettings,
        isEnabled: false,
        isApproved: false,
        requestStatus: 'rejected',
        rejectionReason: String(reason || '').trim(),
        reviewedAt: new Date()
    };

    await restaurant.save();

    // Disable in FoodDiningRestaurant
    try {
        await FoodDiningRestaurant.findOneAndUpdate(
            { restaurantId },
            { $set: { isEnabled: false } }
        );
    } catch {}

    // Notify Restaurant
    try {
        const { FoodNotification } = await import('../../../../core/notifications/models/notification.model.js');
        const { getIO, rooms } = await import('../../../../config/socket.js');
        const io = getIO();

        if (io) {
            io.to(rooms.restaurant(restaurantId)).emit('dining_request_rejected', {
                restaurantId,
                reason,
                diningSettings: restaurant.diningSettings
            });
        }

        await FoodNotification.create({
            ownerType: 'RESTAURANT',
            ownerId: restaurant._id,
            title: 'Dining Activation Update',
            message: `Your dining activation request was not approved: ${reason || 'Please update your details and re-apply.'}`,
            link: '/food/restaurant/dining-reservations',
            category: 'dining',
            source: 'ADMIN_BROADCAST',
            metadata: {
                restaurantId,
                reason,
                rejectedAt: new Date()
            }
        });
    } catch (notifErr) {
        console.warn('[DINING_NOTIF_WARN]', notifErr?.message);
    }

    return restaurant;
}
