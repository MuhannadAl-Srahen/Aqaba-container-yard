import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/cairo';
import './styles.css';
import App from './App';

/**
 * The yard is one server and several browsers — the gate, the office, a phone
 * in somebody's pocket — all looking at the same ground. So every screen
 * re-reads the server on a timer and whenever its window comes back to the
 * front: a container gated in at the barrier shows up in the office without
 * anyone reaching for refresh.
 *
 * react-query pauses these timers while a tab is hidden, so the phone in the
 * pocket costs nothing. Open forms are safe: they seed their fields once on
 * mount, so a refetch underneath can never wipe what someone is typing.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 3_000,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
