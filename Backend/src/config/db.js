import dns from 'dns';
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const CONNECT_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const PUBLIC_DNS = ['1.1.1.1', '8.8.8.8'];
const SRV_TIMEOUT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node's resolver cannot reach link-local IPv6 DNS servers (fe80::/10) because
 * getServers() reports them without a scope id, which surfaces as
 * "querySrv ECONNREFUSED" on mongodb+srv:// URIs. Keep only usable servers.
 */
const pruneUnusableDnsServers = () => {
    const servers = dns.getServers();
    const usable = servers.filter((s) => !/^fe80:/i.test(s));
    if (usable.length === servers.length) return;

    const next = usable.length ? usable : PUBLIC_DNS;
    dns.setServers(next);
    logger.info(`Dropped link-local DNS server(s); using ${next.join(', ')}`);
};

/**
 * mongodb+srv:// needs an SRV lookup before any connection is attempted, so a
 * broken local resolver kills startup. Verify the lookup works and fall back to
 * public DNS if it does not.
 * @param {string} uri
 * @returns {Promise<void>}
 */
const ensureSrvResolvable = async (uri) => {
    if (!uri || !uri.startsWith('mongodb+srv://')) return;

    const host = uri.split('@')[1]?.split(/[/?]/)[0];
    if (!host) return;
    const record = `_mongodb._tcp.${host}`;

    const systemServers = dns.getServers();
    const resolver = new dns.promises.Resolver({ timeout: SRV_TIMEOUT_MS, tries: 1 });
    resolver.setServers(systemServers);

    try {
        await resolver.resolveSrv(record);
        return;
    } catch (error) {
        logger.warn(`SRV lookup failed via ${systemServers.join(', ')}: ${error.message}`);
    }

    dns.setServers(PUBLIC_DNS);
    await dns.promises.resolveSrv(record);
    logger.info(`SRV lookup recovered using public DNS (${PUBLIC_DNS.join(', ')})`);
};

export const connectDB = async () => {
    pruneUnusableDnsServers();

    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
        try {
            await ensureSrvResolvable(config.mongodbUri);
            const conn = await mongoose.connect(config.mongodbUri, {
                serverSelectionTimeoutMS: 10000,  // Fail fast if Atlas is unreachable
                socketTimeoutMS: 45000,           // Close sockets after 45s of inactivity
                heartbeatFrequencyMS: 10000,      // Ping Atlas every 10s to keep connection alive
                maxIdleTimeMS: 30000,             // Drop idle connections after 30s
                retryWrites: true,
            });
            logger.info(`MongoDB connected: ${conn.connection.host}`);
            return;
        } catch (error) {
            if (attempt === CONNECT_RETRIES) {
                logger.error(`MongoDB connection error: ${error.message}`);
                process.exit(1);
            }
            logger.warn(`MongoDB connection attempt ${attempt}/${CONNECT_RETRIES} failed: ${error.message}`);
            await sleep(RETRY_DELAY_MS);
        }
    }
};

/**
 * Close MongoDB connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};
