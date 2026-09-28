import express from 'express';
import cors from 'cors';
import { createPool, createStore } from './db.js';
import { createMailer } from './mailer.js';
import { createContactRouter } from './contact.js';

const app = express();

/*
 * Restricted CORS — only origins that actually host the OrbitIQ website.
 * Override with the CORS_ORIGIN env variable (comma-separated).
 * Never something like '*'.
 */
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const DEFAULT_ORIGINS = [
  'http://localhost:5173', // Vite dev server
  'http://localhost:3000', // Local API (same-origin local use)
  'https://vedantmh48-cpu.github.io', // GitHub Pages — OrbitIQ download website
];

const allowedOrigins = configuredOrigins.length ? configuredOrigins : DEFAULT_ORIGINS;

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);

// Small payload cap — a contact message never needs more than a few KB.
app.use(express.json({ limit: '16kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const pool = createPool();
const store = createStore(pool);
const mailer = createMailer();

app.use(createContactRouter({ store, mailer }));

/*
 * Central error handler. Maps JSON parser failures to clean 4xx responses
 * and never leaks stack traces or internals to the client.
 */
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid request body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request too large.' });
  }
  console.error('[api] unhandled error:', err.message);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

export default app;