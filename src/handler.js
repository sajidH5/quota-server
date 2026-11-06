/**
 * Braintree "Request a quote" backend.
 *
 * POST /api/quotes (multipart form from the cart page, theme file assets/js/theme/global/bt-quote.js)
 *   -> checks the request, builds the quote PDF and emails it through the Brevo API to QUOTE_TO,
 *      with the tax-exempt certificate attached. Optionally sends the shopper a copy.
 * Settings: environment variables (see env.example). Runs as a Cloudflare Worker, or under server.js.
 */
import { quotePdf, money } from './pdf.js';

const MAX_FILE = 4 * 1024 * 1024; // Brevo's per-attachment limit
const MAX_ITEMS = 200;
const MIN_FILL_MS = 3000; // faster than this is a bot
const FIELDS = {
    name: 120, email: 160, phone: 40, institution: 160, department: 160, pi: 120,
    street: 200, city: 100, state: 100, zip: 20, country: 80,
    po: 120, neededBy: 20, taxExempt: 3, notes: 2000, currency: 3, page: 300,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class InputError extends Error {}

function cors(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
    return allowed.includes(origin) ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    } : null;
}

function json(body, status, headers) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function base64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function quoteNumber() {
    const now = new Date();
    const date = now.toISOString().slice(2, 10).replace(/-/g, '');
    const random = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 4).toUpperCase();
    return `Q-${date}-${random}`;
}

function readItems(raw) {
    let items;
    try {
        items = JSON.parse(raw || '[]');
    } catch (e) {
        throw new InputError('The cart items could not be read.');
    }
    if (!Array.isArray(items) || !items.length) throw new InputError('Your cart is empty.');
    if (items.length > MAX_ITEMS) throw new InputError('Too many items for one quote request.');

    return items.map(item => ({
        sku: String(item.sku || '').slice(0, 80),
        name: String(item.name || '').slice(0, 300),
        options: (Array.isArray(item.options) ? item.options : []).slice(0, 20).map(o => String(o).slice(0, 200)),
        quantity: Math.max(1, Math.min(100000, parseInt(item.quantity, 10) || 1)),
        unitPrice: Number(item.unitPrice),
        productId: item.productId,
        variantId: item.variantId,
    }));
}

/** The quote from the form, or an InputError. Returns null for bots (they get a fake success). */
async function readQuote(request) {
    let form;
    try {
        form = await request.formData();
    } catch (e) {
        throw new InputError('The form could not be read.');
    }

    if (form.get('website') || Number(form.get('elapsed')) < MIN_FILL_MS) return null;

    const quote = {};
    for (const [field, max] of Object.entries(FIELDS)) {
        const value = form.get(field);
        quote[field] = typeof value === 'string' ? value.trim().slice(0, max) : '';
    }
    if (!quote.name || !quote.institution) throw new InputError('Please fill in your name and institution.');
    if (!EMAIL.test(quote.email)) throw new InputError('Please enter a valid email address.');
    quote.currency = /^[A-Z]{3}$/.test(quote.currency) ? quote.currency : 'USD';
    quote.items = readItems(form.get('items'));

    const file = form.get('certificate');
    if (file && typeof file === 'object' && file.size) {
        if (file.size > MAX_FILE) throw new InputError('The certificate is larger than 4 MB. Please attach a smaller file.');
        if (!/^(application\/pdf|image\/)/.test(file.type || '')) throw new InputError('The certificate must be a PDF or an image.');
        quote.certificate = new Uint8Array(await file.arrayBuffer());
        quote.certificateName = (file.name || 'certificate').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    }
    return quote;
}

function itemsHtml(quote) {
    const rows = quote.items.map(item => `
        <tr>
            <td style="padding:6px 8px;border-top:1px solid #e0e4ec">${item.quantity}</td>
            <td style="padding:6px 8px;border-top:1px solid #e0e4ec">${escapeHtml(item.sku)}</td>
            <td style="padding:6px 8px;border-top:1px solid #e0e4ec">${escapeHtml(item.name)}${item.options.length ? `<br><small style="color:#5a6275">${escapeHtml(item.options.join(' / '))}</small>` : ''}</td>
            <td style="padding:6px 8px;border-top:1px solid #e0e4ec;text-align:right">${money(item.unitPrice, quote.currency)}</td>
        </tr>`).join('');
    return `<table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="background:#f3f6fb;text-align:left"><th style="padding:6px 8px">Qty</th><th style="padding:6px 8px">SKU</th><th style="padding:6px 8px">Product</th><th style="padding:6px 8px;text-align:right">Unit price</th></tr>
        ${rows}</table>`;
}

function staffHtml(quote) {
    const line = (label, value) => (value ? `<tr><td style="padding:2px 12px 2px 0;color:#5a6275">${label}</td><td>${escapeHtml(value)}</td></tr>` : '');
    const address = [quote.street, quote.city, quote.state, quote.zip, quote.country].filter(Boolean).join(', ');
    return `<div style="font-family:Arial,sans-serif;color:#14213d">
        <h2 style="color:#0b46b0;margin:0 0 4px">Quote request ${quote.number}</h2>
        <p style="margin:0 0 16px;color:#5a6275">${escapeHtml(quote.date)}. The PDF is attached. Reply to this email to answer the customer.</p>
        <table style="font-size:14px;margin-bottom:16px">
            ${line('Name', quote.name)}${line('Email', quote.email)}${line('Phone', quote.phone)}
            ${line('Institution', quote.institution)}${line('Department', quote.department)}${line('PI', quote.pi)}
            ${line('Ship to', address)}${line('PO / funding', quote.po)}${line('Needed by', quote.neededBy)}
            ${line('Tax exempt', quote.taxExempt === 'yes' ? `Yes${quote.certificateName ? ', certificate attached' : ', no certificate attached'}` : 'No')}
            ${line('Notes', quote.notes)}${line('Sent from', quote.page)}
        </table>
        ${itemsHtml(quote)}
    </div>`;
}

function customerHtml(quote) {
    return `<div style="font-family:Arial,sans-serif;color:#14213d">
        <p>Hi ${escapeHtml(quote.name)},</p>
        <p>Thank you for your quote request <strong>${quote.number}</strong>. We'll reply within one business day with pricing, lead times and PO instructions. A copy of your request is attached.</p>
        ${itemsHtml(quote)}
        <p style="margin-top:16px">Braintree Scientific<br>781-917-9526 · info@braintreesci.com</p>
    </div>`;
}

/** Sends through the Brevo API. BREVO_API_KEY=log prints the emails instead (local checks). */
async function sendEmail(env, message) {
    if (env.BREVO_API_KEY === 'log') {
        console.log('email (not sent):', message.subject, '->', message.to.map(t => t.email).join(),
            '| attachments:', message.attachment.map(a => a.name).join(', '));
        return;
    }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { email: env.QUOTE_FROM, name: env.QUOTE_FROM_NAME || 'Braintree Scientific' }, ...message }),
    });
    if (!response.ok) {
        throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
}

async function handleQuote(request, env, headers) {
    let quote;
    try {
        quote = await readQuote(request);
    } catch (error) {
        if (error instanceof InputError) return json({ error: error.message }, 400, headers);
        throw error;
    }
    const number = quoteNumber();
    if (!quote) return json({ number }, 200, headers); // bot: pretend it worked

    quote.number = number;
    quote.date = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' });
    const pdf = { name: `Quote-request-${number}.pdf`, content: base64(await quotePdf(quote)) };
    const attachments = [pdf];
    if (quote.certificate) attachments.push({ name: `Tax-exempt-${quote.certificateName}`, content: base64(quote.certificate) });

    await sendEmail(env, {
        to: env.QUOTE_TO.split(',').map(email => ({ email: email.trim() })),
        replyTo: { email: quote.email, name: quote.name },
        subject: `Quote request ${number}: ${quote.institution} (${quote.items.length} items)`,
        htmlContent: staffHtml(quote),
        attachment: attachments,
    });

    if (env.SEND_CONFIRMATION === 'true') {
        try {
            await sendEmail(env, {
                to: [{ email: quote.email, name: quote.name }],
                replyTo: { email: env.QUOTE_TO.split(',')[0].trim() },
                subject: `Your Braintree Scientific quote request ${number}`,
                htmlContent: customerHtml(quote),
                attachment: [pdf],
            });
        } catch (error) {
            console.error('confirmation email failed', error.message); // the request itself was sent
        }
    }
    return json({ number }, 200, headers);
}

export default {
    /** Fetch-style handler: a Request in, a Response out. */
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = cors(request, env);

        if (url.pathname !== '/api/quotes') return json({ error: 'Not found.' }, 404, {});
        if (!headers) return json({ error: 'This shop is not allowed to send quote requests.' }, 403, {});
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, headers);

        try {
            return await handleQuote(request, env, headers);
        } catch (error) {
            console.error('quote failed', error.stack || error.message);
            return json({ error: 'Your request could not be sent.' }, 502, headers);
        }
    },
};
