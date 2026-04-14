import PocketBase from 'pocketbase';
import dotenv from 'dotenv';
import path from 'path';

// Load ENV from root or locally
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || '';

export const pb = new PocketBase(PB_URL);

/**
 * Authenticates the worker as an admin. This is 
 * required to bypass some API rules.
 */
export async function authenticateAdmin() {
  try {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ PocketBase Admin authenticated');
  } catch (err) {
    console.error('❌ PocketBase Admin authentication failed', (err as Error).message);
    process.exit(1);
  }
}
