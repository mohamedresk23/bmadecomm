import { StaffAccessForm } from '../staff-access-form';

export default function StaffLogin() {
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 flex flex-col items-center justify-center text-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white font-extrabold flex items-center justify-center mx-auto text-sm tracking-wider shadow-sm mb-3">
            BM
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Staff sign in</h1>
          <p className="text-xs text-slate-600 max-w-xs mx-auto">
            Use your staff password and authenticator. Customer accounts cannot sign in here.
          </p>
        </div>
        <StaffAccessForm initialMode="login" />
      </div>
    </main>
  );
}
