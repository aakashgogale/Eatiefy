import express from 'express';
import { handleRazorpayWebhook } from '../controllers/razorpayWebhook.controller.js';
import { isAllowedOrigin } from '../../../config/cors.js';

/** ✅ NEW: Webhook Routes Module */
const router = express.Router();

/**
 * Endpoint for Razorpay payment/refund events (Public)
 * Path: /api/v1/payments/webhook/razorpay
 */
router.post('/razorpay', handleRazorpayWebhook);

/**
 * Endpoint for Razorpay redirect-based flow
 * Redirects POST requests from Razorpay back to the frontend URL
 * Path: /api/v1/payments/webhook/razorpay-redirect
 */
router.post('/razorpay-redirect', (req, res) => {
    const frontendUrl = String(req.query.frontendUrl || '').trim();
    if (!frontendUrl) {
        return res.status(400).send('Missing frontendUrl parameter');
    }
    // Only our own apps: an arbitrary target turned this into an open redirect
    // that also handed the payment ids to whatever site it pointed at.
    let target;
    try {
        target = new URL(frontendUrl);
    } catch {
        return res.status(400).send('Invalid frontendUrl parameter');
    }
    if (!/^https?:$/.test(target.protocol) || !isAllowedOrigin(target.origin)) {
        return res.status(400).send('frontendUrl is not an allowed origin');
    }
    
    // Pass the form body data as query parameters to the frontend
    const queryParams = new URLSearchParams(req.body).toString();
    const separator = frontendUrl.includes('?') ? '&' : '?';
    
    return res.redirect(`${frontendUrl}${separator}${queryParams}`);
});

export default router;
