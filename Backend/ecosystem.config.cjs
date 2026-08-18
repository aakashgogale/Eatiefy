/**
 * PM2 ecosystem for Ometto API + BullMQ workers.
 *
 * Usage (on live server, from Backend folder):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Safe rules:
 * - Start Redis BEFORE enabling REDIS_ENABLED / BULLMQ_ENABLED in .env
 * - API never crashes if Redis blips (queues degrade gracefully)
 * - Workers wait for Redis, then exit 0 (not 1) so PM2 doesn't hard crash-loop
 */
module.exports = {
  apps: [
    {
      name: 'ometto',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ometto-worker-order',
      script: 'src/queues/workers/order.worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'ometto-worker-payment',
      script: 'src/queues/workers/payment.worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'ometto-worker-notification',
      script: 'src/queues/workers/notification.worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'ometto-worker-tracking',
      script: 'src/queues/workers/tracking.worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'ometto-worker-otp',
      script: 'src/queues/workers/otp.worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
