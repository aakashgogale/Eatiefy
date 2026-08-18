import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().optional(),
    variantId: z.string().optional(),
    variantName: z.string().optional(),
    variantPrice: z.number().min(0).optional(),
    price: z.number().min(0).optional(),
    basePrice: z.number().min(0).optional(),
    otherPrice: z.number().min(0).optional(),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().optional().default(true),
    image: z.string().optional(),
    notes: z.string().optional()
});

const addressSchema = z.object({
    label: z.enum(['Home', 'Office', 'Other']).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().min(1, 'Street required'),
    additionalDetails: z.string().optional(),
    city: z.string().min(1, 'City required'),
    state: z.string().min(1, 'State required'),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const pricingSchema = z.object({
    subtotal: z.number().min(0).optional(),
    tax: z.number().min(0).optional(),
    packagingFee: z.number().min(0).optional(),
    deliveryFee: z.number().min(0).optional(),
    platformFee: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    total: z.number().min(0).optional(),
    currency: z.string().optional(),
    couponCode: z.string().nullable().optional()
}).optional();

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        useCart: z.boolean().optional().default(true),
        items: z.array(orderItemSchema).optional().default([]),
        restaurantId: z.string().optional(),
        deliveryAddress: z
            .object({
                location: z
                    .object({
                        type: z.literal('Point').optional(),
                        coordinates: z.tuple([z.number(), z.number()]).optional()
                    })
                    .optional()
            })
            .optional(),
        deliveryAddressId: z.string().optional(),
        zoneId: z.string().optional(),
        couponCode: z.string().nullable().optional(),
        deliveryFleet: z.string().optional(),
        orderType: z.enum(['delivery', 'dining', 'takeaway']).optional().default('delivery')
    }).superRefine((data, ctx) => {
        if (data.useCart === false && (!data.items || data.items.length === 0)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one item required', path: ['items'] });
        }
        if (data.useCart === false && !data.restaurantId) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Restaurant id required', path: ['restaurantId'] });
        }
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const first = result.error.issues?.[0];
        const path = first?.path?.length ? first.path.join('.') : '';
        const msg = path ? `${path}: ${first?.message || 'Validation failed'}` : first?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateCreateOrderDto(body) {
    const schema = z.object({
        useCart: z.boolean().optional().default(true),
        items: z.array(orderItemSchema).optional().default([]),
        address: addressSchema.optional(),
        orderType: z.enum(['delivery', 'dining', 'takeaway']).optional().default('delivery'),
        restaurantId: z.string().optional(),
        restaurantName: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        pricing: pricingSchema,
        couponCode: z.string().nullable().optional(),
        deliveryFleet: z.string().optional(),
        note: z.string().optional(),
        restaurantNote: z.string().optional(),
        sendCutlery: z.boolean().optional(),
        // 'razorpay_qr' means COD-style flow, but payment is collected via Razorpay QR at delivery.
        paymentMethod: z.enum(['cash', 'razorpay', 'razorpay_qr', 'card', 'wallet']),
        zoneId: z.string().nullable().optional(),
        scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
        razorpayOrderId: z.string().optional(),
        razorpayPaymentId: z.string().optional(),
        razorpaySignature: z.string().optional()
    }).superRefine((data, ctx) => {
        if (data.useCart === false && (!data.items || data.items.length === 0)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one item required', path: ['items'] });
        }
        if (data.useCart === false && !data.restaurantId) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Restaurant id required', path: ['restaurantId'] });
        }
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const first = result.error.issues?.[0];
        const msg = first?.message || result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateVerifyPaymentDto(body) {
    const schema = z.object({
        orderId: z.string().min(1, 'Order id required'),
        razorpayOrderId: z.string().min(1, 'Razorpay order id required'),
        razorpayPaymentId: z.string().min(1, 'Razorpay payment id required'),
        razorpaySignature: z.string().min(1, 'Razorpay signature required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateCancelOrderDto(body) {
    const schema = z.object({
        reason: z.string().optional(),
        refundDestination: z.enum(['source', 'wallet']).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateOrderStatusDto(body) {
    const schema = z.object({
        orderStatus: z.enum([
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'picked_up',
            'delivered',
            'cancelled_by_restaurant'
        ]),
        note: z.string().optional(),
        preparationTime: z.number().int().min(0).optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateAssignDeliveryDto(body) {
    const schema = z.object({
        deliveryPartnerId: z.string().min(1, 'Delivery partner id required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateDispatchSettingsDto(body) {
    const schema = z.object({
        dispatchMode: z.enum(['auto', 'manual'])
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateOrderRatingsDto(body) {
    const schema = z.object({
        restaurantRating: z.number().min(1).max(5),
        deliveryPartnerRating: z.number().min(1).max(5).optional(),
        restaurantComment: z.string().max(500).optional(),
        deliveryPartnerComment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}
