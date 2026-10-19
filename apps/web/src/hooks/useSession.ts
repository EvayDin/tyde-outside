import { useQuery } from '@tanstack/react-query';
import { ApiError, type AuthUser } from '@tyde/shared';
import { api } from '../services/api';
export const SESSION_KEY = ['session'] as const;
export const sessionQuery = {
  queryKey: SESSION_KEY,
  queryFn: async (): Promise<AuthUser | null> => {
    try {
      return await api.getCurrentUser();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
};

export function useSession() {
  return useQuery(sessionQuery);
}
