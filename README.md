# Quote server

Backend for the cart page's "Request a quote" form. It turns the request into a PDF and emails it through the Brevo API. It runs as a Cloudflare Worker, or as a small Node server (`server.js`).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sajidH5/quota-server)

- `POST /api/quotes`: the form, sent by `assets/js/theme/global/bt-quote.js`.
- **Staff email:** goes to `QUOTE_TO`. The PDF and the tax-exempt certificate (if any, up to 4 MB) are attached, and Reply goes to the shopper.
- **Shopper email:** a confirmation with the PDF, sent when `SEND_CONFIRMATION=true`.
- **Spam:** a hidden field and a 3-second minimum fill time. Bots get a fake success.
- **Allowed shops:** only the domains in `ALLOWED_ORIGINS` can post the form.

The settings are environment variables: see `env.example`. The sender in `QUOTE_FROM` must be a verified sender in Brevo.

## Run locally

```bash
npm install
cp env.example .env       # fill in the Brevo API key
npm run dev               # http://localhost:8080
npm run dev:worker        # the same code in Cloudflare's local runtime
```

For the local theme (`stencil start`), set `bt-quote-endpoint` in `config.json` to `http://localhost:8080`. Don't commit that change.

## Deploy to Cloudflare

1. Click the button above and sign in to Cloudflare and GitHub. Cloudflare copies this repo to your GitHub account and deploys from there.
2. Fill in the three settings it asks for:
   - `BREVO_API_KEY`: a Brevo API key with Transactional emails access. Leave Brevo's Authorised IPs check off, because Cloudflare's addresses change.
   - `QUOTE_TO`: where quote requests go (comma separated).
   - `QUOTE_FROM`: the sender. It must be a verified sender in Brevo.
3. Send the Worker's address (`quota-server.<your-subdomain>.workers.dev`) to whoever manages the theme. It goes in the theme setting `bt-quote-endpoint`.

Use the Workers Paid plan. Building the PDF takes more than the Free plan's 10 ms of CPU per request, so Free can reject quote requests with Error 1102.

To change a setting later: Cloudflare dashboard › Workers & Pages › quota-server › Settings. `QUOTE_FROM_NAME`, `ALLOWED_ORIGINS` and `SEND_CONFIRMATION` are in `wrangler.jsonc`.

## Deploy (Firebase App Hosting)

```bash
firebase deploy --only apphosting
```

`.env` is in `.gitignore`, so `firebase deploy` doesn't upload it. Set the settings on the backend first, or the server stops with "Missing settings". `apphosting.yaml` holds the server size: max 2 instances, 512 MiB.

## Check

| Command | What it does |
|---|---|
| `npm run sample-pdf` | Runs the handler with the Brevo API stubbed out and writes `sample-quote.pdf` |
| `BREVO_API_KEY=log` in `.env` | The server prints the emails instead of sending them |
| Firebase console › App Hosting › braintree-quote › Logs | Logs of the deployed server, including failed emails |
