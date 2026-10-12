// 'use strict';

// const express = require('express');
// const axios = require('axios');
// const { createClient } = require('redis');
// const crypto = require('node:crypto');
// const http = require('node:http');
// const https = require('node:https');

// const app = express();
// const PORT = Number(process.env.PORT || 3088);
// const API_BASE_URL = process.env.API_BASE_URL || 'http://13.140.57.215:3000/sport';
// const HEADERS = {
//   'x-api-key': process.env.UPSTREAM_API_KEY || '1cfdeb5a7b55d02111f3e2bd324f609f2330c928',
//   'x-api-secret': process.env.UPSTREAM_API_SECRET || '0e3be4c11c551261575a87b50a0b14da1c87c50aada2770c765a1ed6f2d5b84b'
// };
// const BETFAIR_MATCHES_URL = process.env.BETFAIR_MATCHES_URL || 'http://200.97.175.210:4909/matches';
// const CASINO_BASE_URL = process.env.CASINO_BASE_URL || 'http://13.140.57.215:3000/casino';

// // Keep connections alive to reduce upstream TCP connection churn.
// const upstream = axios.create({
//   httpAgent: new http.Agent({ keepAlive: true, maxSockets: 512 }),
//   httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 512 })
// });

// const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', socket: { reconnectStrategy: (retries) => Math.min(100 * retries, 2000) } });
// redis.on('error', (error) => console.error('Redis:', error.message));
// redis.connect().catch((error) => console.error('Redis connect:', error.message));

// const localPending = new Map();
// const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// const cacheKey = (route, values) => `sportapi:v1:${route}:${JSON.stringify(values.map(String))}`;
// const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

// async function getCache(key) {
//   if (!redis.isReady) return null;
//   try {
//     const raw = await redis.get(key);
//     return raw === null ? null : JSON.parse(raw);
//   } catch (error) {
//     console.error('Redis get:', error.message);
//     return null;
//   }
// }

// async function setCache(key, result, ttlMs) {
//   if (!redis.isReady) return;
//   try {
//     await redis.set(key, JSON.stringify(result), { PX: ttlMs });
//   } catch (error) {
//     console.error('Redis set:', error.message);
//   }
// }

// async function releaseLock(key, token) {
//   if (!redis.isReady) return;
//   try {
//     await redis.eval(RELEASE_LOCK, { keys: [key], arguments: [token] });
//   } catch (error) {
//     console.error('Redis unlock:', error.message);
//   }
// }

// async function requestUpstream(url, options = {}) {
//   try {
//     const response = await upstream.get(url, options);
//     return { status: 200, body: response.data, success: true };
//   } catch (error) {
//     console.error(`Error fetching ${url}:`, error.message);
//     return {
//       status: error.response?.status || 500,
//       body: { error: error.response?.data || 'Internal Server Error' },
//       success: false
//     };
//   }
// }

// async function cachedRequest(key, ttlMs, loader) {
//   const cached = await getCache(key);
//   if (cached !== null) return cached;
//   if (localPending.has(key)) return localPending.get(key);

//   const work = (async () => {
//     // Redis is optional for availability: fall back to the upstream if disconnected.
//     if (!redis.isReady) return loader();
//     const lockKey = `${key}:lock`;
//     const token = crypto.randomUUID();
//     const deadline = Date.now() + 3500;
//     try {
//       while (Date.now() < deadline && redis.isReady) {
//         const acquired = await redis.set(lockKey, token, { NX: true, PX: 10000 });
//         if (acquired === 'OK') {
//           try {
//             const checkAgain = await getCache(key);
//             if (checkAgain !== null) return checkAgain;
//             const result = await loader();
//             if (result.success) await setCache(key, result, ttlMs);
//             return result;
//           } finally {
//             await releaseLock(lockKey, token);
//           }
//         }
//         await sleep(25);
//         const populated = await getCache(key);
//         if (populated !== null) return populated;
//       }
//     } catch (error) {
//       console.error('Redis lock:', error.message);
//     }
//     // Bound waiting time: slow upstream/Redis should not hang all clients.
//     return loader();
//   })();

//   localPending.set(key, work);
//   try {
//     return await work;
//   } finally {
//     if (localPending.get(key) === work) localPending.delete(key);
//   }
// }

// const sendResult = (res, result) => res.status(result.status).json(result.body);
// const fetchFromApi = async (path, params, res) => {
//   const result = await requestUpstream(`${API_BASE_URL}${path}`, { headers: HEADERS, params });
//   return sendResult(res, result);
// };

// // 1. GET /sportapi
// app.get('/sportapi', async (req, res) => fetchFromApi('', {}, res));

// // 2. GET /sportapi/match-list -- original merge and error behavior retained
// // app.get('/sportapi/match-list', async (req, res) => {
// //   try {
// //     const { sportsid } = req.query;
// //     if (!sportsid) return res.status(400).json({ error: 'sportsid query parameter is required' });

// //     const diamondResponse = await upstream.get(`${API_BASE_URL}/matches`, { headers: HEADERS, params: { sportsid } });
// //     const diamondData = diamondResponse.data;
// //     const betfairResponse = await upstream.get(BETFAIR_MATCHES_URL, { timeout: 5000 });
// //     const betfairMatches = betfairResponse.data?.data?.t1 || [];
// //     const betfairMap = new Map();
// //     betfairMatches.forEach((bf) => {
// //       if (bf.eventid != null) betfairMap.set(String(bf.eventid), String(bf.gid || bf.gameId || ''));
// //     });
// //     const diamondMatches = diamondData?.data?.t1 || [];
// //     diamondMatches.forEach((diamond) => {
// //       const btid = betfairMap.get(String(diamond.gmid));
// //       diamond.btid = btid || '';
// //     });
// //     return res.status(200).json(diamondData);
// //   } catch (error) {
// //     console.error('Error fetching match-list:', error.response?.data || error.message);
// //     return res.status(error.response?.status || 500).json({ error: error.response?.data || 'Internal Server Error' });
// //   }
// // });

// app.get('/sportapi/match-list', async (req, res) => {
//   try {
//     const { sportsid } = req.query;

//     if (!sportsid) {
//       return res.status(400).json({
//         error: 'sportsid query parameter is required'
//       });
//     }

//     // -----------------------------
//     // 1. Get Diamond matches
//     // -----------------------------
//     const diamondResponse = await upstream.get(
//       `${API_BASE_URL}/matches`,
//       {
//         headers: HEADERS,
//         params: { sportsid }
//       }
//     );

//     const diamondData = diamondResponse.data;

//     // -----------------------------
//     // 2. Get Betfair matches
//     // -----------------------------
//     const betfairResponse = await upstream.get(
//       BETFAIR_MATCHES_URL,
//       {
//         timeout: 5000
//       }
//     );

//     const betfairMatches =
//       betfairResponse.data?.data?.t1 || [];

//     // -----------------------------
//     // 3. Create Betfair maps
//     // -----------------------------

//     // gmid -> eventid
//     const betfairGmidMap = new Map();

//     // ename -> eventid (fallback)
//     const betfairNameMap = new Map();

//     betfairMatches.forEach((bf) => {
//       const gmid = String(bf?.gmid ?? '').trim();
//       const eventid = String(bf?.eventid ?? '').trim();

//       const name = String(
//         bf?.ename || bf?.eventName || ''
//       )
//         .trim()
//         .toLowerCase();

//       if (gmid && eventid) {
//         betfairGmidMap.set(gmid, eventid);
//       }

//       if (name && eventid) {
//         betfairNameMap.set(name, eventid);
//       }
//     });

//     // -----------------------------
//     // 4. Add btid to Diamond
//     // -----------------------------
//     const diamondMatches =
//       diamondData?.data?.t1 || [];

//     diamondMatches.forEach((diamond) => {

//       const diamondGmid = String(
//         diamond?.gmid ?? ''
//       ).trim();

//       // First try: Diamond gmid == Betfair gmid
//       let btid = betfairGmidMap.get(diamondGmid);

//       // Second try: match name
//       if (!btid) {
//         const diamondName = String(
//           diamond?.ename || diamond?.eventName || ''
//         )
//           .trim()
//           .toLowerCase();

//         btid = betfairNameMap.get(diamondName);
//       }

//       diamond.btid = btid || '';
//     });

//     return res.status(200).json(diamondData);

//   } catch (error) {
//     console.error(
//       'Error fetching match-list:',
//       error.response?.data || error.message
//     );

//     return res.status(
//       error.response?.status || 500
//     ).json({
//       error:
//         error.response?.data ||
//         'Internal Server Error'
//     });
//   }
// });
// // 3. GET /sportapi/privateData -- 600ms, marketId intentionally excluded from key.
// app.get('/sportapi/privateData', async (req, res) => {
//   const { marketId, gmid, sportsid } = req.query;
//   if (!marketId || !gmid || !sportsid) return res.status(400).json({ error: 'marketId, gmid, and sportsid query parameters are required' });
//   const key = cacheKey('privateData', [gmid, sportsid]);
//   const result = await cachedRequest(key, 600, () => requestUpstream(`${API_BASE_URL}/odds`, { headers: HEADERS, params: { marketId, gmid, sportsid } }));
//   return sendResult(res, result);
// });

// // 4. GET /sportapi/sportsResult -- 1000ms
// app.get('/sportapi/sportsResult', async (req, res) => {
//   const { sportsid, gmid } = req.query;
//   if (!sportsid || !gmid) return res.status(400).json({ error: 'sportsid and gmid query parameters are required' });
//   const key = cacheKey('sportsResult', [gmid, sportsid]);
//   const result = await cachedRequest(key, 1000, () => requestUpstream(`${API_BASE_URL}/market-result`, { headers: HEADERS, params: { sportsid, gmid } }));
//   return sendResult(res, result);
// });

// // 5. GET /sportapi/tv1/sports -- uncached
// app.get('/sportapi/tv1/sports', async (req, res) => {
//   const { sportsid, gmid } = req.query;
//   if (!sportsid || !gmid) return res.status(400).json({ error: 'sportsid and gmid query parameters are required' });
//   return fetchFromApi('/tv1/sports', { sportsid, gmid }, res);
// });

// // 6. GET /casinoapi/casinoResult -- 1000ms
// app.get('/casinoapi/casinoResult', async (req, res) => {
//   const { gtype, mid } = req.query;
//   if (!gtype || !mid) return res.status(400).json({ error: 'gtype and mid query parameters are required' });
//   const key = cacheKey('casinoResult', [gtype, mid]);
//   const result = await cachedRequest(key, 1000, () => requestUpstream(`${CASINO_BASE_URL}/result-details`, { headers: HEADERS, params: { gtype, mid } }));
//   return sendResult(res, result);
// });

// // 7. GET /casinoapi/casinoData -- 600ms
// app.get('/casinoapi/casinoData', async (req, res) => {
//   const { gtype } = req.query;
//   if (!gtype) return res.status(400).json({ error: 'gtype query parameter is required' });
//   const key = cacheKey('casinoData', [gtype]);
//   const result = await cachedRequest(key, 600, () => requestUpstream(`${CASINO_BASE_URL}/data`, { headers: HEADERS, params: { gtype } }));
//   return sendResult(res, result);
// });

// app.listen(PORT, () => console.log(`Server running locally on http://localhost:${PORT} (PID ${process.pid})`));




'use strict';

const express = require('express');
const axios = require('axios');
const { createClient } = require('redis');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const app = express();

// Direct client IP allowlist. No trust proxy: X-Forwarded-For cannot bypass it.
// Configure ALLOWED_IPS as comma-separated IPs, e.g. 203.0.113.10,198.51.100.20
const allowedIPs = new Set(
  (process.env.ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean)
);
if (allowedIPs.size === 0) {
  console.error('ALLOWED_IPS is required. Refusing to start without an IP allowlist.');
  process.exit(1);
}
app.disable('trust proxy');
app.use((req, res, next) => {
  const remoteIP = req.socket.remoteAddress || '';
  const clientIP = remoteIP.startsWith('::ffff:') ? remoteIP.slice(7) : remoteIP;
  if (!allowedIPs.has(clientIP)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
const PORT = Number(process.env.PORT || 3088);
const API_BASE_URL = process.env.API_BASE_URL || 'http://13.140.57.215:3000/sport';
const HEADERS = {
  'x-api-key': process.env.UPSTREAM_API_KEY || '',
  'x-api-secret': process.env.UPSTREAM_API_SECRET || ''
};
const BETFAIR_MATCHES_URL = process.env.BETFAIR_MATCHES_URL || 'http://200.97.175.210:4909/matches';
const CASINO_BASE_URL = process.env.CASINO_BASE_URL || 'http://13.140.57.215:3000/casino';

// Keep connections alive to reduce upstream TCP connection churn.
const upstream = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 512 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 512 })
});

const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', socket: { reconnectStrategy: (retries) => Math.min(100 * retries, 2000) } });
redis.on('error', (error) => console.error('Redis:', error.message));
redis.connect().catch((error) => console.error('Redis connect:', error.message));

const localPending = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cacheKey = (route, values) => `sportapi:v1:${route}:${JSON.stringify(values.map(String))}`;
const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

async function getCache(key) {
  if (!redis.isReady) return null;
  try {
    const raw = await redis.get(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    console.error('Redis get:', error.message);
    return null;
  }
}

async function setCache(key, result, ttlMs) {
  if (!redis.isReady) return;
  try {
    await redis.set(key, JSON.stringify(result), { PX: ttlMs });
  } catch (error) {
    console.error('Redis set:', error.message);
  }
}

async function releaseLock(key, token) {
  if (!redis.isReady) return;
  try {
    await redis.eval(RELEASE_LOCK, { keys: [key], arguments: [token] });
  } catch (error) {
    console.error('Redis unlock:', error.message);
  }
}

async function requestUpstream(url, options = {}) {
  try {
    const response = await upstream.get(url, options);
    return { status: 200, body: response.data, success: true };
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return {
      status: error.response?.status || 500,
      body: { error: error.response?.data || 'Internal Server Error' },
      success: false
    };
  }
}

async function cachedRequest(key, ttlMs, loader) {
  const cached = await getCache(key);
  if (cached !== null) return cached;
  if (localPending.has(key)) return localPending.get(key);

  const work = (async () => {
    // Redis is optional for availability: fall back to the upstream if disconnected.
    if (!redis.isReady) return loader();
    const lockKey = `${key}:lock`;
    const token = crypto.randomUUID();
    const deadline = Date.now() + 3500;
    try {
      while (Date.now() < deadline && redis.isReady) {
        const acquired = await redis.set(lockKey, token, { NX: true, PX: 10000 });
        if (acquired === 'OK') {
          try {
            const checkAgain = await getCache(key);
            if (checkAgain !== null) return checkAgain;
            const result = await loader();
            if (result.success) await setCache(key, result, ttlMs);
            return result;
          } finally {
            await releaseLock(lockKey, token);
          }
        }
        await sleep(25);
        const populated = await getCache(key);
        if (populated !== null) return populated;
      }
    } catch (error) {
      console.error('Redis lock:', error.message);
    }
    // Bound waiting time: slow upstream/Redis should not hang all clients.
    return loader();
  })();

  localPending.set(key, work);
  try {
    return await work;
  } finally {
    if (localPending.get(key) === work) localPending.delete(key);
  }
}

const sendResult = (res, result) => res.status(result.status).json(result.body);
const fetchFromApi = async (path, params, res) => {
  const result = await requestUpstream(`${API_BASE_URL}${path}`, { headers: HEADERS, params });
  return sendResult(res, result);
};

// 1. GET /sportapi
app.get('/sportapi', async (req, res) => fetchFromApi('', {}, res));

// 2. GET /sportapi/match-list -- original merge and error behavior retained
// app.get('/sportapi/match-list', async (req, res) => {
//   try {
//     const { sportsid } = req.query;
//     if (!sportsid) return res.status(400).json({ error: 'sportsid query parameter is required' });

//     const diamondResponse = await upstream.get(`${API_BASE_URL}/matches`, { headers: HEADERS, params: { sportsid } });
//     const diamondData = diamondResponse.data;
//     const betfairResponse = await upstream.get(BETFAIR_MATCHES_URL, { timeout: 5000 });
//     const betfairMatches = betfairResponse.data?.data?.t1 || [];
//     const betfairMap = new Map();
//     betfairMatches.forEach((bf) => {
//       if (bf.eventid != null) betfairMap.set(String(bf.eventid), String(bf.gid || bf.gameId || ''));
//     });
//     const diamondMatches = diamondData?.data?.t1 || [];
//     diamondMatches.forEach((diamond) => {
//       const btid = betfairMap.get(String(diamond.gmid));
//       diamond.btid = btid || '';
//     });
//     return res.status(200).json(diamondData);
//   } catch (error) {
//     console.error('Error fetching match-list:', error.response?.data || error.message);
//     return res.status(error.response?.status || 500).json({ error: error.response?.data || 'Internal Server Error' });
//   }
// });

app.get('/sportapi/match-list', async (req, res) => {
  try {
    const { sportsid } = req.query;

    if (!sportsid) {
      return res.status(400).json({
        error: 'sportsid query parameter is required'
      });
    }

    // -----------------------------
    // 1. Get Diamond matches
    // -----------------------------
    const diamondResponse = await upstream.get(
      `${API_BASE_URL}/matches`,
      {
        headers: HEADERS,
        params: { sportsid }
      }
    );

    const diamondData = diamondResponse.data;

    // -----------------------------
    // 2. Get Betfair matches
    // -----------------------------
    const betfairResponse = await upstream.get(
      BETFAIR_MATCHES_URL,
      {
        timeout: 5000
      }
    );

    const betfairMatches =
      betfairResponse.data?.data?.t1 || [];

    // -----------------------------
    // 3. Create Betfair maps
    // -----------------------------

    // gmid -> eventid
    const betfairGmidMap = new Map();

    // ename -> eventid (fallback)
    const betfairNameMap = new Map();

    betfairMatches.forEach((bf) => {
      const gmid = String(bf?.gmid ?? '').trim();
      const eventid = String(bf?.eventid ?? '').trim();

      const name = String(
        bf?.ename || bf?.eventName || ''
      )
        .trim()
        .toLowerCase();

      if (gmid && eventid) {
        betfairGmidMap.set(gmid, eventid);
      }

      if (name && eventid) {
        betfairNameMap.set(name, eventid);
      }
    });

    // -----------------------------
    // 4. Add btid to Diamond
    // -----------------------------
    const diamondMatches =
      diamondData?.data?.t1 || [];

    diamondMatches.forEach((diamond) => {

      const diamondGmid = String(
        diamond?.gmid ?? ''
      ).trim();

      // First try: Diamond gmid == Betfair gmid
      let btid = betfairGmidMap.get(diamondGmid);

      // Second try: match name
      if (!btid) {
        const diamondName = String(
          diamond?.ename || diamond?.eventName || ''
        )
          .trim()
          .toLowerCase();

        btid = betfairNameMap.get(diamondName);
      }

      diamond.btid = btid || '';
    });

    return res.status(200).json(diamondData);

  } catch (error) {
    console.error(
      'Error fetching match-list:',
      error.response?.data || error.message
    );

    return res.status(
      error.response?.status || 500
    ).json({
      error:
        error.response?.data ||
        'Internal Server Error'
    });
  }
});

// 3. GET /sportapi/privateData -- 600ms, marketId intentionally excluded from key.
app.get('/sportapi/privateData', async (req, res) => {
  const { marketId, gmid, sportsid } = req.query;
  if (!marketId || !gmid || !sportsid) return res.status(400).json({ error: 'marketId, gmid, and sportsid query parameters are required' });
  const key = cacheKey('privateData', [gmid, sportsid]);
  const result = await cachedRequest(key, 600, () => requestUpstream(`${API_BASE_URL}/odds`, { headers: HEADERS, params: { marketId, gmid, sportsid } }));
  return sendResult(res, result);
});

// 4. GET /sportapi/sportsResult -- 1000ms
app.get('/sportapi/sportsResult', async (req, res) => {
  const { sportsid, gmid } = req.query;
  if (!sportsid || !gmid) return res.status(400).json({ error: 'sportsid and gmid query parameters are required' });
  const key = cacheKey('sportsResult', [gmid, sportsid]);
  const result = await cachedRequest(key, 1000, () => requestUpstream(`${API_BASE_URL}/market-result`, { headers: HEADERS, params: { sportsid, gmid } }));
  return sendResult(res, result);
});

// 5. GET /sportapi/tv1/sports -- uncached
app.get('/sportapi/tv1/sports', async (req, res) => {
  const { sportsid, gmid } = req.query;
  if (!sportsid || !gmid) return res.status(400).json({ error: 'sportsid and gmid query parameters are required' });
  return fetchFromApi('/tv1/sports', { sportsid, gmid }, res);
});

// 6. GET /casinoapi/casinoResult -- 1000ms
app.get('/casinoapi/casinoResult', async (req, res) => {
  const { gtype, mid } = req.query;
  if (!gtype || !mid) return res.status(400).json({ error: 'gtype and mid query parameters are required' });
  const key = cacheKey('casinoResult', [gtype, mid]);
  const result = await cachedRequest(key, 1000, () => requestUpstream(`${CASINO_BASE_URL}/result-details`, { headers: HEADERS, params: { gtype, mid } }));
  return sendResult(res, result);
});

// 7. GET /casinoapi/casinoData -- 600ms
app.get('/casinoapi/casinoData', async (req, res) => {
  const { gtype } = req.query;
  if (!gtype) return res.status(400).json({ error: 'gtype query parameter is required' });
  const key = cacheKey('casinoData', [gtype]);
  const result = await cachedRequest(key, 600, () => requestUpstream(`${CASINO_BASE_URL}/data`, { headers: HEADERS, params: { gtype } }));
  return sendResult(res, result);
});

app.listen(PORT, () => console.log(`Server running locally on http://localhost:${PORT} (PID ${process.pid})`));
