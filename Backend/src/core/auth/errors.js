export class ValidationError extends Error {
    // `code` lets clients branch on a specific failure (e.g. RESTAURANT_MISMATCH)
    // instead of pattern-matching the human-readable message.
    constructor(message, code) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
        if (code) this.code = code;
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

