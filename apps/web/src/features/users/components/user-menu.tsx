import { Button, Persona } from '@fluentui/react-components';
import { useAuth } from '@/lib/auth/auth-context';
import { useCurrentUser } from '../api/use-current-user';

/** The signed-in user and a sign-out button, for the app header (a base feature). */
export function UserMenu() {
  const { signOut } = useAuth();
  const { data: me } = useCurrentUser();
  return (
    <>
      {me && (
        <Persona
          name={me.displayName ?? me.email ?? 'Signed in'}
          secondaryText={me.email ?? undefined}
        />
      )}
      <Button onClick={() => void signOut()}>Sign out</Button>
    </>
  );
}
