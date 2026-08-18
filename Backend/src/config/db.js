import dns from 'dns';
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Configure reliable DNS servers for MongoDB Atlas SRV resolution (prevents ECONNREFUSED on Windows)
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
    if (typeof dns.setDefaultResultOrder === 'function') {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch {
    // Non-fatal if DNS configuration is restricted in environment
}

export const connectDB = async (retries = 3, delay = 2000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const conn = await mongoose.connect(config.mongodbUri, {
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                heartbeatFrequencyMS: 10000,
                maxIdleTimeMS: 30000,
                retryWrites: true,
            });
            logger.info(`MongoDB connected: ${conn.connection.host}`);
            return conn;
        } catch (error) {
            logger.error(`MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}`);
            if (attempt === retries) {
                logger.error(`MongoDB connection error: ${error.message}`);
                process.exit(1);
            }
            await new Promise((res) => setTimeout(res, delay));
        }
    }
};

export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};
