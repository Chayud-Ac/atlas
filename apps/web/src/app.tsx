import {
  Button,
  FluentProvider,
  makeStyles,
  Text,
  tokens,
  webLightTheme,
} from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from './api.js';
import { type Auth, AuthContext, useAuth } from './auth/auth.js';
import { NotesPage } from './notes/notes.page.js';
import { UserHeader } from './users/users.header.js';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  appName: { marginRight: 'auto' },
  main: { maxWidth: '720px', margin: '0 auto', padding: tokens.spacingHorizontalL },
});

export function App({ auth }: { auth: Auth }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={queryClient}>
        <AuthContext value={auth}>
          <Shell />
        </AuthContext>
      </QueryClientProvider>
    </FluentProvider>
  );
}

function Shell() {
  const styles = useStyles();
  const { isSignedIn, signIn } = useAuth();
  return (
    <>
      <header className={styles.header}>
        <Text className={styles.appName} size={500} weight="semibold">
          Atlas
        </Text>
        {isSignedIn && <UserHeader />}
      </header>
      <main className={styles.main}>
        {isSignedIn ? (
          <NotesPage />
        ) : (
          <>
            <Text as="p">Sign in with your work account to continue.</Text>
            <Button appearance="primary" onClick={() => void signIn()}>
              Sign in
            </Button>
          </>
        )}
      </main>
    </>
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
