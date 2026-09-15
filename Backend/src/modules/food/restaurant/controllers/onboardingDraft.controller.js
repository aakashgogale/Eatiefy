import { sendResponse } from '../../../../utils/response.js';
import {
    getOnboardingDraftUploads,
    addOnboardingDraftUpload,
    removeOnboardingDraftUpload
} from '../services/onboardingDraft.service.js';

export const getOnboardingDraftUploadsController = async (req, res, next) => {
    try {
        const uploads = await getOnboardingDraftUploads(req.registration.phoneLast10);
        return sendResponse(res, 200, 'Onboarding uploads fetched successfully', { uploads });
    } catch (error) {
        next(error);
    }
};

export const addOnboardingDraftUploadController = async (req, res, next) => {
    try {
        const result = await addOnboardingDraftUpload(
            req.registration.phoneLast10,
            req.body?.field,
            req.file
        );
        return sendResponse(res, 201, 'File uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const removeOnboardingDraftUploadController = async (req, res, next) => {
    try {
        const uploads = await removeOnboardingDraftUpload(
            req.registration.phoneLast10,
            req.body?.field ?? req.query?.field,
            req.body?.url ?? req.query?.url
        );
        return sendResponse(res, 200, 'File removed successfully', { uploads });
    } catch (error) {
        next(error);
    }
};
