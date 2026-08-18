import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import { sendResponse } from '../../../../utils/response.js';
import { storeImageBuffer, deleteStoredAssets, extractAssetUrl } from '../../../../services/storage.service.js';

export async function getBusinessSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne().lean();
        if (!settings) {
            // Create default settings if none exist
            settings = await FoodBusinessSettings.create({
                companyName: 'Appzeto',
                email: 'admin@appzeto.com'
            });
        }
        return sendResponse(res, 200, 'Business settings fetched successfully', settings);
    } catch (error) {
        next(error);
    }
}

export async function updateBusinessSettings(req, res, next) {
    try {
        // Safer data parsing that handles both JSON and multipart/form-data
        let data = {};
        try {
            if (req.body.data) {
                data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
            } else {
                data = req.body;
            }
        } catch (err) {
            return res.status(400).json({ success: false, message: 'Invalid data format' });
        }

        const { companyName, email, phoneCountryCode, phoneNumber, address, state, pincode, region, removeLogo, removeFavicon } = data;

        // Ensure string inputs for validation to prevent crashes from non-string values
        const s_companyName = String(companyName || "").trim();
        const s_email = String(email || "").trim();
        const s_phoneNumber = String(phoneNumber || "").trim();
        const s_address = String(address || "").trim();
        const s_state = String(state || "").trim();
        const s_pincode = String(pincode || "").trim();
        const shouldRemoveLogo = removeLogo === true || removeLogo === 'true' || removeLogo === 1 || removeLogo === '1';
        const shouldRemoveFavicon = removeFavicon === true || removeFavicon === 'true' || removeFavicon === 1 || removeFavicon === '1';

        // Validation
        if (!s_companyName || s_companyName.length < 2 || s_companyName.length > 50) {
            return res.status(400).json({ success: false, message: 'Company name must be between 2 and 50 characters' });
        }
        if (!s_email || s_email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s_email)) {
            return res.status(400).json({ success: false, message: 'Invalid email address (max 100 characters)' });
        }
        if (!s_phoneNumber || !/^\d{7,15}$/.test(s_phoneNumber)) {
            return res.status(400).json({ success: false, message: 'Invalid phone number (7-15 digits required)' });
        }
        if (s_address && s_address.length > 250) {
            return res.status(400).json({ success: false, message: 'Address is too long (max 250 characters)' });
        }
        if (s_state && s_state.length > 50) {
            return res.status(400).json({ success: false, message: 'State name is too long (max 50 characters)' });
        }
        if (s_pincode && !/^\d{4,10}$/.test(s_pincode)) {
            return res.status(400).json({ success: false, message: 'Invalid pincode (4-10 digits required)' });
        }

        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings();
        }

        if (s_companyName) settings.companyName = s_companyName;
        if (s_email) settings.email = s_email;
        if (phoneCountryCode || s_phoneNumber) {
            settings.phone = {
                countryCode: String(phoneCountryCode || settings.phone?.countryCode || '+91').trim(),
                number: s_phoneNumber || settings.phone?.number || ''
            };
        }
        // Always persist optional text fields (including empty = cleared)
        if (address !== undefined) settings.address = s_address;
        if (state !== undefined) settings.state = s_state;
        if (pincode !== undefined) settings.pincode = s_pincode;
        if (region !== undefined) settings.region = String(region || 'India').trim() || 'India';

        // Handle file uploads
        if (req.files) {
            if (req.files.logo) {
                const logoResult = await storeImageBuffer(req.files.logo[0].buffer, 'business/logos', {
                    replaceUrl: extractAssetUrl(settings.logo)
                });
                settings.logo = {
                    url: logoResult.secure_url,
                    publicId: logoResult.public_id
                };
            }
            if (req.files.favicon) {
                const faviconResult = await storeImageBuffer(req.files.favicon[0].buffer, 'business/favicons', {
                    replaceUrl: extractAssetUrl(settings.favicon)
                });
                settings.favicon = {
                    url: faviconResult.secure_url,
                    publicId: faviconResult.public_id
                };
            }
        }

        // Explicit removals (only when no replacement file was uploaded)
        if (shouldRemoveLogo && !(req.files && req.files.logo)) {
            await deleteStoredAssets(settings.logo);
            settings.logo = { url: '', publicId: '' };
            settings.markModified('logo');
        }
        if (shouldRemoveFavicon && !(req.files && req.files.favicon)) {
            await deleteStoredAssets(settings.favicon);
            settings.favicon = { url: '', publicId: '' };
            settings.markModified('favicon');
        }

        await settings.save();
        return sendResponse(res, 200, 'Business settings updated successfully', settings);
    } catch (error) {
        next(error);
    }
}
