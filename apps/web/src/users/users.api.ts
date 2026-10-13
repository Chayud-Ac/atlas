import { CurrentUser } from '@atlas/shared';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api.js';

/** The signed-in user as the API sees them, including their App Roles (`roles`). */
export function useCurrentUser() {
  const api = useApi();
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api.get('/api/users/me', CurrentUser),
    // Signing in as someone else reloads the page, so this never goes stale.
    staleTime: Infinity,
  });
}
