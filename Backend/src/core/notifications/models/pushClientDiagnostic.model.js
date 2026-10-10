import mongoose from 'mongoose';

/**
 * What the native app said when it could not hand the web layer an FCM token.
 * Read by the admin Push Debug tool; reports expire on their own.
 */
const pushClientDiagnosticSchema = new mongoose.Schema(
    {
        ownerType: { type: String, required: true, index: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        module: { type: String, default: '' },
        tokenFound: { type: Boolean, default: false },
        env: { type: mongoose.Schema.Types.Mixed, default: null },
        permission: { type: mongoose.Schema.Types.Mixed, default: null },
        handlers: { type: mongoose.Schema.Types.Mixed, default: {} },
        hasCallHandler: { type: Boolean, default: false },
        userAgent: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
    },
    { collection: 'food_push_client_diagnostics', versionKey: false }
);

pushClientDiagnosticSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const PushClientDiagnostic = mongoose.model('PushClientDiagnostic', pushClientDiagnosticSchema);
