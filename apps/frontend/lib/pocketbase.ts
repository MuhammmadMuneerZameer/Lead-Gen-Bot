import PocketBase from 'pocketbase';

/**
 * PocketBase Client for HydraFox Frontend
 */
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

export const pb = new PocketBase(PB_URL);

/**
 * Auth state management for frontend.
 */
export const auth = {
  isValid: () => pb.authStore.isValid,
  logout: () => pb.authStore.clear(),
  user: () => pb.authStore.model,
};
