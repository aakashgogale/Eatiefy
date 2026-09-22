/**
 * Sends ONE real OTP SMS through SMS India Hub and prints exactly what was sent
 * and what the provider answered. Use it to confirm delivery on a real phone
 * after changing the sender ID, template or credentials.
 *
 *   node test-otp-sms.mjs 98XXXXXXXX
 *
 * It uses the same code path as the app (src/core/otp/otp.service.js), does not
 * touch the database, and costs one SMS credit.
 */
import { config } from './src/config/env.js';
import { buildIndiaHubOtpMessage, sendSmsViaIndiaHub } from './src/core/otp/otp.service.js';

const phone = String(process.argv[2] || '').replace(/\D/g, '').slice(-10);
if (phone.length !== 10) {
    console.error('Usage: node test-otp-sms.mjs <10-digit mobile number>');
    process.exit(1);
}

const otp = String(Math.floor(1000 + Math.random() * 9000));
console.log('USE_DEFAULT_OTP :', config.useDefaultOtp, config.useDefaultOtp ? '  <- app still uses static 1234 and sends NO SMS' : '');
console.log('SMS_HUB_ENABLED :', config.smsHubEnabled, config.smsHubEnabled ? '' : '  <- app sends NO SMS until this is true');
console.log('Sender ID (sid) :', config.smsSenderId);
console.log('DLT template ID :', config.smsDltTemplateId);
console.log('Message         :', buildIndiaHubOtpMessage(otp));
console.log(`\nSending test OTP ${otp} to 91${phone} ...`);

try {
    await sendSmsViaIndiaHub(phone, otp);
    console.log('\nAccepted by SMS India Hub. If the phone still receives nothing within a minute,');
    console.log('open the delivery report for this number in the SMS India Hub panel: a DLT');
    console.log('rejection there means the sender ID is not the header linked to this template.');
    process.exit(0);
} catch (error) {
    console.error('\nNOT sent:', error.message, '(the provider response is logged above)');
    process.exit(1);
}
