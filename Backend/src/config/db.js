import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.mongodbUri, {
            serverSelectionTimeoutMS: 10000,  // Fail fast if Atlas is unreachable
            socketTimeoutMS: 45000,           // Close sockets after 45s of inactivity
            heartbeatFrequencyMS: 10000,      // Ping Atlas every 10s to keep connection alive
            maxIdleTimeMS: 30000,             // Drop idle connections after 30s
            retryWrites: true,
        });
        logger.info(`MongoDB connected: ${conn.connection.host}`);
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        process.exit(1);
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
