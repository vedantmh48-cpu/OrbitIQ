import { Router } from 'express';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = {
  name: 255,
  email: 255,
  subject: 255,
  message: 5000,
};

/**
 * Trims and stringifies a value. Never trust the frontend.
 */
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Server-side validation. Returns a list of user-facing error messages
 * (empty list = valid). Integers, arrays and objects are treated as
 * empty/invalid rather than being coerced into strings.
 */
function validate(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Invalid request body.'];
  }

  const name = clean(body.name);
  const email = clean(body.email);
  const subject = clean(body.subject);
  const message = clean(body.message);

  if (!name) errors.push('Name is required.');
  else if (name.length > MAX_LENGTH.name) errors.push('Name is too long.');

  if (!email) errors.push('Email is required.');
  else if (email.length > MAX_LENGTH.email) errors.push('Email is too long.');
  else if (!EMAIL_RE.test(email)) errors.push('Please enter a valid email address.');

  if (subject.length > MAX_LENGTH.subject) errors.push('Subject is too long.');

  if (!message) errors.push('Message is required.');
  else if (message.length > MAX_LENGTH.message) errors.push('Message is too long.');

  return errors;
}

/**
 * POST /api/contact
 *
 * Request:  { "name", "email", "subject"?, "message" }
 * Response: 201 { success: true, id }         — stored + emails attempted
 *           400 { success: false, error }     — validation / bad body
 *           413 { success: false, message }   — payload too large
 *           503 { success: false, message }   — database unavailable
 *
 * North star: once the row is safely in MySQL the request is a success,
 * even if an email fails. The database is the source of truth.
 */
export function createContactRouter({ store, mailer }) {
  const router = Router();

  router.post('/api/contact', async (req, res) => {
    const errors = validate(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: errors[0] } });
    }

    const record = {
      name: clean(req.body.name),
      email: clean(req.body.email),
      subject: clean(req.body.subject),
      message: clean(req.body.message),
    };

    let saved;
    try {
      saved = await store.insertMessage(record);
    } catch (error) {
      // Logged server-side only — SQL details must never reach the client.
      console.error('[api/contact] database error:', error.message);
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again later.' });
    }

    // Emails are best-effort after the record is safe in the database.
    if (mailer) {
      await Promise.allSettled([
        Promise.resolve()
          .then(() => mailer.sendAdminNotification(saved))
          .catch((error) => console.error('[api/contact] admin email failed:', error.message)),
        Promise.resolve()
          .then(() => mailer.sendUserConfirmation(saved))
          .catch((error) => console.error('[api/contact] confirmation email failed:', error.message)),
      ]);
    }

    return res.status(201).json({ success: true, id: saved.id });
  });

  return router;
}