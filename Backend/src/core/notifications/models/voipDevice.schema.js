import mongoose from 'mongoose';

/**
 * One iPhone install that rings order alerts as a VoIP (CallKit) call.
 *
 * `fcmToken` is the regular push token of the same install. It links the two so
 * the server can hold back that phone's regular order alarm while the call is
 * ringing (one alert, not two) and reach the phone with a data-only "end call"
 * push, which a VoIP push may not be used for.
 */
export const voipDeviceSchema = new mongoose.Schema(
    {
        voipToken: { type: String, trim: true, required: true },
        fcmToken: { type: String, trim: true, default: '' },
        deviceId: { type: String, trim: true, default: '' },
        lastSeenAt: { type: Date, default: Date.now }
    },
    { _id: false }
);
