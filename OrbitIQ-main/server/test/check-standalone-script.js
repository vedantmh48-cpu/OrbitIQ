// Syntax-check the embedded <script> in orbit-iq.html without executing it.
import { readFile } from 'node:fs/promises';

const html = await readFile('../orbit-iq.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('No <script> block found');
new Function(match[1]); // parse-only; throws SyntaxError on bad syntax
console.log('orbit-iq.html embedded script: syntax OK');