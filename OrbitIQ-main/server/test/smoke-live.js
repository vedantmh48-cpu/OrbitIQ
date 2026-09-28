/**
 * Live smoke test for the real server wiring (app.js).
 * Boots the actual Express app in-process on an ephemeral port with an
 * unreachable database, then verifies health, CORS, validation and clean
 * "service unavailable" behavior — no MySQL or Gmail required.
 */
import assert from 'node:assert/strict';
import app from '../app.js';

// Point the pool at a port where nothing listens → connection refused.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';

const server = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    console.log('✔ GET /health → 200 {status:ok}');

    const preflight = await fetch(`${base}/api/contact`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://vedantmh48-cpu.github.io',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(preflight.status, 204);
    const origins = preflight.headers.get('access-control-allow-origin');
    assert.equal(origins, 'https://vedantmh48-cpu.github.io');
    console.log(`✔ CORS preflight (Pages origin) → 204, ACAO=${origins}`);

    const rejected = await fetch(`${base}/api/contact`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
    console.log('✔ CORS preflight (unknown origin) → rejected');

    const local = await fetch(`${base}/api/contact`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    console.log('✔ CORS preflight (Vite dev origin) → allowed');

    const badEmail = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: 'J', email: 'nope', message: 'hi' }),
    });
    assert.equal(badEmail.status, 400);
    console.log('✔ invalid email → 400');

    const badJson = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": "Jane",',
    });
    assert.equal(badJson.status, 400);
    console.log('✔ malformed JSON → 400');

    const dbDown = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', message: 'Hello' }),
    });
    assert.equal(dbDown.status, 503);
    const dbBody = await dbDown.json();
    assert.equal(dbBody.success, false);
    assert.ok(!JSON.stringify(dbBody).includes('refused'), 'no internals leaked');
    console.log('✔ DB down → 503 clean message, nothing leaked');

    console.log('\nSMOKE TEST PASSED');
    process.exitCode = 0;
  } catch (error) {
    console.error('\nSMOKE TEST FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});