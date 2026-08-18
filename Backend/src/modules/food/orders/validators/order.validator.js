import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().min(1, 'Item name required'),
    variantId: z.string().nullable().optional(),
    variantName: z.string().nullable().optional(),
    variantPrice: z.number().min(0).nullable().optional(),
    price: z.number().min(0),
    otherPrice: z.number().min(0).nullable().optional(),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().nullable().optional().default(true),
    image: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
});

const addressSchema = z.object({
    label: z.enum(['Home', 'Office', 'Other']).nullable().optional(),
    name: z.string().nullable().optional(),
    fullName: z.string().nullable().optional(),
    street: z.string().min(1, 'Street required'),
    additionalDetails: z.string().nullable().optional(),
    city: z.string().min(1, 'City required'),
    state: z.string().min(1, 'State required'),
    zipCode: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    location: z
        .object({
            type: z.literal('Point').nullable().optional(),
            coordinates: z.tuple([z.number(), z.number()]).nullable().optional()
        })
        .nullable().optional()
});

const pricingSchema = z.object({
    subtotal: z.number().min(0),
    tax: z.number().min(0).nullable().optional(),
    packagingFee: z.number().min(0).nullable().optional(),
    deliveryFee: z.number().min(0).nullable().optional(),
    platformFee: z.number().min(0).nullable().optional(),
    discount: z.number().min(0).nullable().optional(),
    total: z.number().min(0),
    currency: z.string().nullable().optional(),
    couponCode: z.string().nullable().optional()
});

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        restaurantId: z.string().min(1, 'Restaurant id required'),
        deliveryAddressId: z.string().nullable().optional(),
        zoneId: z.string().nullable().optional(),
        couponCode: z.string().nullable().optional(),
        deliveryFleet: z.string().nullable().optional(),
        deliveryMode: z.enum(['basic', 'quick']).nullable().optional(),
        deliveryAddress: z
            .object({
                location: z
                    .object({
                        coordinates: z.tuple([z.number(), z.number()]).nullable().optional()
                    })
                    .nullable().optional()
            })
            .passthrough()
            .nullable()
            .nullable().optional(),
        scheduledAt: z.string().datetime().nullable().optional()
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
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        address: addressSchema.nullable().optional(), // allow null for quick mode if needed, though service might fail later
        restaurantId: z.string().min(1, 'Restaurant id required'),
        restaurantName: z.string().nullable().optional(),
        customerName: z.string().nullable().optional(),
        customerPhone: z.string().nullable().optional(),
        pricing: pricingSchema,
        deliveryFleet: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        deliveryInstructions: z.string().nullable().optional(),
        deliveryMode: z.enum(['basic', 'quick']).nullable().optional(),
        sendCutlery: z.boolean().nullable().optional(),
        // 'cash' = Cash on Delivery; 'razorpay_qr' = COD-style flow collected via Razorpay QR at delivery.
        paymentMethod: z.enum(['cash', 'razorpay', 'razorpay_qr', 'card', 'wallet'], {
            errorMap: () => ({ message: 'Invalid payment method selected.' }),
        }),
        zoneId: z.string().nullable().optional(),
        scheduledAt: z.string().datetime().nullable().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
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
        reason: z.string().nullable().optional()
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
        note: z.string().nullable().optional()
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
        deliveryPartnerRating: z.number().min(1).max(5).nullable().optional(),
        restaurantComment: z.string().max(500).nullable().optional(),
        deliveryPartnerComment: z.string().max(500).nullable().optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}
