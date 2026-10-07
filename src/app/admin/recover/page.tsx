import { StaffAccessForm } from '../staff-access-form';

export default function StaffRecover() {
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 flex flex-col items-center justify-center text-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white font-extrabold flex items-center justify-center mx-auto text-sm tracking-wider shadow-sm mb-3">
            BM
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Recover your authenticator</h1>
          <p className="text-xs text-slate-600 max-w-xs mx-auto">
            You need your password and an unused offline recovery code. Recovery does not grant administrative access.
          </p>
        </div>
        <StaffAccessForm initialMode="recover" />
      </div>
    </main>
  );
}
