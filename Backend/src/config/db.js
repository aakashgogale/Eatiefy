import mongoose from 'mongoose';
import dns from 'dns';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Ensure IPv4 is preferred for DNS queries (fixes Windows Node SRV resolution bugs)
try {
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch (e) {
    // Ignore
}

export const connectDB = async (retries = 5, delayMs = 3000) => {
    if (!config.mongodbUri) {
        logger.error('MongoDB connection failed: MONGO_URI / MONGODB_URI environment variable is missing.');
        process.exit(1);
    }

    // Log runtime connection errors post-connect
    mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection runtime error: ${err.message}`);
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const conn = await mongoose.connect(config.mongodbUri, {
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000,
            });
            logger.info(`MongoDB connected: ${conn.connection.host}`);
            return conn;
        } catch (error) {
            logger.warn(`MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}`);

            // If DNS SRV lookup failed on local resolver, switch to public DNS (Google / Cloudflare)
            if (error.message && (error.message.includes('querySrv') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED'))) {
                try {
                    logger.info('Retrying MongoDB connection with fallback public DNS (8.8.8.8, 1.1.1.1)...');
                    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
                } catch (dnsErr) {
                    // Ignore
                }
            }

            if (attempt === retries) {
                logger.error(`MongoDB connection error: ${error.message}`);
                process.exit(1);
            }
            await new Promise((res) => setTimeout(res, delayMs));
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

