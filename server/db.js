import mysql from 'mysql2/promise';

/**
 * Schema for contact form submissions.
 * Adapted from the requested schema; created automatically on first use.
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

/**
 * Creates (but does not connect yet) a MySQL connection pool.
 * mysql2 pools connect lazily — the API keeps running with clean 503s
 * while the database is unreachable.
 */
export function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'orbit_iq',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  });
}

/**
 * Data access for contact messages. All queries are parameterized —
 * SQL is never built by string concatenation.
 */
export function createStore(pool) {
  let schemaReady = false;

  async function ensureSchema() {
    if (schemaReady) return;
    await pool.query(SCHEMA_SQL);
    schemaReady = true;
  }

  async function insertMessage({ name, email, subject, message }) {
    await ensureSchema();
    const [result] = await pool.execute(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
      [name, email, subject && subject.length ? subject : null, message],
    );
    return {
      id: result.insertId,
      name,
      email,
      subject,
      message,
      created_at: new Date(),
    };
  }

  return { insertMessage };
}