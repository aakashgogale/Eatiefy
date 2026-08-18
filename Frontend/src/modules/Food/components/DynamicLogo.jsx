import React, { useState, useEffect } from 'react';
import { getModuleLogoUrl, loadBusinessSettings } from '@food/utils/businessSettings';

/**
 * DynamicLogo automatically fetches and displays the correct logo from the business settings.
 * It listens for updates, ensuring the logo changes instantly when updated in the admin panel.
 * 
 * @param {string} module - Which app's logo to show: "user", "restaurant", or "delivery"
 * @param {string} fallback - The local fallback image (e.g. quickSpicyLogo) to show if dynamic fails
 * @param {string} className - CSS classes for styling
 * @param {string} alt - Alt text for the image
 */
export default function DynamicLogo({ module = 'user', fallback, className = '', alt = "Logo" }) {
    const [logoUrl, setLogoUrl] = useState(() => getModuleLogoUrl(module));

    useEffect(() => {
        let mounted = true;

        const fetchLogo = async () => {
            if (!logoUrl) {
                await loadBusinessSettings();
                if (mounted) setLogoUrl(getModuleLogoUrl(module));
            }
        };
        fetchLogo();
        
        const onUpdate = () => {
            if (mounted) setLogoUrl(getModuleLogoUrl(module));
        };
        
        window.addEventListener('businessSettingsUpdated', onUpdate);
        return () => {
            mounted = false;
            window.removeEventListener('businessSettingsUpdated', onUpdate);
        };
    }, [module, logoUrl]);

    return (
        <img 
            src={logoUrl || fallback} 
            alt={alt} 
            className={className} 
            loading="lazy"
            decoding="async"
            onError={(e) => {
                // If it fails to load the dynamic logo, fallback to the local one
                if (fallback && e.target.src !== fallback && !e.target.src.includes(fallback)) {
                    e.target.src = fallback;
                }
            }}
        />
    );
}
