export const SETTINGS_ROW_ID = 'primary';

export const DEFAULT_APP_SETTINGS = Object.freeze({
    business_name: 'Abhishek Management',
    message_signature: 'Abhishek Management',
    default_payment_method: 'Cash',
    reminder_window_days: 7,
    reminder_default_bucket: 'all',
    default_contact_channel: 'whatsapp',
    default_layout: 'list',
    home_command_default: 'expanded',
    browser_alerts_default: false,
    whatsapp_templates: Object.freeze({
        due: 'Namaskar {name},\n\naapki EMI{emi_no_text} {due_date} ko due hai.\nLoan ID: {loan_id}\nDue amount: {amount}\n\nKripya due date tak payment complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- {signature}',
        overdue: 'Namaskar {name},\n\naapki EMI{emi_no_text} overdue hai.\nLoan ID: {loan_id}\nDue date: {due_date}\nPending amount: {amount}\n\nKripya payment jaldi complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- {signature}',
        payment: 'Namaskar {name},\n\naapka {payment_amount} payment receive ho gaya hai. ✅\nLoan ID: {loan_id}{emi_line}\nPayment date: {payment_date}\nEMI remaining: {emi_remaining}\n\nDhanyavaad.\n- {signature}',
        closing: 'Namaskar {name},\n\nLoan ID {loan_id} ka account {closing_status} hai.\nPrincipal: {principal}\nCollected: {collected}\nRemaining EMI balance: {remaining}\n\nAapke cooperation ke liye dhanyavaad.\n- {signature}'
    })
});

const PAYMENT_METHODS = new Set(['Cash', 'UPI', 'Bank Transfer', 'Other']);
const REMINDER_BUCKETS = new Set(['all', 'overdue', 'today', 'tomorrow', 'next7', 'partial']);
const CONTACT_CHANNELS = new Set(['whatsapp', 'call', 'manual']);
const LAYOUTS = new Set(['list', 'grid']);
const HOME_STATES = new Set(['expanded', 'compact']);

function text(value, fallback, max) {
    const v = String(value ?? '').trim();
    return (v || fallback).slice(0, max);
}

function bool(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
}

function intRange(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizeAppSettings(input = {}) {
    const templates = input?.whatsapp_templates || {};
    return {
        business_name: text(input.business_name, DEFAULT_APP_SETTINGS.business_name, 80),
        message_signature: text(input.message_signature, DEFAULT_APP_SETTINGS.message_signature, 80),
        default_payment_method: PAYMENT_METHODS.has(input.default_payment_method) ? input.default_payment_method : DEFAULT_APP_SETTINGS.default_payment_method,
        reminder_window_days: intRange(input.reminder_window_days, DEFAULT_APP_SETTINGS.reminder_window_days, 1, 14),
        reminder_default_bucket: REMINDER_BUCKETS.has(input.reminder_default_bucket) ? input.reminder_default_bucket : DEFAULT_APP_SETTINGS.reminder_default_bucket,
        default_contact_channel: CONTACT_CHANNELS.has(input.default_contact_channel) ? input.default_contact_channel : DEFAULT_APP_SETTINGS.default_contact_channel,
        default_layout: LAYOUTS.has(input.default_layout) ? input.default_layout : DEFAULT_APP_SETTINGS.default_layout,
        home_command_default: HOME_STATES.has(input.home_command_default) ? input.home_command_default : DEFAULT_APP_SETTINGS.home_command_default,
        browser_alerts_default: bool(input.browser_alerts_default, DEFAULT_APP_SETTINGS.browser_alerts_default),
        whatsapp_templates: {
            due: text(templates.due, DEFAULT_APP_SETTINGS.whatsapp_templates.due, 2000),
            overdue: text(templates.overdue, DEFAULT_APP_SETTINGS.whatsapp_templates.overdue, 2000),
            payment: text(templates.payment, DEFAULT_APP_SETTINGS.whatsapp_templates.payment, 2000),
            closing: text(templates.closing, DEFAULT_APP_SETTINGS.whatsapp_templates.closing, 2000)
        }
    };
}

export async function loadAppSettings(supabaseRequest) {
    const response = await supabaseRequest(`app_settings?id=eq.${SETTINGS_ROW_ID}&select=id,config,updated_at&limit=1`);
    const row = response.data?.[0] || null;
    return {
        id: SETTINGS_ROW_ID,
        settings: normalizeAppSettings(row?.config || DEFAULT_APP_SETTINGS),
        updated_at: row?.updated_at || null
    };
}

export const SETTINGS_PLACEHOLDERS = Object.freeze([
    '{name}', '{loan_id}', '{emi_no}', '{emi_no_text}', '{emi_line}', '{due_date}', '{amount}',
    '{payment_amount}', '{payment_date}', '{emi_remaining}', '{principal}', '{collected}', '{remaining}',
    '{closing_status}', '{business_name}', '{signature}'
]);
