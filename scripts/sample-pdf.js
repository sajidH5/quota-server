// Local check without Brevo: posts a sample quote to the handler with the Brevo API stubbed out,
// prints what would be emailed and writes sample-quote.pdf.
import { writeFileSync } from 'node:fs';
import worker from '../src/handler.js';

const env = {
    QUOTE_TO: 'sajid@missooulaseogeek.com', QUOTE_FROM: 'sajid@missooulaseogeek.com', QUOTE_FROM_NAME: 'Braintree Scientific',
    ALLOWED_ORIGINS: 'https://braintree-staging.mybigcommerce.com', SEND_CONFIRMATION: 'true', BREVO_API_KEY: 'stub',
};
const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); };

const items = Array.from({ length: 14 }, (_, i) => ({
    sku: i % 3 ? `MDK-M-${i}` : 'SCRUFF-RAT-LARGE-VERY-LONG-SKU', name: i % 4 ? 'Mouse Dissection Surgical Kit with Storage Case' : 'Rodent Restrainer, Clear Acrylic, Adjustable Nose Cone for Rats 200-400 g × “special” µ',
    options: i % 2 ? ['Size: Large', 'Color: Blue'] : [], quantity: i + 1, unitPrice: 165 + i * 12.5,
}));
const form = new FormData();
Object.entries({
    name: 'Dr. Jane Smith', email: 'jane@example.edu', phone: '555-0100', institution: 'University of Example', department: 'Neuroscience',
    pi: 'Prof. Lee', street: '1 Campus Drive, Building 7', city: 'Boston', state: 'MA', zip: '02115', country: 'United States',
    po: 'PO-12345 / NIH grant R01', neededBy: '2026-11-30', taxExempt: 'yes', notes: 'Please include shipping to the loading dock. ' .repeat(8),
    currency: 'USD', elapsed: '45000', page: 'https://braintree-staging.mybigcommerce.com/cart.php', items: JSON.stringify(items),
}).forEach(([k, v]) => form.append(k, v));
form.append('certificate', new File([new Uint8Array(2048)], 'exempt cert.pdf', { type: 'application/pdf' }));

const request = new Request('https://quote.example/api/quotes', { method: 'POST', body: form, headers: { Origin: 'https://braintree-staging.mybigcommerce.com' } });
const response = await worker.fetch(request, env);
console.log(response.status, await response.text(), response.headers.get('access-control-allow-origin'));
sent.forEach(m => console.log('email to', m.to.map(t => t.email).join(), '| reply-to', m.replyTo.email, '|', m.subject, '|', m.attachment.map(a => `${a.name} (${Math.round(a.content.length * 0.75 / 1024)} KB)`).join(', ')));
if (sent[0]) writeFileSync(new URL('../sample-quote.pdf', import.meta.url), Buffer.from(sent[0].attachment[0].content, 'base64'));

// Rejections
const bad = async (fields, origin = 'https://braintree-staging.mybigcommerce.com') => {
    const f = new FormData(); Object.entries(fields).forEach(([k, v]) => f.append(k, v));
    const r = await worker.fetch(new Request('https://quote.example/api/quotes', { method: 'POST', body: f, headers: { Origin: origin } }), env);
    console.log(r.status, await r.text());
};
await bad({ name: 'x', email: 'nope', institution: 'y', elapsed: '9000', items: JSON.stringify(items) });
await bad({ name: 'x', email: 'a@b.co', institution: 'y', elapsed: '9000', items: '[]' });
await bad({ name: 'x', email: 'a@b.co', institution: 'y', elapsed: '9000', items: JSON.stringify(items), website: 'spam' });
await bad({ name: 'x' }, 'https://evil.example');
