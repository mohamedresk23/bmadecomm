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
  const input = (name: string, label: string, type = 'text', required = true, autoComplete = 'off') => <p><label htmlFor={name}>{label}</label><br /><input id={name} name={name} type={type} required={required} autoComplete={autoComplete} maxLength={name.includes('Password') || name === 'password' ? 512 : 254} /></p>;
  if (codes) return <section aria-label="Recovery codes"><p>These ten codes are shown once. Keep an offline emergency copy separately from your authenticator.</p><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><p role="status">{message}</p><button onClick={() => { setCodes(null); setSeed(''); setProof(null); navigate('/admin/login'); }}>I saved the codes — sign in</button></section>;
  return <section><form onSubmit={submit}>
    {mode === 'login' && !proof && <>{input('email', 'Staff email', 'email', true, 'username')}{input('password', 'Password', 'password', true, 'current-password')}</>}
    {mode === 'login' && proof && input('otp', 'Authenticator code', 'text', true, 'one-time-code')}
    {mode === 'enroll' && !proof && <p>A private setup or recovery package is required.</p>}
    {mode === 'enroll' && seed && <><p>Add this setup key to your authenticator. It is only available during this restricted enrollment.</p><p><code>{seed}</code></p>{input('password', 'Password (15–128 characters)', 'password', true, 'new-password')}{input('otp', 'Code from the new authenticator', 'text', true, 'one-time-code')}</>}
    {mode === 'recover' && <>{input('email', 'Staff email', 'email', true, 'username')}{input('password', 'Current password', 'password', true, 'current-password')}{input('code', 'Unused offline recovery code')}</>}
    {mode === 'reset' && !proof && input('email', 'Staff email', 'email', true, 'username')}
    {mode === 'reset' && proof && <>{input('password', 'New password (15–128 characters)', 'password', true, 'new-password')}{input('otp', 'Current authenticator code (or use a recovery code)', 'text', false, 'one-time-code')}{input('code', 'Unused offline recovery code (or use authenticator)', 'text', false)}</>}
    {mode === 'security' && <><p><label htmlFor="operation">Security action</label><br /><select id="operation" name="operation"><option value="reauth">Verify password and MFA again</option><option value="password">Change password</option><option value="factor">Replace authenticator</option><option value="codes">Renew recovery codes</option><option value="logout">Sign out</option></select></p>{input('password', 'Current password', 'password', false, 'current-password')}{input('otp', 'New authenticator code', 'text', false, 'one-time-code')}{input('newPassword', 'New password (only for password change)', 'password', false, 'new-password')}<p>Factor, password and code changes revoke your sessions and require a fresh login.</p></>}
    <button type="submit" disabled={busy || (!csrf && !proof) || (mode === 'enroll' && !proof)}>{busy ? 'Please wait…' : mode === 'enroll' && !seed ? 'Begin authenticator enrollment' : 'Continue'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>{mode !== 'security' && <nav aria-label="Staff access"><Link href="/admin/login">Sign in</Link>{' · '}<Link href="/admin/recover">Lost authenticator</Link>{' · '}<Link href="/admin/reset">Forgot password</Link></nav>}</section>;
}
