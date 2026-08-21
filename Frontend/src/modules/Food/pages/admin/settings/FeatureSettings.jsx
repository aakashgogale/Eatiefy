import React, { useEffect, useMemo, useState } from 'react';
import { adminAPI } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@food/components/ui/card';
import { Button } from '@food/components/ui/button';
import { Switch } from '@food/components/ui/switch';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { invalidatePublicAppConfig } from '@food/services/publicAppConfig';

const FEATURE_KEYS = {
    RESTAURANT_SUBSCRIPTION: 'restaurant_subscription',
    ADMIN_ACCESS_SECTION: 'admin_access_section',
    ROOT_LANDING_AND_UNREGISTERED_CONTROL: 'root_landing_and_unregistered_control',
    DINING_CONTROL: 'dining_control'
};

const DEFAULT_INITIAL_FEATURES = [
    { key: FEATURE_KEYS.DINING_CONTROL, name: 'Dining & Table Booking', isEnabled: true },
    { key: FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, name: 'Restaurant Subscription', isEnabled: true },
    { key: FEATURE_KEYS.ADMIN_ACCESS_SECTION, name: 'Admin Access Section', isEnabled: true },
    { key: FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL, name: 'Root Landing & Unregistered Restaurants', isEnabled: true },
];

export default function FeatureSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [features, setFeatures] = useState(DEFAULT_INITIAL_FEATURES);

    const restaurantSubscription = useMemo(
        () => features.find((item) => item.key === FEATURE_KEYS.RESTAURANT_SUBSCRIPTION) || { key: FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, isEnabled: true },
        [features]
    );

    const adminAccessSection = useMemo(
        () => features.find((item) => item.key === FEATURE_KEYS.ADMIN_ACCESS_SECTION) || { key: FEATURE_KEYS.ADMIN_ACCESS_SECTION, isEnabled: true },
        [features]
    );

    const rootLandingAndUnregisteredControl = useMemo(
        () => features.find((item) => item.key === FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL) || { key: FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL, isEnabled: true },
        [features]
    );

    const diningControl = useMemo(
        () => features.find((item) => item.key === FEATURE_KEYS.DINING_CONTROL) || { key: FEATURE_KEYS.DINING_CONTROL, isEnabled: true },
        [features]
    );

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                const res = await adminAPI.getFeatureSettings();
                const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
                const merged = DEFAULT_INITIAL_FEATURES.map((def) => {
                    const found = rows.find((r) => r.key === def.key);
                    return found ? { ...def, ...found, isEnabled: Boolean(found.isEnabled) } : def;
                });
                setFeatures(merged);
            } catch (error) {
                toast.error('Failed to load feature settings.');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const setToggle = async (key, checked) => {
        const nextVal = Boolean(checked);
        setFeatures((prev) => {
            const exists = prev.some((row) => row.key === key);
            if (exists) {
                return prev.map((row) =>
                    row.key === key ? { ...row, isEnabled: nextVal } : row
                );
            }
            return [...prev, { key, isEnabled: nextVal }];
        });

        try {
            await adminAPI.updateFeatureSetting(key, { isEnabled: nextVal });
            invalidatePublicAppConfig();
            try {
                localStorage.setItem(`food_feature_${key}`, String(nextVal));
            } catch {}
            window.dispatchEvent(new CustomEvent('adminFeatureSettingUpdated', {
                detail: { key, isEnabled: nextVal }
            }));
            window.dispatchEvent(new CustomEvent('businessSettingsUpdated', {
                detail: { key, isEnabled: nextVal }
            }));
            const label = key === FEATURE_KEYS.DINING_CONTROL ? 'Dining & Table Booking' : 'Feature';
            toast.success(`${label} ${nextVal ? 'enabled' : 'disabled'} successfully`);
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to update feature setting');
            // Revert state on error
            setFeatures((prev) =>
                prev.map((row) =>
                    row.key === key ? { ...row, isEnabled: !nextVal } : row
                )
            );
        }
    };

    const handleSave = async () => {
        const targetKeys = [
            FEATURE_KEYS.DINING_CONTROL,
            FEATURE_KEYS.RESTAURANT_SUBSCRIPTION,
            FEATURE_KEYS.ADMIN_ACCESS_SECTION,
            FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL
        ];
        try {
            setSaving(true);
            await Promise.all(
                targetKeys.map((key) => {
                    const item = features.find((f) => f.key === key);
                    const isEnabled = item ? Boolean(item.isEnabled) : true;
                    return adminAPI.updateFeatureSetting(key, { isEnabled });
                })
            );
            invalidatePublicAppConfig();
            targetKeys.forEach((key) => {
                const item = features.find((f) => f.key === key);
                const isEnabled = item ? Boolean(item.isEnabled) : true;
                try {
                    localStorage.setItem(`food_feature_${key}`, String(isEnabled));
                } catch {}
                window.dispatchEvent(new CustomEvent('adminFeatureSettingUpdated', {
                    detail: { key, isEnabled }
                }));
                window.dispatchEvent(new CustomEvent('businessSettingsUpdated', {
                    detail: { key, isEnabled }
                }));
            });
            toast.success('Feature setting updated successfully.');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to update feature setting.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[320px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Feature Settings</h1>
                <p className="text-sm text-gray-500 mt-1">Enable or disable platform features safely from one place.</p>
            </div>

            <Card className="border-slate-200">
                <CardHeader>
                    <CardTitle className="text-lg">Dining & Table Booking</CardTitle>
                    <CardDescription>
                        Controls the Dining section in User App (Dining tab, restaurant dine-in profiles, table bookings), Restaurant panel reservations management, and Admin dining features.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                        {diningControl?.isEnabled
                            ? 'Enabled: Dining module is active across User, Restaurant, and Admin apps'
                            : 'Disabled: Dining module is completely hidden and deactivated'}
                    </div>
                    <Switch
                        checked={Boolean(diningControl?.isEnabled)}
                        onCheckedChange={(checked) => setToggle(FEATURE_KEYS.DINING_CONTROL, checked)}
                    />
                </CardContent>
            </Card>

            <Card className="border-slate-200">
                <CardHeader>
                    <CardTitle className="text-lg">Restaurant Subscription</CardTitle>
                    <CardDescription>
                        Controls post-approval onboarding payment, due checks, withdrawal restrictions, and subscription settings visibility.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                        {restaurantSubscription?.isEnabled
                            ? 'Enabled: subscription flows are active'
                            : 'Disabled: subscription flows are hidden and checks are bypassed'}
                    </div>
                    <Switch
                        checked={Boolean(restaurantSubscription?.isEnabled)}
                        onCheckedChange={(checked) => setToggle(FEATURE_KEYS.RESTAURANT_SUBSCRIPTION, checked)}
                    />
                </CardContent>
            </Card>

            <Card className="border-slate-200">
                <CardHeader>
                    <CardTitle className="text-lg">Admin Access Section</CardTitle>
                    <CardDescription>
                        Controls visibility of the Admin Access sidebar section, including Sub Admin List.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                        {adminAccessSection?.isEnabled
                            ? 'Enabled: Admin Access section is visible'
                            : 'Disabled: Admin Access section is hidden'}
                    </div>
                    <Switch
                        checked={Boolean(adminAccessSection?.isEnabled)}
                        onCheckedChange={(checked) => setToggle(FEATURE_KEYS.ADMIN_ACCESS_SECTION, checked)}
                    />
                </CardContent>
            </Card>

            <Card className="border-slate-200">
                <CardHeader>
                    <CardTitle className="text-lg">Root Landing & Unregistered Restaurants</CardTitle>
                    <CardDescription>
                        Controls root URL and Unregistered Restaurants visibility. OFF redirects root (/) to /food/user and hides Unregistered Restaurants.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                        {rootLandingAndUnregisteredControl?.isEnabled
                            ? 'Enabled: root opens Landing Page and Unregistered Restaurants is visible'
                            : 'Disabled: root redirects to /food/user and Unregistered Restaurants is hidden'}
                    </div>
                    <Switch
                        checked={Boolean(rootLandingAndUnregisteredControl?.isEnabled)}
                        onCheckedChange={(checked) => setToggle(FEATURE_KEYS.ROOT_LANDING_AND_UNREGISTERED_CONTROL, checked)}
                    />
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || (!diningControl && !restaurantSubscription && !adminAccessSection && !rootLandingAndUnregisteredControl)}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Changes
                </Button>
            </div>
        </div>
    );
}
