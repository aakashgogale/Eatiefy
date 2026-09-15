import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const phoneSchema = z
    .string()
    .min(8, 'Phone must be at least 8 digits')
    .max(15, 'Phone must be at most 15 digits');

const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const aadharRegex = /^[0-9]{12}$/;
const drivingLicenseRegex = /^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/;

const deliveryRegisterSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    phone: phoneSchema,
    email: z.string().trim().min(1, 'Email is required').email('Valid email is required'),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().optional(),
    drivingLicenseNumber: z
        .string()
        .regex(drivingLicenseRegex, 'Invalid driving license format')
        .optional()
        .or(z.literal('')),
    ref: z.string().trim().max(64).optional().or(z.literal('')),
    panNumber: z
        .string()
        .regex(panRegex, 'Invalid PAN format')
        .optional()
        .or(z.literal('')),
    aadharNumber: z
        .string()
        .regex(aadharRegex, 'Invalid Aadhar format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.enum(['web', 'mobile']).optional().default('web')
});

export const validateDeliveryRegisterDto = (body) => {
    const result = deliveryRegisterSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

const deliveryProfileUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().trim().email('Valid email is required').optional().or(z.literal('')),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().optional(),
    drivingLicenseNumber: z
        .string()
        .regex(drivingLicenseRegex, 'Invalid driving license format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.enum(['web', 'mobile']).optional().default('web')
});

export const validateDeliveryProfileUpdateDto = (body) => {
    const result = deliveryProfileUpdateSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

/*
 * Bank details are normalised before validation so valid details from any bank are
 * accepted: spaces/hyphens people type into account numbers and IFSC codes are
 * stripped, case is fixed, and the rules follow the RBI/NPCI formats rather than
 * one bank's conventions (account numbers vary from 6 to 20 characters by bank).
 * An empty string still clears a field.
 */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const BANK_ACCOUNT_NUMBER_REGEX = /^[A-Z0-9]{6,20}$/;
export const UPI_ID_REGEX = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$/;

export const normalizeBankAccountNumber = (value) =>
    String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
export const normalizeIfscCode = (value) =>
    String(value ?? '').replace(/\s/g, '').toUpperCase();
const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const optionalNormalized = (normalize) =>
    z.preprocess((value) => (value === undefined || value === null ? undefined : normalize(value)), z.string().optional());

const bankDetailsSchema = z.object({
    accountHolderName: optionalNormalized(normalizeText)
        .refine((v) => !v || (v.length >= 2 && v.length <= 100 && /[A-Za-z]/.test(v)), 'Enter a valid account holder name'),
    accountNumber: optionalNormalized(normalizeBankAccountNumber)
        .refine((v) => !v || (BANK_ACCOUNT_NUMBER_REGEX.test(v) && /\d/.test(v)), 'Enter a valid bank account number (6-20 characters)'),
    ifscCode: optionalNormalized(normalizeIfscCode)
        .refine((v) => !v || IFSC_REGEX.test(v), 'Enter a valid 11-character IFSC code (e.g. SBIN0001234)'),
    bankName: optionalNormalized(normalizeText)
        .refine((v) => !v || v.length <= 100, 'Bank name is too long'),
    upiId: optionalNormalized((v) => String(v).trim())
        .refine((v) => !v || UPI_ID_REGEX.test(v), 'Enter a valid UPI ID (e.g. name@bank)'),
    upiQrCode: z.string().optional().or(z.literal(''))
}).superRefine((b, ctx) => {
    // A payout needs both the account number and the branch IFSC.
    if (b.accountNumber && b.ifscCode === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'IFSC code is required with the account number' });
    }
    if (b.ifscCode && b.accountNumber === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Account number is required with the IFSC code' });
    }
});

const bankDetailsUpdateSchema = z.object({
    documents: z.object({
        bankDetails: bankDetailsSchema.optional(),
        pan: z.object({
            number: optionalNormalized((v) => String(v).replace(/\s/g, '').toUpperCase())
                .refine((v) => !v || panRegex.test(v), 'Enter a valid PAN number (e.g. ABCDE1234F)')
        }).optional()
    }).optional()
}).optional();

export const validateDeliveryBankDetailsDto = (body) => {
    // If we have flat keys from FormData (multer), reconstruct the nested object for Zod
    const processed = { ...body };
    if (!processed.documents) processed.documents = {};
    if (!processed.documents.bankDetails) {
        processed.documents.bankDetails = {
            accountHolderName: body['documents[bankDetails][accountHolderName]'],
            accountNumber: body['documents[bankDetails][accountNumber]'],
            ifscCode: body['documents[bankDetails][ifscCode]'],
            bankName: body['documents[bankDetails][bankName]'],
            upiId: body['documents[bankDetails][upiId]'],
            upiQrCode: body['documents[bankDetails][upiQrCode]']
        };
    }
    if (!processed.documents.pan && body['documents[pan][number]']) {
        processed.documents.pan = { number: body['documents[pan][number]'] };
    }

    const result = bankDetailsUpdateSchema.safeParse(processed);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

