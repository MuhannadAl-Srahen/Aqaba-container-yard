import { useState, type ReactElement } from 'react';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, inputClass } from './ui';

export function LoginScreen(props: { onDone: () => void }): ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    if (password === '' || busy) return;
    setBusy(true);
    setError(null);
    api
      .login(password)
      .then(props.onDone)
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-xl font-extrabold text-slate-900">{AR.appName}</h1>
        <p className="mt-1 text-sm text-slate-500">{AR.loginHint}</p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label={AR.password}>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              autoFocus
            />
          </Field>
          <ErrorLine message={error} />
          <Button type="submit" full disabled={password === '' || busy}>
            {AR.enter}
          </Button>
        </form>
      </div>
    </div>
  );
}
