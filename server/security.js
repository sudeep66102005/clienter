import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export function invoiceAmounts(items, taxRate) {
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price), 0);
  const tax = Math.round(subtotal * taxRate / 100);
  const total = subtotal + tax;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 2_000_000_000) {
    const error = new Error('Invoice total must be positive and below the supported limit.'); error.status = 400; throw error;
  }
  return { subtotal, tax, total };
}
