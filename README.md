# Odds API on port 3088

## Ubuntu setup

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping
sudo apt install -y nodejs npm # or use your existing supported Node.js version
npm install
npm install -g pm2
```

## Secrets (do not commit these)

Set the two credentials in your shell or PM2 environment, e.g.:

```bash
export UPSTREAM_API_KEY='YOUR_API_KEY'
export UPSTREAM_API_SECRET='YOUR_API_SECRET'
```

Or use a process manager / secret manager. The .env.example is a template only; this project does not auto-load .env.

## Run

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 list
pm2 logs odds-api-3088
```

Test validation without needing live upstream:

```bash
curl -i 'http://127.0.0.1:3088/sportapi/privateData'
```

## Cache policy

- privateData: 600ms, key `(gmid, sportsid)` (marketId is still passed upstream)
- sportsResult: 1000ms, key `(gmid, sportsid)`
- casinoData: 600ms, key `(gtype)`
- casinoResult: 1000ms, key `(gtype, mid)`
- Only successful responses cached; errors retain original status/body wrapper.
- Redis shared across workers, per-worker pending request deduplication, Redis NX lock.
- If Redis is unavailable or lock waits longer than 3.5s, calls go upstream; duplicates can occur.
- A lock may expire if upstream takes >10s; exact-once upstream calls are not guaranteed.

## Security

Keep Redis on loopback, do not expose it to the internet. Rotate credentials that have been shared in chat. For production, use a reverse proxy with HTTPS and rate limits. Load-test before assuming a particular request capacity.
