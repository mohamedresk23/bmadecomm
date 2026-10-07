'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Mode = 'login' | 'enroll' | 'recover' | 'reset' | 'security';
type ResponseData = { csrf?: string; token?: string; seed?: string; codes?: string[]; rebind?: boolean; error?: { message: string } };
export function StaffAccessForm({ initialMode }: { initialMode: Mode }) {
  const submitting = useRef(false), mounted = useRef(true), requests = useRef(new Set<AbortController>());
  const router = useRouter();
  const navigate = (destination: string) => { router.replace(destination); router.refresh(); };
  const [mode, setMode] = useState(initialMode);
  const [csrf, setCsrf] = useState('');
  const [proof, setProof] = useState<{ token: string; csrf: string } | null>(null);
  const [seed, setSeed] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function call(operation: string, body?: Record<string, string>): Promise<ResponseData> {
    const controller = new AbortController(); requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/v1/admin/auth/${operation}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal } : { cache: 'no-store', signal: controller.signal });
      const result: ResponseData = await response.json();
      if (!mounted.current) throw new Error('Request cancelled.');
      if (!response.ok) throw new Error(result.error?.message ?? 'Request could not be completed.');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The request timed out or was cancelled. Please try again.');
      throw error;
    } finally { clearTimeout(timeout); requests.current.delete(controller); }
  }
  useEffect(() => {
    mounted.current = true;
    let live = true;
    // Remove proof fragments before any fetch; keep privileged values only in component memory.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, '', window.location.pathname);
    const token = fragment.get('token'), proofCsrf = fragment.get('csrf');
    if (token && proofCsrf && ['enroll', 'reset'].includes(initialMode)) setProof({ token, csrf: proofCsrf });
    void call(initialMode === 'security' ? 'session' : 'preauth').then(result => { if (live) setCsrf(result.csrf ?? ''); }).catch(error => { if (live) setMessage(error.message); });
    const activeRequests = requests.current;
    return () => { live = false; mounted.current = false; for (const request of activeRequests) request.abort(); };
  }, [initialMode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = event.currentTarget, data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '');
    setBusy(true); setMessage('');
    try {
      let result: ResponseData;
      if (mode === 'login') {
        if (!proof) {
          const password = value('password');
          form.reset();
          result = await call('login', { email: value('email'), password, csrf });
          if (!result.token || !result.csrf) throw new Error('Authentication could not be completed.');
          setProof({ token: result.token, csrf: result.csrf });
          setMessage('Enter a new code from your authenticator.'); return;
        }
        result = await call('mfa', { ...proof, otp: value('otp') });
        setProof(null); navigate('/admin'); return;
      }
      if (mode === 'enroll') {
        if (!proof) throw new Error('A private setup or recovery package is required.');
        if (!seed) {
          result = await call('enroll', proof); setSeed(result.seed ?? ''); return;
        }
        result = await call('enroll-confirm', { ...proof, password: value('password'), otp: value('otp') });
        setSeed(''); setProof(null); setCodes(result.codes ?? null); setMessage('Enrollment completed. Save the codes offline, then sign in with your password and a new authenticator code.'); return;
      }
      if (mode === 'recover') result = await call('recover', { email: value('email'), password: value('password'), code: value('code'), csrf });
      else if (mode === 'reset') {
        if (!proof) { await call('reset-request', { email: value('email'), csrf }); setMessage('If the account can recover, a private reset message will be delivered.'); return; }
        const body = { ...proof, password: value('password'), ...(value('code') ? { code: value('code') } : { otp: value('otp') }) };
        result = await call('reset-confirm', body);
      } else {
        const action = value('operation');
        result = await call(action, action === 'logout' ? { csrf } : { csrf, password: value('password'), otp: value('otp'), ...(action === 'password' ? { newPassword: value('newPassword') } : {}) });
        if (action === 'reauth') { setCsrf(result.csrf ?? ''); setMessage('Password and MFA verified. Your original session deadline is unchanged.'); return; }
        if (action === 'codes') { setCodes(result.codes ?? null); setMessage('Save these codes offline. All earlier codes and sessions have been revoked.'); return; }
        if (action === 'logout' || action === 'password') { navigate('/admin/login'); return; }
      }
      if (result.rebind && result.token && result.csrf) { setProof({ token: result.token, csrf: result.csrf }); setSeed(''); setMode('enroll'); setMessage('Only factor enrollment is allowed. Administration remains unavailable until a fresh login.'); }
      else { setProof(null); setMessage('Password reset completed. Sign in using your password and a new authenticator code.'); }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Request could not be completed.'); }
    finally { form.reset(); submitting.current = false; if (mounted.current) setBusy(false); }
  }
  const input = (name: string, label: string, type = 'text', required = true, autoComplete = 'off') => (
    <div className="space-y-1.5 text-left">
      <label htmlFor={name} className="block text-sm font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        maxLength={name.includes('Password') || name === 'password' ? 512 : 254}
        className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus:border-blue-700"
      />
    </div>
  );

  if (codes) return (
    <section aria-label="Recovery codes" className="bg-white rounded-2xl border border-slate-300 p-6 sm:p-8 shadow-xs max-w-md mx-auto space-y-5 text-left">
      <div className="p-3 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-semibold">
        These ten codes are shown once. Keep an offline emergency copy separately from your authenticator.
      </div>
      <ul className="grid grid-cols-2 gap-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
        {codes.map(code => (
          <li key={code} className="text-center">
            <code className="text-xs font-mono font-bold bg-white px-2 py-1.5 rounded-lg border border-slate-300 text-slate-900 block select-all">
              {code}
            </code>
          </li>
        ))}
      </ul>
      {message && <p role="status" className="text-xs font-semibold text-slate-600">{message}</p>}
      <button
        onClick={() => { setCodes(null); setSeed(''); setProof(null); navigate('/admin/login'); }}
        className="w-full px-6 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-blue-700"
      >
        I saved the codes — sign in
      </button>
    </section>
  );

  return (
    <section className="bg-white rounded-2xl border border-slate-300 p-6 sm:p-8 shadow-xs max-w-md mx-auto space-y-6 text-left">
      <form onSubmit={submit} className="space-y-4">
        {mode === 'login' && !proof && (
          <>
            {input('email', 'Staff email', 'email', true, 'username')}
            {input('password', 'Password', 'password', true, 'current-password')}
          </>
        )}
        {mode === 'login' && proof && input('otp', 'Authenticator code', 'text', true, 'one-time-code')}
        {mode === 'enroll' && !proof && (
          <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
            A private setup or recovery package is required.
          </p>
        )}
        {mode === 'enroll' && seed && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 text-blue-900 border border-blue-200 rounded-xl text-xs space-y-2">
              <p className="font-semibold">Add this setup key to your authenticator. It is only available during this restricted enrollment.</p>
              <p><code className="font-mono font-bold bg-white px-2 py-1 rounded border border-blue-300 text-blue-800 inline-block">{seed}</code></p>
            </div>
            {input('password', 'Password (15–128 characters)', 'password', true, 'new-password')}
            {input('otp', 'Code from the new authenticator', 'text', true, 'one-time-code')}
          </div>
        )}
        {mode === 'recover' && (
          <>
            {input('email', 'Staff email', 'email', true, 'username')}
            {input('password', 'Current password', 'password', true, 'current-password')}
            {input('code', 'Unused offline recovery code')}
          </>
        )}
        {mode === 'reset' && !proof && input('email', 'Staff email', 'email', true, 'username')}
        {mode === 'reset' && proof && (
          <>
            {input('password', 'New password (15–128 characters)', 'password', true, 'new-password')}
            {input('otp', 'Current authenticator code (or use a recovery code)', 'text', false, 'one-time-code')}
            {input('code', 'Unused offline recovery code (or use authenticator)', 'text', false)}
          </>
        )}
        {mode === 'security' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="operation" className="block text-sm font-semibold text-slate-800">Security action</label>
              <select id="operation" name="operation" className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-700">
                <option value="reauth">Verify password and MFA again</option>
                <option value="password">Change password</option>
                <option value="factor">Replace authenticator</option>
                <option value="codes">Renew recovery codes</option>
                <option value="logout">Sign out</option>
              </select>
            </div>
            {input('password', 'Current password', 'password', false, 'current-password')}
            {input('otp', 'New authenticator code', 'text', false, 'one-time-code')}
            {input('newPassword', 'New password (only for password change)', 'password', false, 'new-password')}
            <p className="text-xs text-slate-500">Factor, password and code changes revoke your sessions and require a fresh login.</p>
          </>
        )}

        <button
          type="submit"
          disabled={busy || (!csrf && !proof) || (mode === 'enroll' && !proof)}
          className="w-full inline-flex justify-center items-center px-6 py-2.5 rounded-xl border border-transparent bg-blue-700 hover:bg-blue-800 text-sm font-bold text-white shadow-sm transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Please wait…' : mode === 'enroll' && !seed ? 'Begin authenticator enrollment' : 'Continue'}
        </button>

        {message && (
          <p role="status" aria-live="polite" className="text-xs font-semibold p-3 rounded-xl bg-slate-100 text-slate-800 border border-slate-300">
            {message}
          </p>
        )}
      </form>

      {mode !== 'security' && (
        <nav aria-label="Staff access" className="pt-4 border-t border-slate-200 text-center text-xs font-semibold text-slate-600 space-x-3">
          <Link href="/admin/login" className="hover:text-blue-700 hover:underline">Sign in</Link>
          <span>·</span>
          <Link href="/admin/recover" className="hover:text-blue-700 hover:underline">Lost authenticator</Link>
          <span>·</span>
          <Link href="/admin/reset" className="hover:text-blue-700 hover:underline">Forgot password</Link>
        </nav>
      )}
    </section>
  );
}
