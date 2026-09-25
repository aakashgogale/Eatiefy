// Extra arguments are printed too: calls like logger.error('Send failed:', err)
// used to drop `err` silently, which hid the real cause of production failures.
export const logger = {
    info: (msg, ...details) => console.log(`✅ [INFO] ${new Date().toLocaleTimeString()}: ${msg}`, ...details),
    error: (msg, ...details) => console.error(`❌ [ERROR] ${new Date().toLocaleTimeString()}: ${msg}`, ...details),
    warn: (msg, ...details) => console.warn(`⚠️ [WARN] ${new Date().toLocaleTimeString()}: ${msg}`, ...details)
};
