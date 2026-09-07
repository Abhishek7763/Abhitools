import { noStore, requireAdmin, sendServerError, supabaseRequest } from '../server_shared.js';
import {
    DEFAULT_APP_SETTINGS,
    SETTINGS_PLACEHOLDERS,
    SETTINGS_ROW_ID,
    loadAppSettings,
    normalizeAppSettings
} from './settings_config.js';

const PUSH_SETTINGS_ROW_ID = 'admin_push_subscription';

function describeChanges(before, after) {
    const changed = [];
    for (const key of ['business_name','message_signature','default_payment_method','reminder_window_days','reminder_default_bucket','default_contact_channel','default_layout','home_command_default','browser_alerts_default']) {
        if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) changed.push(key);
    }
    for (const key of ['due','overdue','payment','closing']) {
        if (before?.whatsapp_templates?.[key] !== after?.whatsapp_templates?.[key]) changed.push(`template_${key}`);
    }
    return changed;
}

async function saveSettings(settings, action = 'UPDATE_APP_SETTINGS') {
    const normalized = normalizeAppSettings(settings);
    const now = new Date().toISOString();
    const rowRes = await supabaseRequest('app_settings?on_conflict=id', 'POST', {
        id: SETTINGS_ROW_ID,
        config: normalized,
        updated_at: now
    }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    return { normalized, row: rowRes.data?.[0] || { id: SETTINGS_ROW_ID, config: normalized, updated_at: now }, action };
}

export default async function handler(req, res) {
    noStore(res);
    if (!requireAdmin(req, res)) return;

    try {
        const action = String(req.query?.action || req.body?.action || '').trim().toLowerCase();

        if (req.method === 'GET') {
            if (action === 'push-public-key') {
                const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
                const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
                return res.status(200).json({
                    public_key: publicKey,
                    configured: Boolean(publicKey && privateKey)
                });
            }

            const current = await loadAppSettings(supabaseRequest);
            return res.status(200).json({
                ...current,
                defaults: DEFAULT_APP_SETTINGS,
                placeholders: SETTINGS_PLACEHOLDERS
            });
        }

        if (req.method === 'PUT') {
            if (!req.body?.settings || typeof req.body.settings !== 'object' || Array.isArray(req.body.settings)) {
                return res.status(400).json({ error: 'settings object is required' });
            }
            const before = await loadAppSettings(supabaseRequest);
            const saved = await saveSettings(req.body.settings);
            const changed = describeChanges(before.settings, saved.normalized);
            if (changed.length) {
                await supabaseRequest('activity_log', 'POST', {
                    action: 'UPDATE_APP_SETTINGS',
                    table_name: 'app_settings',
                    record_id: SETTINGS_ROW_ID,
                    description: `App settings updated: ${changed.slice(0, 20).join(', ')}`
                });
            }
            return res.status(200).json({
                success: true,
                settings: saved.normalized,
                updated_at: saved.row.updated_at,
                changed
            });
        }

        if (req.method === 'POST') {
            if (action === 'push-subscribe') {
                const subscription = req.body?.subscription;
                const endpoint = String(subscription?.endpoint || '').trim();
                const p256dh = String(subscription?.keys?.p256dh || '').trim();
                const auth = String(subscription?.keys?.auth || '').trim();
                const expirationRaw = subscription?.expirationTime;
                const expirationNumber = expirationRaw == null ? null : Number(expirationRaw);

                if (!endpoint.startsWith('https://') || endpoint.length > 2048 || !p256dh || p256dh.length > 512 || !auth || auth.length > 512) {
                    return res.status(400).json({ error: 'Valid push subscription is required' });
                }

                const normalizedSubscription = {
                    endpoint,
                    expirationTime: Number.isFinite(expirationNumber) ? expirationNumber : null,
                    keys: { p256dh, auth }
                };
                const now = new Date().toISOString();
                const rowRes = await supabaseRequest('app_settings?on_conflict=id', 'POST', {
                    id: PUSH_SETTINGS_ROW_ID,
                    config: { subscription: normalizedSubscription },
                    updated_at: now
                }, { Prefer: 'resolution=merge-duplicates,return=representation' });

                return res.status(200).json({
                    success: true,
                    subscribed: true,
                    updated_at: rowRes.data?.[0]?.updated_at || now
                });
            }

            if (action !== 'reset') return res.status(400).json({ error: 'Unsupported settings action' });
            if (String(req.body?.confirm || '') !== 'RESET SETTINGS') {
                return res.status(400).json({ error: 'Type RESET SETTINGS to reset defaults' });
            }
            const before = await loadAppSettings(supabaseRequest);
            await supabaseRequest('rpc/abhi_create_backup_snapshot', 'POST', {
                p_label: 'Before settings reset',
                p_reason: 'pre-settings-reset'
            });
            const saved = await saveSettings(DEFAULT_APP_SETTINGS, 'RESET_APP_SETTINGS');
            const changed = describeChanges(before.settings, saved.normalized);
            await supabaseRequest('activity_log', 'POST', {
                action: 'RESET_APP_SETTINGS',
                table_name: 'app_settings',
                record_id: SETTINGS_ROW_ID,
                description: `App settings reset to defaults${changed.length ? `: ${changed.slice(0, 20).join(', ')}` : ''}`
            });
            return res.status(200).json({
                success: true,
                settings: saved.normalized,
                updated_at: saved.row.updated_at,
                reset: true
            });
        }

        res.setHeader('Allow', 'GET, PUT, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return sendServerError(res, 'Settings API Error:', err);
    }
}
