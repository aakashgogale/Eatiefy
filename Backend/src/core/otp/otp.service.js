import crypto from 'crypto';
import ms from 'ms';
import { FoodOtp } from './otp.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../auth/errors.js';

const generateOtpCode = () => {
    const code = crypto.randomInt(1000, 9999);
    return String(code);
};

/**
 * Sends SMS via SMS India Hub API
 * @param {string} phone - 10-digit mobile number (will be prefixed with 91)
 * @param {string} otp
 */
const sendSmsViaIndiaHub = async (phone, otp) => {
    try {
        // Normalize phone: strip non-digits, ensure 91 country code prefix
        const digits = String(phone || '').replace(/\D/g, '');
        const msisdn = digits.startsWith('91') ? digits : `91${digits}`;

        // EXACT DLT TEMPLATE provided by user:
        // "Welcome to the ##var## powered by SMSINDIAHUB. Your OTP for registration is ##var##"
        const message = `Welcome to the Ometto. Your OTP for registration is ${otp}`;

        // SMS India Hub HTTP GET API — query param names are case-sensitive per SOP
        const url = new URL('http://cloud.smsindiahub.in/vendorsms/pushsms.aspx');
        url.searchParams.append('APIKey', config.smsApiKey);
        url.searchParams.append('sid', config.smsSenderId);
        url.searchParams.append('msisdn', msisdn);
        url.searchParams.append('msg', message);
        url.searchParams.append('gwid', '2');
        url.searchParams.append('fl', '0');
        if (config.smsIndiaHubUsername) {
            url.searchParams.append('uname', config.smsIndiaHubUsername);
        }
        if (config.smsDltTemplateId) {
            url.searchParams.append('DLT_TE_ID', config.smsDltTemplateId);
        }

        logger.info(`[SMS] Sending OTP to ${msisdn} via SMS India Hub...`);
        const response = await fetch(url.toString());
        const resultText = await response.text();
        logger.info(`[SMS] Raw response for ${msisdn}: ${resultText}`);

        // SMS India Hub often returns HTTP 200 OK even for errors — check response body
        let parsed = null;
        try { parsed = JSON.parse(resultText); } catch (_) { /* plain text response is OK */ }

        if (parsed && parsed.ErrorCode && parsed.ErrorCode !== '000') {
            const errMsg = `SMS India Hub ERROR for ${phone}: [${parsed.ErrorCode}] ${parsed.ErrorMessage || resultText}`;
            logger.error(errMsg);
            // eslint-disable-next-line no-console
            console.error(`❌ [SMS ERROR] ${errMsg}`);
            if (parsed.ErrorCode === '006') {
                // eslint-disable-next-line no-console
                console.error('❌ [SMS ERROR] ErrorCode 006 = DLT Template mismatch. The message text must EXACTLY match your registered TRAI DLT template. Login to https://cloud.smsindiahub.in and verify the approved template text.');
            }
        } else if (!response.ok) {
            logger.error(`SMS API HTTP error for ${phone}: ${response.status} – ${resultText}`);
        } else {
            logger.info(`✅ SMS sent successfully to ${msisdn}`);
        }
    } catch (error) {
        logger.error(`Error sending SMS to ${phone}: ${error.message}`);
        // Do NOT throw — OTP is already stored in DB; SMS failure should not block the flow
    }
};

/**
 * Sends SMS via MSG91 OTP API
 * @param {string} phone - 10-digit mobile number (will be prefixed with 91)
 * @param {string} otp
 */
const sendSmsViaMsg91 = async (phone, otp) => {
    try {
        // Normalize phone: strip non-digits, ensure 91 country code prefix
        const digits = String(phone || '').replace(/\D/g, '');
        const msisdn = digits.startsWith('91') ? digits : `91${digits}`;

        logger.info(`[SMS] Sending OTP to ${msisdn} via MSG91 OTP API...`);

        const response = await fetch('https://control.msg91.com/api/v5/otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'authkey': config.msg91AuthKey
            },
            body: JSON.stringify({
                template_id: config.msg91TemplateId,
                mobile: msisdn,
                otp: otp
            })
        });

        const resultText = await response.text();
        logger.info(`[SMS] MSG91 raw response for ${msisdn}: ${resultText}`);

        let parsed = null;
        try { parsed = JSON.parse(resultText); } catch (_) { /* plain text response */ }

        if (parsed && parsed.type === 'error') {
            const errMsg = `MSG91 ERROR for ${phone}: ${parsed.message || resultText}`;
            logger.error(errMsg);
            // eslint-disable-next-line no-console
            console.error(`❌ [SMS ERROR] ${errMsg}`);
        } else if (!response.ok) {
            logger.error(`MSG91 API HTTP error for ${phone}: ${response.status} – ${resultText}`);
        } else {
            logger.info(`✅ MSG91 SMS sent successfully to ${msisdn}`);
        }
    } catch (error) {
        logger.error(`Error sending SMS via MSG91 to ${phone}: ${error.message}`);
        // Do NOT throw — OTP is already stored in DB; SMS failure should not block the flow
    }
};

const normalizePhoneForOtp = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.slice(-10); // Always normalize to 10 digits to prevent duplicate checks
};

/** True only for the env-configured test phone when USE_DEFAULT_TEST_PHONE=true */
const isDefaultTestPhone = (normalizedPhone) =>
    Boolean(
        config.useDefaultTestPhone &&
        config.defaultTestPhone &&
        normalizedPhone === config.defaultTestPhone
    );

/**
 * Static OTP 1234 when:
 * - USE_DEFAULT_OTP=true (all phones), OR
 * - USE_DEFAULT_TEST_PHONE=true and phone === DEFAULT_TEST_PHONE
 */
export const shouldUseStaticOtp = (phone) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    // return config.useDefaultOtp;
    return config.useDefaultOtp || isDefaultTestPhone(normalizedPhone);
};

export const createOrUpdateOtp = async (phone) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    if (!normalizedPhone) throw new ValidationError("Valid phone number is required");

    const existing = await FoodOtp.findOne({ phone: normalizedPhone });
    const now = new Date();
    const useStaticOtp = shouldUseStaticOtp(normalizedPhone);

    // 1. Blocked User Check (Professional back-off)
    if (existing && existing.blockedUntil && existing.blockedUntil > now) {
        const remainingMs = existing.blockedUntil - now;
        logger.warn(`[OTP REQUEST] Blocked phone: ${normalizedPhone}, Failures: ${existing.totalFailures}`);
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.ceil((remainingMs % 60000) / 1000);
        throw new ValidationError(`Security Alert: Too many failed attempts. Try again after ${mins}:${String(secs).padStart(2, '0')} minutes.`);
    }

    // 2. Rate Limiting Logic (OTP Requests)
    if (existing) {
        const windowMs = (config.otpRateWindow || 600) * 1000;
        const isInWindow = now - existing.lastRequestAt < windowMs;

        if (isInWindow) {
            // Relax rate limit in local development to avoid blocking testing flows
            const isDev = config.nodeEnv === 'development';
            const limit = isDev ? 5 : (config.otpRateLimit || 3);
            // if (!config.useDefaultOtp && existing.requestCount >= limit) {
            if (!useStaticOtp && existing.requestCount >= limit) {
                logger.warn(`Rate limit exceeded for phone ${normalizedPhone}`);
                throw new ValidationError(`Too many OTP requests. Please try again after ${Math.ceil(windowMs / 60000)} minutes.`);
            }
            existing.requestCount += 1;
        } else {
            existing.requestCount = 1;
        }
    }

    let otp;
    // if (config.useDefaultOtp) {
    //     otp = '1234';
    //     logger.info(`Default OTP mode enabled – OTP is ${otp} for phone ${normalizedPhone}`);
    // } else {
    //     otp = generateOtpCode();
    // }
    if (useStaticOtp) {
        otp = '1234';
        logger.info(
            `${config.useDefaultOtp ? 'Default OTP mode' : 'Default test phone'} enabled – OTP is ${otp} for phone ${normalizedPhone}`
        );
    } else {
        otp = generateOtpCode();
    }

    // 3. Expiry calculation (Code expiry vs Record expiry)
    let ttlMs;
    if (config.otpExpirySeconds) {
        ttlMs = config.otpExpirySeconds * 1000;
    } else if (config.otpExpiryMinutes) {
        ttlMs = config.otpExpiryMinutes * 60 * 1000;
    } else {
        ttlMs = ms(config.otpExpiry || '5m');
    }
    
    const otpExpiresAt = new Date(now.getTime() + ttlMs);
    // Record expiry (expiresAt) is used by TTL index to delete from DB
    // We keep it for at least 1 hour to maintain penalty counts, or longer if blocked
    const expiresAt = new Date(now.getTime() + Math.max(3600000, ttlMs));

    if (existing) {
        existing.otp = otp;
        existing.otpExpiresAt = otpExpiresAt;
        existing.expiresAt = expiresAt;
        existing.attempts = 0;
        existing.lastRequestAt = now;
        await existing.save();
    } else {
        await FoodOtp.create({ 
            phone: normalizedPhone, 
            otp, 
            otpExpiresAt,
            expiresAt,
            requestCount: 1,
            lastRequestAt: now
        });
    }

    // Only send SMS if not in default OTP mode
    // if (!config.useDefaultOtp) {
    if (!useStaticOtp) {
        if (config.msg91Enabled) {
            await sendSmsViaMsg91(phone, otp);
        } else if (config.smsHubEnabled) {
            await sendSmsViaIndiaHub(phone, otp);
        } else {
            logger.warn('No SMS provider is enabled (MSG91_ENABLED and SMS_HUB_ENABLED are both false/missing).');
        }
    }

    return otp;
};

export const verifyOtp = async (phone, otp, preserveOtp = false) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    const record = await FoodOtp.findOne({ phone: normalizedPhone });
    const now = new Date();

    // Static OTP Bypass: In dev/test mode with USE_DEFAULT_OTP=true, 
    // we allow '1234' unconditionally to avoid any formatting or database issues.
    // Also bypass for DEFAULT_TEST_PHONE when USE_DEFAULT_TEST_PHONE=true.
    // if (config.useDefaultOtp && otp === '1234') {
    if (shouldUseStaticOtp(normalizedPhone) && otp === '1234') {
        console.info(`✅ [OTP-Verify] Static OTP '1234' ABSOLUTE BYPASS for ${phone}`);
        if (record && !preserveOtp) {
            await record.deleteOne(); // Reset the request limit for successful logins
        } else if (record && preserveOtp) {
            record.attempts = 0;
            record.totalFailures = 0;
            record.blockedUntil = null;
            record.requestCount = 1; // Reset request count for preserved OTPs
            await record.save();
        }
        return { valid: true };
    }

    if (!record) {
        console.warn(`❌ [OTP-Verify] No OTP record found for ${normalizedPhone}`);
        return { valid: false, reason: 'OTP not found. Please request a new OTP.' };
    }

    // 1. Check if user is currently blocked
    if (record.blockedUntil && record.blockedUntil > now) {
        const rem = record.blockedUntil - now;
        const mins = Math.floor(rem / 60000);
        const secs = Math.ceil((rem % 60000) / 1000);
        return { valid: false, reason: `Too many attempts. Blocked for ${mins}:${String(secs).padStart(2, '0')} more minutes.` };
    }

    // 2. Increment and Check attempts (Always count attempts even if expired/wrong)
    record.attempts += 1;

    // Trigger Penalty if max attempts reached (e.g. 4th failure)
    if (record.attempts >= config.otpMaxAttempts) {
        record.totalFailures += 1;
        console.info(`[OTP BLOCK] Phone: ${normalizedPhone}, Failure Count: ${record.totalFailures}`);
        // 1st block: 1 min, subsequent blocks: 10 min
        const penaltyMinutes = record.totalFailures === 1 ? 1 : 10;
        record.blockedUntil = new Date(now.getTime() + penaltyMinutes * 60000);
        // Reset attempts so they get fresh tries after the block expires
        record.attempts = 0;
        // Extend record expiry to keep the block active in DB
        record.expiresAt = new Date(record.blockedUntil.getTime() + 3600000); 
        await record.save();

        return { 
            valid: false, 
            reason: `Max attempts exceeded. Blocked for ${penaltyMinutes} minutes.` 
        };
    }

    // 3. Check if OTP itself has expired
    if (record.otpExpiresAt < now) {
        await record.save(); // Save the incremented attempt
        return { valid: false, reason: 'OTP expired' };
    }

    if (record.otp !== otp) {
        await record.save();
        return { valid: false, reason: 'Invalid OTP' };
    }

    // OTP is correct! Reset attempts, penalty counters, and request count
    record.attempts = 0;
    record.totalFailures = 0;
    record.blockedUntil = null;
    record.requestCount = 1; // Reset request count for live OTPs

    if (!preserveOtp) {
        console.info(`✅ [OTP-Verify] OTP verified and deleted for ${normalizedPhone}`);
        await record.deleteOne();
    } else {
        console.info(`✅ [OTP-Verify] OTP verified and preserved for ${normalizedPhone}`);
        await record.save();
    }
    return { valid: true };
};

