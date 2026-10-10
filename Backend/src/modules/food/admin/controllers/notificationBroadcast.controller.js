import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    createBroadcastNotification,
    getBroadcastNotifications,
    deleteBroadcastNotification,
    searchBroadcastRecipients
} from '../services/notificationBroadcast.service.js';
import { runPushDebug } from '../services/pushDebug.service.js';

export const createBroadcastNotificationController = async (req, res) => {
    try {
        const data = await createBroadcastNotification({
            body: req.body,
            adminId: req.user?.userId
        });
        return sendResponse(res, 201, 'Broadcast notification created successfully', data);
    } catch (error) {
        return sendError(res, error.statusCode || 500, error.message || 'Failed to create broadcast notification');
    }
};

export const getBroadcastNotificationsController = async (req, res) => {
    try {
        const data = await getBroadcastNotifications({
            page: req.query?.page,
            limit: req.query?.limit
        });
        return sendResponse(res, 200, 'Broadcast notifications fetched successfully', data);
    } catch (error) {
        return sendError(res, error.statusCode || 500, error.message || 'Failed to fetch broadcast notifications');
    }
};

export const deleteBroadcastNotificationController = async (req, res) => {
    try {
        const data = await deleteBroadcastNotification(req.params?.id);
        return sendResponse(res, 200, 'Broadcast notification deleted successfully', data);
    } catch (error) {
        return sendError(res, error.statusCode || 500, error.message || 'Failed to delete broadcast notification');
    }
};

export const searchBroadcastRecipientsController = async (req, res) => {
    try {
        const data = await searchBroadcastRecipients({
            search: req.query?.search,
            targetType: req.query?.targetType,
            page: req.query?.page,
            limit: req.query?.limit
        });
        return sendResponse(res, 200, 'Recipients searched successfully', data);
    } catch (error) {
        return sendError(res, error.statusCode || 500, error.message || 'Failed to search recipients');
    }
};

export const runPushDebugController = async (req, res) => {
    try {
        // Reveals token details and can send a real push, so full admins only.
        if (String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
            return sendError(res, 403, 'Only a full admin can run push diagnostics');
        }
        const data = await runPushDebug({
            ownerType: req.body?.ownerType,
            query: req.body?.query,
            testSend: req.body?.testSend === true
        });
        return sendResponse(res, 200, 'Push diagnostics completed', data);
    } catch (error) {
        return sendError(res, error.statusCode || 500, error.message || 'Push diagnostics failed');
    }
};
