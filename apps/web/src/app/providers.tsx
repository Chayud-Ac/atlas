import { FluentProvider, makeStyles, webLightTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { type Auth, AuthContext } from '@/lib/auth/auth-context';

const useStyles = makeStyles({
  // Let the theme's background fill the whole page, not just the content.
  root: { minHeight: '100%' },
});

/** Everything the app runs inside: the Fluent theme, the TanStack Query cache and sign-in. */
export function AppProviders({ auth, children }: { auth: Auth; children: ReactNode }) {
  const styles = useStyles();
  const [queryClient] = useState(createQueryClient);
  return (
    <FluentProvider theme={webLightTheme} className={styles.root}>
      <QueryClientProvider client={queryClient}>
        <AuthContext value={auth}>{children}</AuthContext>
      </QueryClientProvider>
    </FluentProvider>
  );
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry network and server errors, not 4xx: asking again won't change a 403 or 404.
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.status < 500),
      },
    },
  });
}
