import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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

  /**
   * الجلسة بلمسة إنسان، والسكون يقفل — «اذا طول وهو مش محرك ماوس او مش
   * كاتب اشي ع الكيبورد يطلب كلمة سر مره ثانية»: a real touch or keystroke
   * slides the server's hour along (a throttled ping — the map's automatic
   * refreshes never count). And TEN MINUTES with neither closes the door
   * itself: the session is signed out and the password screen returns. A
   * working clerk never sees it; a device walked away from locks.
   */
  const IDLE_LOCK_MS = 10 * 60 * 1000;
  const lastRenewal = useRef(0);
  const lastTouch = useRef(Date.now());
  const authorizedRef = useRef(false);
  authorizedRef.current = boot.data?.authorized === true && boot.data.firstRun !== true;
  /**
   * سائق الآلية لا يُقفَل بالسكون — a tablet mounted on the crane sits
   * untouched between tasks by nature. Its shift-long session is renewed by
   * a TIMER instead (the touch ping cannot be relied on up there), and it
   * ends at «خروج», at shift handover.
   */
  const driverRef = useRef(false);
  driverRef.current = boot.data?.driver === true;
  const locking = useRef(false);
  useEffect(() => {
    const renew = (): void => {
      const nowMs = Date.now();
      lastTouch.current = nowMs;
      if (!authorizedRef.current || nowMs - lastRenewal.current < 5 * 60 * 1000) return;
      lastRenewal.current = nowMs;
      void api.refreshSession().catch(() => {
        // A dead session answers 401; the next query's own handling reboots.
      });
    };
    const watch = window.setInterval(() => {
      if (!authorizedRef.current || locking.current || driverRef.current) return;
      if (Date.now() - lastTouch.current < IDLE_LOCK_MS) return;
      locking.current = true;
      void api
        .logout()
        .catch(() => undefined)
        .finally(() => {
          locking.current = false;
          reboot();
        });
    }, 30_000);
    // The driver's clockwork renewal: every half hour the 12-hour window
    // slides, so the queue stays live for the whole shift hands-free.
    const driverRenew = window.setInterval(() => {
      if (!authorizedRef.current || !driverRef.current) return;
      void api.refreshSession().catch(() => {
        // Same as above: a dead session bounces on the next query.
      });
    }, 30 * 60 * 1000);
    window.addEventListener('pointerdown', renew);
    window.addEventListener('keydown', renew);
    return () => {
      window.clearInterval(watch);
      window.clearInterval(driverRenew);
      window.removeEventListener('pointerdown', renew);
      window.removeEventListener('keydown', renew);
    };
  }, [reboot, IDLE_LOCK_MS]);

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
