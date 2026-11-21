const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const app = require('../src/app');
const { DEMO_PASSWORD } = require('../src/auth/identities');
const loginLimiter = require('../src/middleware/loginLimiter');

// In-Memory HTTP Dispatcher (Runs completely in-process without socket dependencies)
function api(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = Readable.from(bodyStr ? [bodyStr] : []);
    req.method = method.toUpperCase();
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bodyStr),
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => {
      res._headers[k.toLowerCase()] = v;
    };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    let chunks = [];
    res.write = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return true;
    };
    res.end = (c) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      const resBody = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(resBody);
      } catch {
        parsed = resBody;
      }
      resolve({ status: res.statusCode, data: parsed });
    };
    res.json = (json) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    };
    res.send = (data) => {
      if (typeof data === 'object') return res.json(data);
      res.end(data);
    };

    app(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, data: { error: 'NOT_FOUND' } });
    });
  });
}

const login = (body) => api('POST', '/api/auth/login', { body });

describe('CertiFlow Login: passwords, lockout and token safety', () => {
  beforeEach(() => loginLimiter.reset());

  test('1. Login without a password is rejected (no token)', async () => {
    const res = await login({ username: 'farah' });
    assert.equal(res.status, 400);
    assert.equal(res.data.token, undefined);
  });

  test('2. Wrong password is rejected with 401 and no token', async () => {
    const res = await login({ username: 'farah', password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'INVALID_CREDENTIALS');
    assert.equal(res.data.token, undefined);
  });

  test('3. Unknown user and wrong password give the same answer (no user guessing)', async () => {
    const unknown = await login({ username: 'nobody', password: 'whatever' });
    const wrong = await login({ username: 'farah', password: 'whatever' });
    assert.equal(unknown.status, wrong.status);
    assert.equal(unknown.data.message, wrong.data.message);
  });

  test('4. Names from the JS prototype ("constructor", "__proto__") are not users', async () => {
    for (const username of ['constructor', '__proto__', 'toString']) {
      const res = await login({ username, password: DEMO_PASSWORD });
      assert.equal(res.status, 401, `${username} must not log in`);
    }
  });

  test('5. Correct password logs in and never leaks the password hash', async () => {
    const res = await login({ username: 'farah', password: DEMO_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.equal(res.data.user.role, 'STATE_OFFICE');
    assert.ok(!JSON.stringify(res.data).includes('passwordHash'));
    assert.ok(!JSON.stringify(res.data).includes('scrypt$'));
  });

  test('6. After 5 wrong passwords the account is locked, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      const bad = await login({ username: 'dev', password: `bad-${i}` });
      assert.equal(bad.status, 401);
    }
    const locked = await login({ username: 'dev', password: DEMO_PASSWORD });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error, 'TOO_MANY_ATTEMPTS');
    assert.equal(locked.data.token, undefined);
  });

  test('7. Lockout is per user: one locked user does not block another', async () => {
    for (let i = 0; i < 5; i++) await login({ username: 'dev', password: 'bad' });
    const other = await login({ username: 'meera', password: DEMO_PASSWORD });
    assert.equal(other.status, 200);
  });

  test('8. A successful login resets the failure counter', async () => {
    for (let i = 0; i < 4; i++) await login({ username: 'kabir', password: 'bad' });
    const ok = await login({ username: 'kabir', password: DEMO_PASSWORD });
    assert.equal(ok.status, 200);
    for (let i = 0; i < 4; i++) {
      const res = await login({ username: 'kabir', password: 'bad' });
      assert.equal(res.status, 401, 'counter should have restarted from zero');
    }
  });

  test('9. A tampered token (role changed to STATE_OFFICE) is rejected', async () => {
    const res = await login({ username: 'anika', password: DEMO_PASSWORD });
    const [h, p, s] = res.data.token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.role = 'STATE_OFFICE';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    const me = await api('GET', '/api/auth/me', { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(me.status, 401);
  });

  test('10. Server refuses to start in production without JWT_SECRET', () => {
    const jwtPath = require.resolve('../src/auth/jwt');
    const saved = { env: process.env.NODE_ENV, secret: process.env.JWT_SECRET };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      delete require.cache[jwtPath];
      assert.throws(() => require('../src/auth/jwt'), /JWT_SECRET/);
    } finally {
      if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
      if (saved.secret !== undefined) process.env.JWT_SECRET = saved.secret;
      delete require.cache[jwtPath];
    }
  });
});
