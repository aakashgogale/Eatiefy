/**
 * Email delivery check - run it ON THE SERVER whose mail you want to test:
 *
 *   npm run email:check                          # setup + SMTP sign-in + domain DNS, sends nothing
 *   npm run email:check -- --to=owner@example.com   # also sends the real approval email there
 *
 * Secrets are never printed. Exit code 1 when email cannot work as configured.
 */
import { promises as dns } from 'dns';
import { verifyEmailTransport, sendRestaurantApprovalEmail } from '../src/utils/email.js';

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, ...rest] = arg.replace(/^--/, '').split('=');
        return [key, rest.join('=') || true];
    })
);

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const DKIM_SELECTORS = ['google', 'default', 'selector1', 'selector2', 'k1', 'k2', 'brevo1', 'brevo2', 's1', 's2', 'mail', 'dkim', 'resend', 'zoho', 'hostingermail1', 'hostingermail2'];
const GOOGLE_MANAGED_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const txt = async (name) => {
    try {
        return (await resolver.resolveTxt(name)).map((parts) => parts.join(''));
    } catch {
        return [];
    }
};

async function checkSenderDomain(domain, smtpHost) {
    if (GOOGLE_MANAGED_DOMAINS.has(domain)) {
        console.log(`  ${domain} is Google-managed: SPF/DKIM/DMARC are handled by Google.`);
        return true;
    }
    const spf = (await txt(domain)).find((record) => /^v=spf1/i.test(record));
    const dmarc = (await txt(`_dmarc.${domain}`)).find((record) => /^v=DMARC1/i.test(record));
    const dkim = [];
    for (const selector of DKIM_SELECTORS) {
        if ((await txt(`${selector}._domainkey.${domain}`)).some((record) => /p=/.test(record))) dkim.push(selector);
    }
    const googleSmtp = /(^|\.)(gmail|googlemail)\.com$/i.test(String(smtpHost || ''));

    console.log(`  SPF  : ${spf || 'MISSING'}`);
    if (spf && googleSmtp && !/include:_spf\.google\.com/i.test(spf)) {
        console.log('         -> sending through Google, but SPF does not include _spf.google.com');
    }
    console.log(`  DKIM : ${dkim.length ? `found (${dkim.join(', ')})` : 'MISSING (no common selector found - check your provider\'s selector)'}`);
    console.log(`  DMARC: ${dmarc || 'MISSING'}`);
    const ok = Boolean(spf && dkim.length && dmarc);
    if (!ok) {
        console.log(`  -> Mail "from" @${domain} is not authenticated: receivers are likely to junk or drop it.`);
        console.log('     Add the SPF, DKIM and DMARC records your mail provider gives you for this domain.');
    }
    return ok;
}

async function main() {
    console.log('== Eatiefy email check');
    const health = await verifyEmailTransport();
    console.log(`SMTP server : ${health.host || '(not set)'}:${health.port}`);
    console.log(`Sender      : ${health.from ? `${health.from.name} <${health.senderAddress}>` : '(none)'}`);
    health.errors.forEach((error) => console.log(`ERROR  : ${error}`));
    health.warnings.forEach((warning) => console.log(`WARNING: ${warning}`));
    console.log(`SMTP login  : ${health.verified ? 'OK' : `FAILED - ${health.error}`}`);

    let domainOk = true;
    if (health.senderDomain) {
        console.log(`\n== Sender domain ${health.senderDomain}`);
        domainOk = await checkSenderDomain(health.senderDomain, health.host);
    }

    if (args.to) {
        const to = String(args.to);
        console.log(`\n== Sending the approval email to ${to}`);
        const sent = await sendRestaurantApprovalEmail({
            to,
            restaurantName: 'Eatiefy email delivery test',
            restaurantId: 'email-check'
        });
        console.log(sent
            ? 'Accepted by the SMTP server (see the log line above for the message id).\nNow confirm it is in that inbox - check Spam/Promotions too.'
            : 'NOT sent - see the error logged above.');
        if (!sent) process.exitCode = 1;
    }

    if (!health.verified) {
        process.exitCode = 1;
        console.log('\nResult: email CANNOT be sent - fix the SMTP errors above first.');
    } else if (!domainOk) {
        console.log('\nResult: SMTP works, but the sender domain is not authenticated - fix DNS for reliable inbox delivery.');
    } else {
        console.log('\nResult: email setup looks good.');
    }
}

main()
    .catch((err) => {
        console.error('Email check crashed:', err);
        process.exitCode = 1;
    })
    .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 100));
