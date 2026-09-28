import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { createContactRouter } from '../contact.js';

/* Fakes — same shape as the real store/mailer from db.js & mailer.js */
function makeStore(overrides = {}) {
  const calls = { inserts: [] };
  const store = {
    async insertMessage(payload) {
      calls.inserts.push(payload);
      if (overrides.failInsert) throw new Error(overrides.failInsert);
      return { id: 42, ...payload, created_at: new Date('2026-09-23T12:00:00Z') };
    },
  };
  return { store, calls };
}

function makeMailer(overrides = {}) {
  const calls = { admin: [], user: [] };
  const mailer = {
    async sendAdminNotification(record) {
      if (overrides.failAdmin) throw new Error(overrides.failAdmin);
      calls.admin.push(record);
    },
    async sendUserConfirmation(record) {
      if (overrides.failUser) throw new Error(overrides.failUser);
      calls.user.push(record);
    },
  };
  return { mailer, calls };
}

/* Boot an ephemeral HTTP server around the router */
async function startServer({ store, mailer } = {}) {
  const defaults = makeStore();
  const mails = makeMailer();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));
  app.use(createContactRouter({ store: store || defaults.store, mailer: mailer || mails.mailer }));
  // Mirrors the error handler in index.js
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid request body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request too large.' });
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  });

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls: defaults.calls,
    mailCalls: mails.calls,
    close: () => server.close(),
  };
}

const VALID_BODY = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  subject: 'Partnership',
  message: 'Hello OrbitIQ, I would like to talk.',
};

async function postJson(base, body) {
  return fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  test('valid submission → 201 success; row stored; admin + user emails both sent', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, VALID_BODY);
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.id, 42);

      assert.equal(env.calls.inserts.length, 1);
      const row = env.calls.inserts[0];
      assert.equal(row.name, 'Jane Doe');
      assert.equal(row.email, 'jane@example.com');
      assert.equal(row.subject, 'Partnership');
      assert.equal(row.message, 'Hello OrbitIQ, I would like to talk.');

      assert.equal(env.mailCalls.admin.length, 1, 'admin email must be sent');
      assert.equal(env.mailCalls.user.length, 1, 'user confirmation must be sent');
      assert.equal(env.mailCalls.admin[0].email, 'jane@example.com');
    } finally {
      env.close();
    }
  });

  test('whitespace is trimmed before storing', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, {
        name: '  Jane Doe  ',
        email: '  jane@example.com  ',
        subject: '  Partnership  ',
        message: '  Hello OrbitIQ  ',
      });
      assert.equal(res.status, 201);
      const row = env.calls.inserts[0];
      assert.equal(row.name, 'Jane Doe');
      assert.equal(row.email, 'jane@example.com');
      assert.equal(row.subject, 'Partnership');
      assert.equal(row.message, 'Hello OrbitIQ');
    } finally {
      env.close();
    }
  });

  test('empty name → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, name: '' });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.match(json.error.message, /Name is required/);
      assert.equal(env.calls.inserts.length, 0);
      assert.equal(env.mailCalls.admin.length, 0);
    } finally {
      env.close();
    }
  });

  test('missing email → 400', async () => {
    const env = await startServer();
    try {
      const body = { ...VALID_BODY };
      delete body.email;
      const res = await postJson(env.base, body);
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /Email is required/);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('invalid email → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, email: 'not-an-email' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /valid email/);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('empty message → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, message: '   ' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /Message is required/);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('non-string name (array) → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, name: ['Jane'] });
      assert.equal(res.status, 400);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('name longer than 255 → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, name: 'a'.repeat(256) });
      assert.equal(res.status, 400);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('message longer than 5000 → 400', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, message: 'm'.repeat(5001) });
      assert.equal(res.status, 400);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('subject longer than 255 → 400 (optional but length-limited)', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, subject: 's'.repeat(256) });
      assert.equal(res.status, 400);
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('subject omitted / empty is fine', async () => {
    const env = await startServer();
    try {
      const body = { ...VALID_BODY };
      delete body.subject;
      const res = await postJson(env.base, body);
      assert.equal(res.status, 201);
      assert.equal(env.calls.inserts[0].subject, '');
    } finally {
      env.close();
    }
  });

  test('malformed JSON → 400 with clean message', async () => {
    const env = await startServer();
    try {
      const res = await fetch(`${env.base}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name": "Jane",',
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.message, 'Invalid request body.');
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('oversized body → 413 with clean message', async () => {
    const env = await startServer();
    try {
      const res = await postJson(env.base, { ...VALID_BODY, message: 'x'.repeat(20_000) });
      assert.equal(res.status, 413);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.message, 'Request too large.');
      assert.equal(env.calls.inserts.length, 0);
    } finally {
      env.close();
    }
  });

  test('database failure → 503, no emails, never a fake success', async () => {
    const { store, calls } = makeStore({ failInsert: 'connection refused' });
    const env = await startServer({ store });
    try {
      const res = await postJson(env.base, VALID_BODY);
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.message, 'Service temporarily unavailable. Please try again later.');
      assert.ok(!JSON.stringify(json).includes('connection refused'), 'SQL details must not leak');
      assert.equal(json.insertId, undefined);
      assert.equal(calls.inserts.length, 1); // attempted
      assert.equal(env.mailCalls.admin.length, 0);
      assert.equal(env.mailCalls.user.length, 0);
    } finally {
      env.close();
    }
  });

  test('SMTP failure → submission NOT lost; still 201 success:true', async () => {
    const { mailer } = makeMailer({ failAdmin: 'smtp auth failed', failUser: 'smtp auth failed' });
    const env = await startServer({ mailer });
    try {
      const res = await postJson(env.base, VALID_BODY);
      assert.equal(res.status, 201, 'DB row is the source of truth — email failure must not lose it');
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.id, 42);
      assert.equal(env.calls.inserts.length, 1, 'row still stored');
      assert.equal(env.mailCalls.admin.length, 0, 'admin send attempted and failed');
      assert.equal(env.mailCalls.user.length, 0, 'user send attempted and failed');
    } finally {
      env.close();
    }
  });

  test('one email failing does not block the other', async () => {
    const { mailer, calls: mailCalls } = makeMailer({ failAdmin: 'smtp auth failed' });
    const env = await startServer({ mailer });
    try {
      const res = await postJson(env.base, VALID_BODY);
      assert.equal(res.status, 201);
      assert.equal(mailCalls.user.length, 1, 'user confirmation still sent when admin mail fails');
      assert.equal(mailCalls.admin.length, 0);
    } finally {
      env.close();
    }
  });
});