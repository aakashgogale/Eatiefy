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

/**
 * Pool sizing for horizontal scaling:
 * total_connections ≈ instances × maxPoolSize
 * Keep Atlas/cluster connection budget in mind (e.g. 3 API × 20 = 60).
 */
function buildMongoOptions() {
    return {
        maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
        minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
        maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_MS || 30000),
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
        connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
        socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
        waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 10000),
        retryWrites: true,
        retryReads: true,
    };
}

export const connectDB = async (retries = 5, delayMs = 3000) => {
    if (!config.mongodbUri) {
        logger.error('MongoDB connection failed: MONGO_URI / MONGODB_URI environment variable is missing.');
        process.exit(1);
    }

    mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection runtime error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const options = buildMongoOptions();
            const conn = await mongoose.connect(config.mongodbUri, options);
            logger.info(
                `MongoDB connected: ${conn.connection.host} (pool max=${options.maxPoolSize} min=${options.minPoolSize})`,
            );
            return conn;
        } catch (error) {
            logger.warn(`MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}`);

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
