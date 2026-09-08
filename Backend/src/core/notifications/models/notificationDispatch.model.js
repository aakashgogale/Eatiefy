import mongoose from 'mongoose';

/**
 * One row per (business event, device token) that has actually been handed to
 * FCM. The unique index is the idempotency gate: a second attempt to push the
 * same event to the same device — a retried handler, a duplicated caller, or a
 * second API instance — fails with a duplicate-key error and is skipped.
 *
 * This is deliberately separate from `food_notifications` (the user-facing
 * inbox history): creating the notification record and delivering the push are
 * different concerns, and only delivery is deduplicated per device here.
 */
const notificationDispatchSchema = new mongoose.Schema(
    {
        eventKey: {
            type: String,
            required: true,
            trim: true
        },
        token: {
            type: String,
            required: true,
            trim: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: 'food_notification_dispatches',
        versionKey: false
    }
);

notificationDispatchSchema.index(
    { eventKey: 1, token: 1 },
    { unique: true, name: 'eventKey_1_token_1' }
);

// Claims only need to outlive plausible retries; drop them after a day.
notificationDispatchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const FoodNotificationDispatch = mongoose.model(
    'FoodNotificationDispatch',
    notificationDispatchSchema
);
