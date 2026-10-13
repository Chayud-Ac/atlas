import { Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import { NotesPage } from '@/features/notes/components/notes-page';
import { UserMenu } from '@/features/users/components/user-menu';
import { useAuth } from '@/lib/auth/auth-context';

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

/** The page layout: a header with the signed-in user, then the content. */
export function App() {
  const styles = useStyles();
  const { isSignedIn, signIn } = useAuth();
  return (
    <>
      <header className={styles.header}>
        <Text className={styles.appName} size={500} weight="semibold">
          Atlas
        </Text>
        {isSignedIn && <UserMenu />}
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
