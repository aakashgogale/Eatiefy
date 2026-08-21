import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';

const DEFAULT_ACCESS_SECRET = 'eatiefy_default_jwt_access_secret_key_2026_fallback';
const DEFAULT_REFRESH_SECRET = 'eatiefy_default_jwt_refresh_secret_key_2026_fallback';

export const signAccessToken = (payload) => {
    return jwt.sign(payload, config.jwtAccessSecret || DEFAULT_ACCESS_SECRET, {
        expiresIn: config.jwtAccessExpiresIn || '7d'
    });
};

export const signRefreshToken = (payload) => {
    return jwt.sign(payload, config.jwtRefreshSecret || DEFAULT_REFRESH_SECRET, {
        expiresIn: config.jwtRefreshExpiresIn || '30d'
    });
};

export const verifyAccessToken = (token) => {
    try {
        return jwt.verify(token, config.jwtAccessSecret || DEFAULT_ACCESS_SECRET);
    } catch (e) {
        if (config.jwtAccessSecret) {
            return jwt.verify(token, DEFAULT_ACCESS_SECRET);
        }
        throw e;
    }
};

export const verifyRefreshToken = (token) => {
    try {
        return jwt.verify(token, config.jwtRefreshSecret || DEFAULT_REFRESH_SECRET);
    } catch (e) {
        if (config.jwtRefreshSecret) {
            return jwt.verify(token, DEFAULT_REFRESH_SECRET);
        }
        throw e;
    }
};

