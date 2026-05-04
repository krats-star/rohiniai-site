# RohiniAI Tracking Worker

This Cloudflare Worker powers low-friction click tracking for `go.rohiniai.in`.

## Public links

Use these links publicly:

- `https://go.rohiniai.in/ask` redirects to the Custom GPT and records a `gpt_open`.
- `https://go.rohiniai.in/go/birth-chart` redirects to the birth chart affiliate link and records an `affiliate_click`.
- `https://go.rohiniai.in/go/compatibility` redirects to the compatibility affiliate link and records an `affiliate_click`.
- `https://go.rohiniai.in/go/report` redirects to the report affiliate link and records an `affiliate_click`.
- `https://go.rohiniai.in/go/consultation` redirects to the consultation affiliate link and records an `affiliate_click`.

Short versions such as `https://go.rohiniai.in/birth-chart` also work.

## Where stats are stored

Click stats are stored in Cloudflare D1, Cloudflare's built-in serverless SQL database for Workers. No separate database server is needed.

The Worker stores:

- click date/time
- link slug
- click type: `gpt_open` or `affiliate_click`
- country
- state/region
- city
- device type
- hashed visitor ID
- referrer host, when available

Raw IP addresses are not stored.

## Where affiliate links are edited

Edit affiliate destination URLs in:

```text
tracking-worker/src/links.js
```

Replace the placeholder `https://example.com/...` URLs with your real affiliate links, then redeploy the Worker.

## Admin dashboard

After deployment, open:

```text
https://go.rohiniai.in/admin
```

The browser will ask for a username and password.

- Username: `admin`
- Password: the Cloudflare secret named `ADMIN_PASSWORD`

The dashboard supports lookback windows:

```text
https://go.rohiniai.in/admin?days=7
https://go.rohiniai.in/admin?days=30
https://go.rohiniai.in/admin?days=90
```

## Cloudflare setup steps

Run these commands from this folder:

```bash
cd tracking-worker
npm install
npx wrangler login
npx wrangler d1 create rohiniai_clicks
```

Copy the printed `database_id` into `wrangler.toml`, replacing:

```text
REPLACE_WITH_D1_DATABASE_ID
```

Create the database tables:

```bash
npx wrangler d1 execute rohiniai_clicks --remote --file=./schema.sql
```

Set the admin password and visitor hash salt:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put VISITOR_SALT
```

Suggested first admin password:

```text
RohiniClicks@2026
```

Use a different random value for `VISITOR_SALT`; it is not something you need to remember.

Deploy:

```bash
npx wrangler deploy
```

In Cloudflare dashboard, add a Worker route:

```text
go.rohiniai.in/*
```

Assign it to the Worker:

```text
rohiniai-tracking
```

## Change or reset password

Run this any time from the `tracking-worker` folder:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Enter the new password when prompted, then open `/admin` again and log in with:

```text
admin / your-new-password
```
