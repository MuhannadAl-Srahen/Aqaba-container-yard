import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { AR } from './ar';
import { LoginScreen } from './LoginScreen';
import { SetupScreen } from './SetupScreen';
import { YardScreen } from './YardScreen';

/**
 * Three states, decided by the server: first run → setup; no session → login;
 * otherwise the yard. There is no routing — the yard IS the application.
 */
export default function App(): ReactElement {
  const queryClient = useQueryClient();
  // Bumped whenever auth changes so the boot query re-decides the screen.
  const [, setEpoch] = useState(0);

  const boot = useQuery({ queryKey: ['boot'], queryFn: api.boot });

  const reboot = (): void => {
    void queryClient.invalidateQueries();
    setEpoch((n) => n + 1);
  };

  if (boot.data === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <p className="text-sm font-semibold text-slate-400">
          {boot.isError ? AR.networkError : AR.loading}
        </p>
      </div>
    );
  }

  if (boot.data.firstRun) return <SetupScreen onDone={reboot} />;
  if (!boot.data.authorized) return <LoginScreen onDone={reboot} />;
  return <YardScreen onUnauthorized={reboot} />;
}
