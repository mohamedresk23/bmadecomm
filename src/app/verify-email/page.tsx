import { VerificationForm } from "../../components/VerificationForm";

export const metadata = { title: "Verify email", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function VerifyEmailPage() {
  return <main className="p-6"><VerificationForm /></main>;
}
