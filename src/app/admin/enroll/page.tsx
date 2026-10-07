import { StaffAccessForm } from '../staff-access-form';

export default function StaffEnroll() {
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4 flex flex-col items-center justify-center text-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white font-extrabold flex items-center justify-center mx-auto text-sm tracking-wider shadow-sm mb-3">
            BM
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Enroll your authenticator</h1>
        </div>
        <StaffAccessForm initialMode="enroll" />
      </div>
    </main>
  );
}
