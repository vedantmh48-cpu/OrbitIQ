import nodemailer from 'nodemailer';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

/**
 * Reads the SMTP configuration from environment variables.
 * The Gmail App Password lives only on the backend — never in the frontend.
 */
function credentials() {
  const user = process.env.GMAIL_USER || '';
  const pass = process.env.GMAIL_APP_PASSWORD || '';
  const adminTo = process.env.ADMIN_EMAIL || user;
  return { user, pass, adminTo, ok: Boolean(user && pass && adminTo) };
}

export function createMailer() {
  let transporter = null;

  function getTransporter() {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: false, // STARTTLS on port 587
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    }
    return transporter;
  }

  function fromAddress() {
    return { name: 'SatQuery AI', address: process.env.GMAIL_USER };
  }

  /**
   * Notifies the OrbitIQ team about a new contact form submission.
   */
  async function sendAdminNotification(record) {
    const cfg = credentials();
    if (!cfg.ok) {
      console.error('[mailer] GMAIL_USER/GMAIL_APP_PASSWORD not configured — admin email skipped (server-side only).');
      return;
    }
    const submittedAt = (record.created_at || new Date()).toISOString();
    const text = [
      'New contact form submission',
      '',
      'Name: ' + record.name,
      'Email: ' + record.email,
      'Subject: ' + (record.subject || '(none)'),
      '',
      'Message:',
      record.message,
      '',
      'Submitted at:',
      submittedAt,
    ].join('\n');

    await getTransporter().sendMail({
      from: fromAddress(),
      to: cfg.adminTo,
      subject: 'New SatQuery AI Contact Message',
      text,
    });
  }

  /**
   * Sends a confirmation to the person who submitted the form.
   * The admin notification content is deliberately NOT sent back to the user.
   */
  async function sendUserConfirmation(record) {
    const cfg = credentials();
    if (!cfg.ok) {
      console.error('[mailer] GMAIL_USER/GMAIL_APP_PASSWORD not configured — confirmation email skipped (server-side only).');
      return;
    }
    const text = [
      'Hello ' + record.name + ',',
      '',
      'We received your message successfully.',
      '',
      'Thank you for contacting SatQuery AI.',
      '',
      'Our team will review your message and get back to you if necessary.',
      '',
      'Regards,',
      'SatQuery AI Team',
    ].join('\n');

    await getTransporter().sendMail({
      from: fromAddress(),
      to: record.email,
      subject: 'We received your message — SatQuery AI',
      text,
    });
  }

  return { sendAdminNotification, sendUserConfirmation };
}