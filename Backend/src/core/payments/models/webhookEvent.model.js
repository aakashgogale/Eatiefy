import mongoose from 'mongoose';

/**
 * Persistent webhook event deduplication.
 * Unique provider event id ensures duplicate deliveries are no-ops.
 */
const webhookEventSchema = new mongoose.Schema(
    {
        provider: { type: String, required: true, trim: true, index: true },
        eventId: { type: String, required: true, trim: true },
        eventType: { type: String, default: '', trim: true },
        payloadHash: { type: String, default: '' },
        processedAt: { type: Date, default: Date.now },
        result: { type: String, default: 'processed' },
    },
    {
        collection: 'payment_webhook_events',
        timestamps: true,
    },
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

/**
 * Try to claim a webhook event for processing.
 * @returns {Promise<{ claimed: boolean, duplicate: boolean }>}
 */
export async function claimWebhookEvent({ provider, eventId, eventType = '', payloadHash = '' }) {
    if (!eventId) {
        return { claimed: true, duplicate: false, ephemeral: true };
    }
    try {
        await WebhookEvent.create({
            provider,
            eventId: String(eventId),
            eventType: String(eventType || ''),
            payloadHash: String(payloadHash || ''),
        });
        return { claimed: true, duplicate: false };
    } catch (err) {
        if (err?.code === 11000) {
            return { claimed: false, duplicate: true };
        }
        throw err;
    }
}
