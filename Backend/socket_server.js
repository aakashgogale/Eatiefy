import http from 'http';
import { config } from './src/config/env.js';
import { validateConfig } from './src/config/validateEnv.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { connectRedis, closeRedis } from './src/config/redis.js';
import { initSocket } from './src/config/socket.js';
import { initializeFirebaseRealtime } from './src/config/firebase.js';
import { logger } from './src/utils/logger.js';

let server = null;
let shuttingDown = false;

const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down socket server`);

    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await disconnectDB();
        await closeRedis();
        logger.info('Socket server shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error(`Socket server shutdown error: ${error.message}`);
        process.exit(1);
    }
};

const startSocketServer = async () => {
    try {
        validateConfig();
        initializeFirebaseRealtime();
        await connectDB();

        const httpServer = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ status: 'ok', service: 'socket' }));
        });

        await initSocket(httpServer);

        if (config.redisEnabled) {
            await connectRedis();
        }

        server = httpServer.listen(Number(config.socketPort), config.socketHost, () => {
            logger.info(`Socket server running on ${config.socketHost}:${config.socketPort}`);
        });

        server.on('error', (error) => {
            logger.error(`Socket server error: ${error.message}`);
            process.exit(1);
        });
    } catch (error) {
        logger.error(`Error starting socket server: ${error.message}`);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startSocketServer();