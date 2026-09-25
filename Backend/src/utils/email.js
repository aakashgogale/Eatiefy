import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;
/** undefined = not looked up yet, null = no logo file available. */
let cachedInlineLogoAttachment;
let setupWarningsLogged = false;

function invalidateTransporter() {
    transporter = null;
}

export function isEmailConfigured() {
    const { emailHost, emailUser, emailPass } = config;
    return Boolean(emailHost && emailUser && emailPass);
}

const PRIMARY_COLOR = '#C62828';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SENDER_NAME = 'Eatiefy';
/** Brand logo shipped with the frontend's public/ folder; embedded inline or linked by URL. */
const LOGO_PUBLIC_PATH = 'assets/images/logo-transparent.png';
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Network-level or temporary (4xx) failures - worth one retry. Login/address errors are not. */
const TRANSIENT_SMTP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET']);

function isValidEmail(email) {
    return EMAIL_REGEX.test(String(email || '').trim());
}

/** Gmail / Google Workspace SMTP only sends as the signed-in account (or its verified aliases). */
function isGoogleSmtpHost(host) {
    return /(^|\.)(gmail|googlemail)\.com$/i.test(String(host || '').trim());
}

/** Splits "Name <address>" or "address" into its parts. */
function parseMailbox(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(.*)<\s*([^>]+?)\s*>$/);
    if (match) return { name: match[1].trim().replace(/^["']|["']$/g, ''), address: match[2].trim() };
    return { name: '', address: raw };
}

const domainOf = (address) => String(address || '').split('@').pop().toLowerCase();

/**
 * The effective sender, plus everything wrong with the email setup.
 *
 * Display name: EMAIL_FROM_NAME, else the name inside EMAIL_FROM, else "Eatiefy".
 * Address: EMAIL_FROM, else the SMTP account (EMAIL_USER). With Gmail/Workspace
 * SMTP, EMAIL_FROM is only used when it is on the signed-in account's own
 * domain: Gmail rewrites any other From back to the account - or, for a
 * verified alias, sends it without SPF/DKIM for that domain, which receiving
 * servers junk or drop. The From used to be the SMTP login unconditionally,
 * which is not even an address for most providers (or a mis-set EMAIL_USER).
 */
export function getEmailSetup() {
    const { emailHost, emailPort, emailUser, emailPass, emailFrom, emailFromName } = config;
    const errors = [];
    const warnings = [];
    if (!emailHost) errors.push('EMAIL_HOST is not set');
    if (!emailUser) errors.push('EMAIL_USER is not set');
    if (!emailPass) errors.push('EMAIL_PASS is not set');

    const google = isGoogleSmtpHost(emailHost);
    const account = isValidEmail(emailUser) ? emailUser.toLowerCase() : '';
    if (emailUser && !account && google) {
        errors.push('EMAIL_USER must be the full Gmail / Google Workspace address (e.g. name@gmail.com), not a display name');
    }

    const configured = parseMailbox(emailFrom);
    const configuredAddress = isValidEmail(configured.address) ? configured.address.toLowerCase() : '';
    if (emailFrom && !configuredAddress) {
        warnings.push(`EMAIL_FROM "${emailFrom}" is not a valid email address and is ignored`);
    }

    let address = configuredAddress || account;
    if (google && account && configuredAddress && domainOf(configuredAddress) !== domainOf(account)) {
        warnings.push(
            `EMAIL_FROM (${configuredAddress}) is ignored: Gmail SMTP sends as ${account}. ` +
            `To send as @${domainOf(configuredAddress)}, sign in with an account on that domain ` +
            '(Google Workspace) or a mail provider verified for it, with SPF/DKIM/DMARC set up.'
        );
        address = account;
    }
    if (!address) errors.push('No valid sender address: set EMAIL_FROM (or EMAIL_USER to a full email address)');

    const name = emailFromName || configured.name || DEFAULT_SENDER_NAME;
    return {
        ok: errors.length === 0,
        errors,
        warnings,
        from: address ? { name, address } : null,
        senderAddress: address || null,
        senderDomain: address ? domainOf(address) : null,
        host: emailHost || null,
        port: emailPort || 587
    };
}

function logSetupWarningsOnce(setup) {
    if (setupWarningsLogged || !setup.warnings.length) return;
    setupWarningsLogged = true;
    setup.warnings.forEach((warning) => logger.warn(`Email setup: ${warning}`));
}

function getTransporter() {
    if (transporter) return transporter;
    const { emailHost, emailPort, emailUser, emailPass } = config;
    transporter = nodemailer.createTransport({
        host: emailHost,
        port: emailPort || 587,
        secure: emailPort === 465,
        requireTLS: emailPort !== 465,
        auth: {
            user: emailUser,
            pass: emailPass
        },
        tls: {
            minVersion: 'TLSv1.2'
        },
        // Bounded: an unreachable SMTP server fails fast (and is logged) instead of
        // holding the admin's approve request open for minutes.
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000
    });
    return transporter;
}

function getSmtpErrorHint(err) {
    const code = err?.code;
    const responseCode = Number(err?.responseCode) || 0;
    if (code === 'EAUTH' || responseCode === 534 || responseCode === 535) {
        return isGoogleSmtpHost(config.emailHost)
            ? 'login rejected: EMAIL_USER must be the full Gmail/Workspace address and EMAIL_PASS a 16-character App Password (2-Step Verification enabled)'
            : 'login rejected: check EMAIL_USER / EMAIL_PASS for this SMTP provider';
    }
    if (TRANSIENT_SMTP_CODES.has(code)) {
        return `cannot reach ${config.emailHost}:${config.emailPort} - check EMAIL_HOST/EMAIL_PORT and that this server allows outbound SMTP (many cloud hosts block ports 25/465/587 until you ask them to open it)`;
    }
    if (code === 'EENVELOPE') return 'sender or recipient address refused';
    if (responseCode >= 550) return 'refused by the mail server (sender not allowed for this account/domain, or the recipient does not exist)';
    if (responseCode >= 400 && responseCode < 500) return 'temporarily refused (rate limit or provider busy)';
    return '';
}

/** One-line description of an SMTP failure (code, SMTP status, server reply) with the likely fix. */
export function describeSmtpError(err) {
    const parts = [];
    if (err?.code) parts.push(`code=${err.code}`);
    if (err?.responseCode) parts.push(`smtp=${err.responseCode}`);
    if (err?.command) parts.push(`command=${err.command}`);
    const reply = String(err?.response || err?.message || err || '').split('\n')[0].trim();
    if (reply) parts.push(`"${reply}"`);
    const hint = getSmtpErrorHint(err);
    return hint ? `${parts.join(' ')} -> ${hint}` : parts.join(' ');
}

function isTransientSmtpError(err) {
    const responseCode = Number(err?.responseCode) || 0;
    return TRANSIENT_SMTP_CODES.has(err?.code) || (responseCode >= 400 && responseCode < 500);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getFrontendUrl() {
    const url = String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    return url || null;
}

/** Public URL of the logo: EMAIL_LOGO_URL, else the deployed frontend's copy; null when neither exists. */
function getEatiefyLogoUrl() {
    const explicitLogo = String(process.env.EMAIL_LOGO_URL || '').trim();
    if (explicitLogo) return explicitLogo;

    const frontendUrl = getFrontendUrl();
    if (frontendUrl && !/localhost|127\.0\.0\.1/i.test(frontendUrl)) {
        return `${frontendUrl}/${LOGO_PUBLIC_PATH}`;
    }
    return null;
}

function getInlineLogoAttachment() {
    if (cachedInlineLogoAttachment !== undefined) return cachedInlineLogoAttachment;

    const candidatePaths = [...new Set([
        resolve(BACKEND_ROOT, 'public', LOGO_PUBLIC_PATH),
        resolve(BACKEND_ROOT, '..', 'Frontend', 'public', LOGO_PUBLIC_PATH),
        resolve(BACKEND_ROOT, '..', 'frontend', 'public', LOGO_PUBLIC_PATH),
        resolve(process.cwd(), 'public', LOGO_PUBLIC_PATH),
        resolve(process.cwd(), '..', 'Frontend', 'public', LOGO_PUBLIC_PATH)
    ])];

    const logoPath = candidatePaths.find((p) => existsSync(p));
    cachedInlineLogoAttachment = null;
    if (!logoPath) return null;

    try {
        cachedInlineLogoAttachment = {
            filename: 'eatiefy-logo.png',
            content: readFileSync(logoPath),
            contentType: 'image/png',
            cid: 'eatiefy-logo'
        };
    } catch (error) {
        logger.warn(`Inline email logo load failed: ${error?.message || error}`);
    }
    return cachedInlineLogoAttachment;
}

function getFirstName(name) {
    const value = String(name || '').trim();
    if (!value) return 'Partner';
    return value.split(/\s+/)[0];
}

/**
 * Reusable internal email sender using the shared SMTP transporter.
 *
 * Success means the SMTP server accepted the message (logged with its message
 * id and reply). A refused recipient counts as a failure, and every failure is
 * logged with the real SMTP error - nothing is assumed to have been sent.
 * @returns {Promise<boolean>} true if accepted for delivery, false if skipped/failed
 */
async function sendEmail({ to, subject, html, text, logLabel = 'Email' }) {
    const setup = getEmailSetup();
    logSetupWarningsOnce(setup);
    if (!setup.ok) {
        logger.error(`${logLabel} to ${to} NOT sent - email setup invalid: ${setup.errors.join('; ')}`);
        return false;
    }

    const inlineLogo = getInlineLogoAttachment();
    const message = {
        from: setup.from,
        to,
        subject,
        text,
        html,
        attachments: inlineLogo ? [inlineLogo] : []
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const info = await getTransporter().sendMail(message);
            const rejected = (info?.rejected || []).map(String);
            if (rejected.length) {
                logger.error(`${logLabel} to ${to} NOT delivered - SMTP refused ${rejected.join(', ')}: ${String(info?.response || '').trim()}`);
                return false;
            }
            logger.info(
                `${logLabel} accepted by SMTP for ${to} (from ${setup.senderAddress}, messageId ${info?.messageId || 'n/a'}, reply "${String(info?.response || '').trim()}")`
            );
            return true;
        } catch (err) {
            invalidateTransporter();
            const willRetry = attempt === 1 && isTransientSmtpError(err);
            logger.error(
                `${logLabel} to ${to} failed${attempt > 1 ? ' after retry' : ''}: ${describeSmtpError(err)}${willRetry ? ' (retrying once)' : ''}`
            );
            if (!willRetry) return false;
        }
    }
    return false;
}

/**
 * Checks the setup and signs in to the SMTP server without sending anything.
 * @returns {Promise<object>} getEmailSetup() plus { verified, error }
 */
export async function verifyEmailTransport() {
    const setup = getEmailSetup();
    if (!setup.ok) return { ...setup, verified: false, error: setup.errors.join('; ') };
    try {
        await getTransporter().verify();
        return { ...setup, verified: true, error: null };
    } catch (err) {
        invalidateTransporter();
        return { ...setup, verified: false, error: describeSmtpError(err) };
    }
}

/**
 * Logs whether email works, once at startup - so a broken production mail
 * setup shows in the logs immediately, not after owners miss their emails.
 */
export async function logEmailHealth() {
    if (!isEmailConfigured()) {
        logger.warn('Email is NOT configured (EMAIL_HOST / EMAIL_USER / EMAIL_PASS) - approval and notification emails will not be sent');
        return;
    }
    const health = await verifyEmailTransport();
    health.warnings.forEach((warning) => logger.warn(`Email setup: ${warning}`));
    setupWarningsLogged = true;
    if (health.verified) {
        logger.info(`Email ready: sending as ${health.from.name} <${health.senderAddress}> via ${health.host}:${health.port}`);
    } else {
        logger.error(`Email is NOT working - emails will fail until fixed: ${health.error}`);
    }
}

function buildEmailHeaderHtml() {
    const inlineLogo = getInlineLogoAttachment();
    const logoSrc = inlineLogo ? 'cid:eatiefy-logo' : getEatiefyLogoUrl();
    // Without any logo source, a text wordmark - never a broken image.
    const brand = logoSrc
        ? `<img src="${escapeHtml(logoSrc)}" alt="Eatiefy" width="150" style="display: block; margin: 0 auto; max-width: 150px; width: 150px; height: auto; border: 0; outline: none; text-decoration: none; border-radius: 12px;" />`
        : '<span style="color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 0.5px;">Eatiefy</span>';

    return `
          <tr>
            <td style="background: ${PRIMARY_COLOR}; padding: 24px 32px; text-align: center;">
              ${brand}
            </td>
          </tr>`;
}

function buildEatiefyEmailHtml({
    greeting,
    bannerType = 'success',
    bannerTitle,
    bannerMessage,
    infoRows = [],
    introParagraphs = [],
    footerParagraphs = [],
    actionButton = null
}) {
    let bannerBg = '#E8F5E9';
    let bannerBorder = '#43A047';
    let bannerColor = '#2E7D32';

    if (bannerType === 'rejection') {
        bannerBg = '#FFEBEE';
        bannerBorder = PRIMARY_COLOR;
        bannerColor = PRIMARY_COLOR;
    } else if (bannerType === 'info') {
        bannerBg = '#E3F2FD';
        bannerBorder = '#1976D2';
        bannerColor = '#1565C0';
    } else if (bannerType === 'warning' || bannerType === 'alert') {
        bannerBg = '#FFF8E1';
        bannerBorder = '#FFA000';
        bannerColor = '#E65100';
    }

    const infoHtml = infoRows.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0; border-collapse: collapse; background: #fafafa; border-radius: 8px; border: 1px solid #eeeeee;">
        ${infoRows
            .map(
                (row) => `<tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f0f0f0; color: #666; font-size: 14px; width: 38%; vertical-align: top;">${escapeHtml(row.label)}</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f0f0f0; color: #222; font-size: 14px; font-weight: 600; vertical-align: top;">${escapeHtml(row.value)}</td>
        </tr>`
            )
            .join('')}
      </table>`
        : '';

    const introHtml = introParagraphs
        .map((p) => `<p style="margin: 0 0 14px; color: #444; font-size: 15px; line-height: 1.6;">${p}</p>`)
        .join('');

    const footerHtml = footerParagraphs
        .map((p) => `<p style="margin: 0 0 14px; color: #444; font-size: 15px; line-height: 1.6;">${p}</p>`)
        .join('');

    const bannerMessageHtml = bannerMessage
        ? `<p style="margin: 8px 0 0; color: #444; font-size: 14px; line-height: 1.6;">${bannerMessage}</p>`
        : '';

    const buttonHtml = actionButton && actionButton.url
        ? `<div style="text-align: center; margin: 28px 0 20px;">
            <a href="${escapeHtml(actionButton.url)}" style="background: ${PRIMARY_COLOR}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">
                ${escapeHtml(actionButton.text || 'View in Eatiefy')}
            </a>
          </div>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eatiefy</title>
</head>
<body style="margin: 0; padding: 0; background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: #f4f5f7; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background: #ffffff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.08); overflow: hidden;">
          ${buildEmailHeaderHtml()}
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 20px; color: #222; font-size: 16px; line-height: 1.5;">${greeting}</p>
              <div style="background: ${bannerBg}; border-left: 4px solid ${bannerBorder}; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
                <p style="margin: 0; color: ${bannerColor}; font-size: 17px; font-weight: 700;">${escapeHtml(bannerTitle)}</p>
                ${bannerMessageHtml}
              </div>
              ${introHtml}
              ${infoHtml}
              ${buttonHtml}
              ${footerHtml}
              <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="margin: 0 0 8px; color: #666; font-size: 14px; font-weight: 600;">Need help?</p>
                <p style="margin: 0; color: #888; font-size: 13px; line-height: 1.6;">
                  Contact our support team if you have any questions. We're here to help you get started.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background: #fafafa; padding: 20px 32px; text-align: center; border-top: 1px solid #eee;">
              <p style="margin: 0; color: #999; font-size: 12px; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} Eatiefy. All rights reserved.<br>
                <strong style="color: #666;">Team Eatiefy</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send OTP email for admin forgot password.
 * @param {string} to - Recipient email
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
export async function sendAdminResetOtpEmail(to, otp) {
    const subject = 'Your password reset code – Eatiefy Admin';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111;">Password reset code</h2>
  <p>Use the code below to reset your admin password. It is valid for 10 minutes.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; background: #f5f5f5; padding: 12px 16px; border-radius: 8px;">${otp}</p>
  <p style="color: #666; font-size: 14px;">If you did not request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">Eatiefy Admin</p>
</body>
</html>`;
    const text = `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;

    return sendEmail({
        to,
        subject,
        html,
        text,
        logLabel: 'Admin reset OTP email'
    });
}

/**
 * Send registration received confirmation email to restaurant owner.
 * @param {{ to: string, restaurantName: string, ownerName?: string, restaurantId?: string, ownerPhone?: string, city?: string }} params
 * @returns {Promise<boolean>}
 */
export async function sendRestaurantRegistrationReceivedEmail({
    to,
    restaurantName,
    ownerName,
    restaurantId,
    ownerPhone,
    city
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Restaurant registration email skipped: invalid ownerEmail');
        return false;
    }

    const safeName = escapeHtml(restaurantName || 'your restaurant');
    const ownerDisplayName = getFirstName(ownerName);
    const subject = `📋 Registration Received: ${restaurantName || 'Restaurant'} | Eatiefy`;

    const infoRows = [
        { label: 'Restaurant Name', value: restaurantName || '—' },
        ...(ownerName ? [{ label: 'Owner Name', value: ownerName }] : []),
        ...(ownerPhone ? [{ label: 'Registered Phone', value: ownerPhone }] : []),
        ...(city ? [{ label: 'City', value: city }] : []),
        { label: 'Application Status', value: 'Pending Admin Verification' }
    ];

    const html = buildEatiefyEmailHtml({
        greeting: `Hello ${escapeHtml(ownerDisplayName)},`,
        bannerType: 'info',
        bannerTitle: 'Registration Received!',
        bannerMessage: `Thank you for registering <strong>${safeName}</strong> on Eatiefy. Your application is now in review.`,
        introParagraphs: [
            'Our onboarding team is reviewing your restaurant details, documents, and FSSAI information.',
            'Once verified, your account will be activated and you will be able to log in to the Eatiefy Restaurant Portal, configure your menu, and start receiving orders.'
        ],
        infoRows,
        footerParagraphs: [
            'We typically process registrations within 24 to 48 hours. You will receive an email confirmation as soon as your account is approved.'
        ]
    });

    const text = [
        `Hello ${ownerDisplayName},`,
        '',
        `Thank you for registering ${restaurantName || 'your restaurant'} on Eatiefy.`,
        'Your application is currently under review by our onboarding team.',
        '',
        `Restaurant: ${restaurantName || '—'}`,
        `Status: Pending Admin Verification`,
        '',
        'You will receive an email update once your account has been reviewed.',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Restaurant registration confirmation email${restaurantId ? ` (${restaurantId})` : ''}`
    });
}

/**
 * Send profile update acknowledgment email to restaurant owner.
 * @param {{ to: string, restaurantName: string, ownerName?: string, restaurantId?: string }} params
 * @returns {Promise<boolean>}
 */
export async function sendRestaurantProfileUpdateReceivedEmail({
    to,
    restaurantName,
    ownerName,
    restaurantId
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Restaurant profile update email skipped: invalid ownerEmail');
        return false;
    }

    const safeName = escapeHtml(restaurantName || 'your restaurant');
    const ownerDisplayName = getFirstName(ownerName);
    const subject = `📝 Profile Changes Under Review: ${restaurantName || 'Restaurant'} | Eatiefy`;

    const html = buildEatiefyEmailHtml({
        greeting: `Hello ${escapeHtml(ownerDisplayName)},`,
        bannerType: 'info',
        bannerTitle: 'Profile Changes Submitted',
        bannerMessage: `Your updated profile details for <strong>${safeName}</strong> have been submitted for admin review.`,
        introParagraphs: [
            'Our team will verify the updated details and documents shortly.',
            'Your changes will become visible across the platform once approved by our team.'
        ],
        infoRows: [
            { label: 'Restaurant', value: restaurantName || '—' },
            { label: 'Status', value: 'Pending Changes Approval' }
        ],
        footerParagraphs: [
            'You will receive an email update as soon as the review is complete.'
        ]
    });

    const text = [
        `Hello ${ownerDisplayName},`,
        '',
        `Your updated profile details for ${restaurantName || 'your restaurant'} have been submitted for admin review.`,
        '',
        `Restaurant: ${restaurantName || '—'}`,
        'Status: Pending Changes Approval',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Restaurant profile update email${restaurantId ? ` (${restaurantId})` : ''}`
    });
}

/**
 * @param {{ to: string, restaurantName: string, restaurantId?: string, isChangesApproval?: boolean }} params
 * @returns {Promise<boolean>}
 */
export async function sendRestaurantApprovalEmail({ to, restaurantName, restaurantId, isChangesApproval = false }) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Restaurant approval email skipped: invalid ownerEmail');
        return false;
    }

    const safeName = escapeHtml(restaurantName || 'your restaurant');
    const subject = isChangesApproval
        ? '🎉 Your Restaurant Changes have been Approved | Eatiefy'
        : '🎉 Your Restaurant has been Approved | Eatiefy';

    const html = buildEatiefyEmailHtml({
        greeting: 'Hello,',
        bannerType: 'success',
        bannerTitle: 'Congratulations!',
        infoRows: [
            { label: 'Restaurant', value: restaurantName || '—' },
            { label: 'Status', value: isChangesApproval ? 'Changes Approved' : 'Approved & Live' }
        ],
        introParagraphs: isChangesApproval
            ? [
                `Your profile changes for <strong>${safeName}</strong> have been approved on Eatiefy.`,
                'Your updated restaurant details are now live on the Eatiefy platform. You can continue managing your business through the Eatiefy restaurant app.'
            ]
            : [
                `<strong>${safeName}</strong> has been approved on Eatiefy. You can now start receiving orders through the Eatiefy app.`,
                'Your restaurant profile is now live on the Eatiefy platform. Complete your menu setup, manage orders, and grow your business with us.'
            ]
    });

    const text = [
        'Congratulations!',
        '',
        isChangesApproval
            ? `Your profile changes for ${restaurantName || 'your restaurant'} have been approved on Eatiefy.`
            : `${restaurantName || 'Your restaurant'} has been approved on Eatiefy. You can now start receiving orders through the Eatiefy app.`,
        '',
        `Restaurant: ${restaurantName || '—'}`,
        `Status: ${isChangesApproval ? 'Changes Approved' : 'Approved & Live'}`,
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Restaurant approval email${restaurantId ? ` (${restaurantId})` : ''}`
    });
}

/**
 * @param {{ to: string, restaurantName: string, restaurantId?: string, reason?: string, isChangesRejection?: boolean }} params
 * @returns {Promise<boolean>}
 */
export async function sendRestaurantRejectionEmail({
    to,
    restaurantName,
    restaurantId,
    reason,
    isChangesRejection = false
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Restaurant rejection email skipped: invalid ownerEmail');
        return false;
    }

    const rejectionReason = String(reason || '').trim() || 'Incomplete documents';
    const safeName = escapeHtml(restaurantName || 'your restaurant');

    const subject = isChangesRejection
        ? 'Your Restaurant Changes have been Rejected | Eatiefy'
        : 'Your Restaurant Registration Update | Eatiefy';

    const html = buildEatiefyEmailHtml({
        greeting: 'Hello,',
        bannerType: 'rejection',
        bannerTitle: isChangesRejection ? 'Restaurant changes update' : 'Restaurant registration update',
        bannerMessage: isChangesRejection
            ? `We reviewed the updated details for <strong>${safeName}</strong> and were unable to approve the changes at this time.`
            : `We reviewed the registration for <strong>${safeName}</strong> and were unable to approve it at this time.`,
        introParagraphs: [
            'Please review the reason below, update your documents or profile details in the app, and reapply when ready. Our team is happy to assist if you need clarification.'
        ],
        infoRows: [
            { label: 'Restaurant', value: restaurantName || '—' },
            { label: 'Status', value: 'Rejected' },
            { label: 'Reason', value: rejectionReason }
        ]
    });

    const text = [
        isChangesRejection
            ? 'Your restaurant changes on Eatiefy could not be approved.'
            : 'Your restaurant registration on Eatiefy could not be approved.',
        '',
        `Restaurant: ${restaurantName || '—'}`,
        'Status: Rejected',
        `Reason: ${rejectionReason}`,
        '',
        'Please review the reason below and reapply when ready.',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Restaurant rejection email${restaurantId ? ` (${restaurantId})` : ''}`
    });
}

/**
 * Send registration received confirmation email to delivery partner.
 * @param {{ to: string, partnerName: string, partnerId?: string, phone?: string, vehicleType?: string, city?: string }} params
 * @returns {Promise<boolean>}
 */
export async function sendDeliveryRegistrationReceivedEmail({
    to,
    partnerName,
    partnerId,
    phone,
    vehicleType,
    city
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Delivery registration confirmation skipped: invalid email');
        return false;
    }

    const firstName = escapeHtml(getFirstName(partnerName));
    const subject = `🛵 Welcome to Eatiefy Delivery – Application Received!`;

    const infoRows = [
        { label: 'Partner Name', value: partnerName || '—' },
        ...(phone ? [{ label: 'Phone', value: phone }] : []),
        ...(vehicleType ? [{ label: 'Vehicle Type', value: vehicleType }] : []),
        ...(city ? [{ label: 'City', value: city }] : []),
        { label: 'Application Status', value: 'Pending Admin Verification' }
    ];

    const html = buildEatiefyEmailHtml({
        greeting: `Hello ${firstName},`,
        bannerType: 'info',
        bannerTitle: 'Application Received!',
        bannerMessage: `Thank you for applying to join the Eatiefy delivery fleet. We have received your details.`,
        introParagraphs: [
            'Our operations team is verifying your submitted documents (Driving License, ID Proof, and vehicle information).',
            'Once verified, your account will be activated and you can start accepting orders and earning with Eatiefy.'
        ],
        infoRows,
        footerParagraphs: [
            'You will receive an email update once your application has been verified.'
        ]
    });

    const text = [
        `Hello ${getFirstName(partnerName)},`,
        '',
        'Thank you for applying to join Eatiefy Delivery.',
        'Our team is reviewing your documents and application.',
        '',
        `Partner Name: ${partnerName || '—'}`,
        'Status: Pending Admin Verification',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Delivery registration confirmation email${partnerId ? ` (${partnerId})` : ''}`
    });
}

/**
 * Send profile update acknowledgment email to delivery partner.
 * @param {{ to: string, partnerName: string, partnerId?: string }} params
 * @returns {Promise<boolean>}
 */
export async function sendDeliveryProfileUpdateReceivedEmail({
    to,
    partnerName,
    partnerId
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Delivery profile update email skipped: invalid email');
        return false;
    }

    const firstName = escapeHtml(getFirstName(partnerName));
    const subject = `📝 Delivery Profile Changes Received | Eatiefy`;

    const html = buildEatiefyEmailHtml({
        greeting: `Hello ${firstName},`,
        bannerType: 'info',
        bannerTitle: 'Changes Received',
        bannerMessage: 'Your updated delivery profile details have been submitted for review.',
        introParagraphs: [
            'Our team is reviewing the updated information. Your account will continue to function normally.'
        ],
        infoRows: [
            { label: 'Partner Name', value: partnerName || '—' },
            { label: 'Status', value: 'Details Updated / Under Review' }
        ]
    });

    const text = [
        `Hello ${getFirstName(partnerName)},`,
        '',
        'Your updated delivery profile details have been submitted on Eatiefy.',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Delivery profile update email${partnerId ? ` (${partnerId})` : ''}`
    });
}

/**
 * @param {{ to: string, partnerName: string, partnerId?: string, isChangesApproval?: boolean }} params
 * @returns {Promise<boolean>}
 */
export async function sendDeliveryApprovalEmail({ to, partnerName, partnerId, isChangesApproval = false }) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Delivery approval email skipped: invalid email');
        return false;
    }

    const firstName = escapeHtml(getFirstName(partnerName));
    const subject = isChangesApproval
        ? '🎉 Your Delivery Partner Changes have been Approved | Eatiefy'
        : '🎉 Your Delivery Partner Account has been Approved | Eatiefy';

    const html = buildEatiefyEmailHtml({
        greeting: 'Hello,',
        bannerType: 'success',
        bannerTitle: `Welcome ${firstName}!`,
        bannerMessage: isChangesApproval
            ? 'Your profile changes have been approved. You can continue delivering with Eatiefy.'
            : 'Your account is approved. You can now go online and start earning with Eatiefy.',
        infoRows: [
            { label: 'Partner Name', value: partnerName || '—' },
            { label: 'Status', value: isChangesApproval ? 'Changes Approved' : 'Approved & Active' }
        ],
        introParagraphs: [
            'Open the Eatiefy delivery app, go online, and start accepting delivery requests in your zone.'
        ]
    });

    const text = [
        `Welcome ${getFirstName(partnerName)}!`,
        '',
        isChangesApproval
            ? 'Your delivery partner profile changes have been approved on Eatiefy.'
            : 'Your delivery partner account has been approved on Eatiefy.',
        '',
        `Partner: ${partnerName || '—'}`,
        `Status: ${isChangesApproval ? 'Changes Approved' : 'Approved & Active'}`,
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Delivery approval email${partnerId ? ` (${partnerId})` : ''}`
    });
}

/**
 * @param {{ to: string, partnerName: string, partnerId?: string, reason?: string, isChangesRejection?: boolean }} params
 * @returns {Promise<boolean>}
 */
export async function sendDeliveryRejectionEmail({
    to,
    partnerName,
    partnerId,
    reason,
    isChangesRejection = false
}) {
    const recipient = String(to || '').trim().toLowerCase();
    if (!isValidEmail(recipient)) {
        logger.warn('Delivery rejection email skipped: invalid email');
        return false;
    }

    const rejectionReason = String(reason || '').trim() || 'Incomplete documents';
    const firstName = escapeHtml(getFirstName(partnerName));

    const subject = isChangesRejection
        ? 'Your Delivery Partner Changes have been Rejected | Eatiefy'
        : 'Your Delivery Partner Application Update | Eatiefy';

    const html = buildEatiefyEmailHtml({
        greeting: 'Hello,',
        bannerType: 'rejection',
        bannerTitle: isChangesRejection ? 'Delivery partner changes update' : 'Delivery partner application update',
        bannerMessage: isChangesRejection
            ? `Hi <strong>${firstName}</strong>, we reviewed your updated profile details and were unable to approve the changes at this time.`
            : `Hi <strong>${firstName}</strong>, we reviewed your delivery partner application and were unable to approve it at this time.`,
        introParagraphs: [
            'Please review the reason below, correct any issues with your documents or profile in the app, and reapply when ready.'
        ],
        infoRows: [
            { label: 'Partner Name', value: partnerName || '—' },
            { label: 'Status', value: 'Rejected' },
            { label: 'Reason', value: rejectionReason }
        ]
    });

    const text = [
        isChangesRejection
            ? 'Your delivery partner profile changes on Eatiefy could not be approved.'
            : 'Your delivery partner application on Eatiefy could not be approved.',
        '',
        `Partner: ${partnerName || '—'}`,
        'Status: Rejected',
        `Reason: ${rejectionReason}`,
        '',
        'Please review the reason below and reapply when ready.',
        '',
        'Team Eatiefy'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Delivery rejection email${partnerId ? ` (${partnerId})` : ''}`
    });
}

/**
 * Helper to get all admin emails to notify.
 */
export function getAdminNotificationRecipients() {
    const list = [];
    if (Array.isArray(config.adminNotificationEmails)) {
        list.push(...config.adminNotificationEmails);
    }
    if (config.adminEmail && isValidEmail(config.adminEmail)) {
        list.push(config.adminEmail);
    }
    // Fallback to emailUser if it's a valid email
    if (config.emailUser && isValidEmail(config.emailUser)) {
        list.push(config.emailUser);
    }
    // Filter out dummy/example emails and duplicates
    return [...new Set(list)].filter((e) => isValidEmail(e) && !e.includes('example.com'));
}

/**
 * Send alert email to Admin(s) for key platform events (new restaurant registration, new rider, changes).
 * @param {{ type: string, subject: string, title?: string, message?: string, details?: Array<{label: string, value: any}>, link?: string }} params
 * @returns {Promise<boolean>}
 */
export async function sendAdminAlertEmail({
    subject,
    title = 'Admin Notification',
    message = '',
    details = []
}) {
    const recipients = getAdminNotificationRecipients();
    if (!recipients.length) {
        logger.info(`Admin alert email skipped: no admin email configured`);
        return false;
    }

    const formattedSubject = `🔔 [Eatiefy Admin] ${subject}`;
    const formattedRows = Array.isArray(details)
        ? details.map((d) => ({ label: String(d.label || ''), value: String(d.value ?? '—') }))
        : [];

    const html = buildEatiefyEmailHtml({
        greeting: 'Hello Admin,',
        bannerType: 'warning',
        bannerTitle: title,
        bannerMessage: message ? escapeHtml(message) : undefined,
        introParagraphs: [
            'A new submission requires review in the Eatiefy Admin Panel.'
        ],
        infoRows: formattedRows,
        footerParagraphs: [
            'Please log into the Admin Panel to review and take action.'
        ]
    });

    const text = [
        'Admin Alert - Eatiefy',
        title,
        message,
        '',
        ...formattedRows.map((r) => `${r.label}: ${r.value}`),
        '',
        'Please review in the Eatiefy Admin Panel.'
    ].join('\n');

    let allSent = true;
    for (const recipient of recipients) {
        const sent = await sendEmail({
            to: recipient,
            subject: formattedSubject,
            html,
            text,
            logLabel: `Admin Alert Email (${subject})`
        });
        if (!sent) allSent = false;
    }

    return allSent;
}

