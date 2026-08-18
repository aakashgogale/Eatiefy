import express from 'express';
import { handleRazorpayWebhook } from '../controllers/razorpayWebhook.controller.js';

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
    const frontendUrl = req.query.frontendUrl;
    if (!frontendUrl) {
        return res.status(400).send('Missing frontendUrl parameter');
    }
    
    // Pass the form body data as query parameters to the frontend
    const queryParams = new URLSearchParams(req.body).toString();
    const separator = frontendUrl.includes('?') ? '&' : '?';
    
    return res.redirect(`${frontendUrl}${separator}${queryParams}`);
});

export default router;
