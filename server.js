/**
 * HTTP server for the quote handler (`npm run dev` locally).
 * Settings come from environment variables; locally from .env (see env.example).
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import handler from './src/handler.js';

const MAX_BODY = 6 * 1024 * 1024;
const REQUIRED = ['BREVO_API_KEY', 'QUOTE_TO', 'QUOTE_FROM', 'ALLOWED_ORIGINS'];
const missing = REQUIRED.filter(name => !process.env[name]);
if (missing.length) {
    console.error(`Missing settings: ${missing.join(', ')}`);
    process.exit(1);
}

http.createServer(async (req, res) => {
    try {
        if (Number(req.headers['content-length']) > MAX_BODY) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'The request is too large.' }));
            return;
        }
        const hasBody = !['GET', 'HEAD'].includes(req.method);
        const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])),
            body: hasBody ? Readable.toWeb(req) : undefined,
            duplex: hasBody ? 'half' : undefined,
        });
        const response = await handler.fetch(request, process.env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
        console.error('server error', error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error.' }));
    }
}).listen(Number(process.env.PORT) || 8080, () => {
    console.log(`Quote server on port ${Number(process.env.PORT) || 8080}`);
});
