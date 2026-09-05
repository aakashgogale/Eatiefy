import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;
let cachedInlineLogoAttachment = null;

function invalidateTransporter() {
    transporter = null;
}

export function isEmailConfigured() {
    const { emailHost, emailUser, emailPass } = config;
    return Boolean(emailHost && emailUser && emailPass);
}

const PRIMARY_COLOR = '#C62828';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTransporter() {
    if (transporter) return transporter;
    const { emailHost, emailPort, emailUser, emailPass } = config;
    if (!emailHost || !emailUser || !emailPass) {
        logger.warn('Email not configured: EMAIL_HOST, EMAIL_USER, EMAIL_PASS required');
        return null;
    }
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
        }
    });
    return transporter;
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

function getOmettoLogoUrl() {
    const explicitLogo = String(process.env.EMAIL_LOGO_URL || '').trim();
    if (explicitLogo) return explicitLogo;

    const frontendUrl = getFrontendUrl();
    if (frontendUrl && !/localhost|127\.0\.0\.1/i.test(frontendUrl)) {
        return `${frontendUrl}/logo-transparent.webp`;
    }

    return 'https://omettoindia.cloud/logo-transparent.webp';
}

function getInlineLogoAttachment() {
    if (cachedInlineLogoAttachment) return cachedInlineLogoAttachment;

    const candidatePaths = [
        resolve(process.cwd(), 'public', 'logo-transparent.webp'),
        resolve(process.cwd(), '..', 'Frontend', 'public', 'logo-transparent.webp'),
        resolve(process.cwd(), '..', 'frontend', 'public', 'logo-transparent.webp')
    ];

    const logoPath = candidatePaths.find((p) => existsSync(p));
    if (!logoPath) return null;

    try {
        const content = readFileSync(logoPath);
        cachedInlineLogoAttachment = {
            filename: 'ometto-logo.webp',
            content,
            contentType: 'image/webp',
            cid: 'ometto-logo'
        };
        return cachedInlineLogoAttachment;
    } catch (error) {
        logger.warn(`Inline email logo load failed: ${error?.message || error}`);
        return null;
    }
}

function getFirstName(name) {
    const value = String(name || '').trim();
    if (!value) return 'Partner';
    return value.split(/\s+/)[0];
}

function isValidEmail(email) {
    return EMAIL_REGEX.test(String(email || '').trim());
}

function resolveFromHeader(displayName = 'Ometto') {
    const emailUser = String(config.emailUser || '').trim();
    if (emailUser) {
        // Gmail SMTP requires the From address to match the authenticated account.
        return `${displayName} <${emailUser}>`;
    }

    const from = String(config.emailFrom || 'noreply@example.com').trim();
    if (from.includes('<')) return from;
    return `${displayName} <${from}>`;
}

/**
 * Reusable internal email sender using the shared SMTP transporter.
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
async function sendEmail({ to, subject, html, text, fromDisplay, logLabel = 'Email' }) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn(`${logLabel} skipped: SMTP not configured`);
        return false;
    }

    const inlineLogo = getInlineLogoAttachment();
    const attachments = inlineLogo ? [inlineLogo] : [];

    try {
        await trans.sendMail({
            from: fromDisplay || resolveFromHeader('Ometto'),
            to,
            subject,
            text,
            html,
            attachments
        });
        logger.info(`${logLabel} sent to ${to}`);
        return true;
    } catch (err) {
        const detail = err?.response || err?.code || err?.message || err;
        logger.error(`Failed to send ${logLabel} to ${to}:`, detail);
        invalidateTransporter();

        const retryTrans = getTransporter();
        if (!retryTrans) return false;

        try {
            await retryTrans.sendMail({
                from: fromDisplay || resolveFromHeader('Ometto'),
                to,
                subject,
                text,
                html,
                attachments
            });
            logger.info(`${logLabel} sent to ${to} (after SMTP retry)`);
            return true;
        } catch (retryErr) {
            const retryDetail = retryErr?.response || retryErr?.code || retryErr?.message || retryErr;
            logger.error(`Failed to send ${logLabel} to ${to} after retry:`, retryDetail);
            invalidateTransporter();
            return false;
        }
    }
}

function buildEmailHeaderHtml() {
    const logoUrl = getOmettoLogoUrl();
    const safeLogoUrl = escapeHtml(logoUrl);
    const inlineLogo = getInlineLogoAttachment();
    const logoSrc = inlineLogo ? 'cid:ometto-logo' : safeLogoUrl;

    return `
          <tr>
            <td style="background: ${PRIMARY_COLOR}; padding: 24px 32px; text-align: center;">
              <img src="${logoSrc}" alt="Ometto" width="150" style="display: block; margin: 0 auto; max-width: 150px; width: 150px; height: auto; border: 0; outline: none; text-decoration: none; border-radius: 12px;" />
            </td>
          </tr>`;
}

function buildOmettoEmailHtml({
    greeting,
    bannerType = 'success',
    bannerTitle,
    bannerMessage,
    infoRows = [],
    introParagraphs = [],
    footerParagraphs = []
}) {
    const bannerBg = bannerType === 'success' ? '#E8F5E9' : '#FFEBEE';
    const bannerBorder = bannerType === 'success' ? '#43A047' : PRIMARY_COLOR;
    const bannerColor = bannerType === 'success' ? '#2E7D32' : PRIMARY_COLOR;

    const infoHtml = infoRows.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0; border-collapse: collapse;">
        ${infoRows
            .map(
                (row) => `<tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; font-size: 14px; width: 38%; vertical-align: top;">${escapeHtml(row.label)}</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #222; font-size: 14px; font-weight: 600; vertical-align: top;">${escapeHtml(row.value)}</td>
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

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ometto</title>
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
                &copy; ${new Date().getFullYear()} Ometto. All rights reserved.<br>
                <strong style="color: #666;">Team Ometto</strong>
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
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Admin OTP email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = 'Your password reset code – Appzeto Admin';
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
  <p style="color: #999; font-size: 12px;">Appzeto Admin</p>
</body>
</html>`;
    const text = `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;

    return sendEmail({
        to,
        subject,
        html,
        text,
        fromDisplay: `Appzeto <${config.emailUser || from}>`,
        logLabel: 'Admin reset OTP email'
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
        ? '🎉 Your Restaurant Changes have been Approved | Ometto'
        : '🎉 Your Restaurant has been Approved | Ometto';

    const html = buildOmettoEmailHtml({
        greeting: 'Hello,',
        bannerType: 'success',
        bannerTitle: 'Congratulations!',
        infoRows: [
            { label: 'Restaurant', value: restaurantName || '—' },
            { label: 'Status', value: isChangesApproval ? 'Changes Approved' : 'Approved' }
        ],
        introParagraphs: isChangesApproval
            ? [
                `Your profile changes for <strong>${safeName}</strong> have been approved on Ometto.`,
                'Your updated restaurant details are now live on the Ometto platform. You can continue managing your business through the Ometto restaurant app.'
            ]
            : [
                `<strong>${safeName}</strong> has been approved on Ometto. You can now start receiving orders through the Ometto app.`,
                'Your restaurant profile is now live on the Ometto platform. Complete your menu setup, manage orders, and grow your business with us.'
            ]
    });

    const text = [
        'Congratulations!',
        '',
        isChangesApproval
            ? `Your profile changes for ${restaurantName || 'your restaurant'} have been approved on Ometto.`
            : `${restaurantName || 'Your restaurant'} has been approved on Ometto. You can now start receiving orders through the Ometto app.`,
        '',
        `Restaurant: ${restaurantName || '—'}`,
        `Status: ${isChangesApproval ? 'Changes Approved' : 'Approved'}`,
        '',
        'Team Ometto'
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
        ? 'Your Restaurant Changes have been Rejected | Ometto'
        : 'Your Restaurant has been Rejected | Ometto';

    const html = buildOmettoEmailHtml({
        greeting: 'Hello,',
        bannerType: 'rejection',
        bannerTitle: isChangesRejection ? 'Restaurant changes update' : 'Restaurant registration update',
        bannerMessage: isChangesRejection
            ? `We reviewed the updated details for <strong>${safeName}</strong> and were unable to approve the changes at this time.`
            : `We reviewed the registration for <strong>${safeName}</strong> and were unable to approve it at this time.`,
        introParagraphs: [
            'Please review the reason below, update your documents or profile details, and reapply when ready. Our team is happy to assist if you need clarification.'
        ],
        infoRows: [
            { label: 'Restaurant', value: restaurantName || '—' },
            { label: 'Status', value: 'Rejected' },
            { label: 'Reason', value: rejectionReason }
        ]
    });

    const text = [
        isChangesRejection
            ? 'Your restaurant changes on Ometto could not be approved.'
            : 'Your restaurant registration on Ometto could not be approved.',
        '',
        `Restaurant: ${restaurantName || '—'}`,
        'Status: Rejected',
        `Reason: ${rejectionReason}`,
        '',
        'Please review the reason below and reapply when ready.',
        '',
        'Team Ometto'
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
        ? '🎉 Your Delivery Partner Changes have been Approved | Ometto'
        : '🎉 Your Delivery Partner Account has been Approved | Ometto';

    const html = buildOmettoEmailHtml({
        greeting: 'Hello,',
        bannerType: 'success',
        bannerTitle: `Welcome ${firstName}!`,
        bannerMessage: isChangesApproval
            ? 'Your profile changes have been approved. You can continue delivering with Ometto.'
            : 'Your account is approved. You can now go online and start earning with Ometto.',
        infoRows: [
            { label: 'Partner Name', value: partnerName || '—' },
            { label: 'Status', value: isChangesApproval ? 'Changes Approved' : 'Approved' }
        ],
        introParagraphs: [
            'Open the Ometto delivery app, go online, and start accepting delivery requests in your zone.'
        ]
    });

    const text = [
        `Welcome ${getFirstName(partnerName)}!`,
        '',
        isChangesApproval
            ? 'Your delivery partner profile changes have been approved on Ometto.'
            : 'Your delivery partner account has been approved on Ometto.',
        '',
        `Partner: ${partnerName || '—'}`,
        `Status: ${isChangesApproval ? 'Changes Approved' : 'Approved'}`,
        '',
        'Team Ometto'
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
        ? 'Your Delivery Partner Changes have been Rejected | Ometto'
        : 'Your Delivery Partner Account has been Rejected | Ometto';

    const html = buildOmettoEmailHtml({
        greeting: 'Hello,',
        bannerType: 'rejection',
        bannerTitle: isChangesRejection ? 'Delivery partner changes update' : 'Delivery partner application update',
        bannerMessage: isChangesRejection
            ? `Hi <strong>${firstName}</strong>, we reviewed your updated profile details and were unable to approve the changes at this time.`
            : `Hi <strong>${firstName}</strong>, we reviewed your delivery partner application and were unable to approve it at this time.`,
        introParagraphs: [
            'Please review the reason below, correct any issues with your documents or profile, and reapply when ready.'
        ],
        infoRows: [
            { label: 'Partner Name', value: partnerName || '—' },
            { label: 'Status', value: 'Rejected' },
            { label: 'Reason', value: rejectionReason }
        ]
    });

    const text = [
        isChangesRejection
            ? 'Your delivery partner profile changes on Ometto could not be approved.'
            : 'Your delivery partner application on Ometto could not be approved.',
        '',
        `Partner: ${partnerName || '—'}`,
        'Status: Rejected',
        `Reason: ${rejectionReason}`,
        '',
        'Please review the reason below and reapply when ready.',
        '',
        'Team Ometto'
    ].join('\n');

    return sendEmail({
        to: recipient,
        subject,
        html,
        text,
        logLabel: `Delivery rejection email${partnerId ? ` (${partnerId})` : ''}`
    });
}
