export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = 401;
    }
}

export class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
        this.statusCode = 403;
    }
}


export class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
    }
}

/**
 * Login was attempted with a phone number that has no account yet.
 * Carries a machine-readable `code` so clients can offer the register flow
 * instead of string-matching the message.
 */
export class NotRegisteredError extends Error {
    constructor(message, code = 'USER_NOT_REGISTERED') {
        super(message);
        this.name = 'NotRegisteredError';
        this.statusCode = 404;
        this.code = code;
    }
}
