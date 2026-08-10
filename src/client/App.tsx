import { useCallback, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { AR } from './ar';
import { LoginScreen } from './LoginScreen';
import { SetupScreen } from './SetupScreen';
import { YardScreen } from './YardScreen';

/**
 * Three states, decided by the server: first run → setup; no session → the
 * sign-in; otherwise the yard. There is no routing — the yard IS the
 * application.
 */
export default function App(): ReactElement {
  const queryClient = useQueryClient();
  // Bumped whenever auth changes so the boot query re-decides the screen.
  const [, setEpoch] = useState(0);

  const boot = useQuery({ queryKey: ['boot'], queryFn: api.boot });

  /**
   * Somebody just signed in or out, and it may not be the same person.
   * Everything in the cache — who I am, what the yard holds, and any 401 left
   * behind by the session that just ended — belongs to the previous session,
   * so it is thrown away rather than merely marked stale: a kept answer would
   * decide the next screen. Stable identity, because the screens hold onto it.
   */
  const reboot = useCallback((): void => {
    void queryClient.resetQueries();
    setEpoch((n) => n + 1);
  }, [queryClient]);

  if (boot.data === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <p className="text-sm font-semibold text-faint">
          {boot.isError ? AR.networkError : AR.loading}
        </p>
      </div>
    );
  }

  if (boot.data.firstRun) return <SetupScreen onDone={reboot} />;
  if (!boot.data.authorized) return <LoginScreen staff={boot.data.staff} onDone={reboot} />;
  return <YardScreen onUnauthorized={reboot} />;
}
