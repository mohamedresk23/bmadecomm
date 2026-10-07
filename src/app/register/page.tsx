import { RegistrationForm } from "../../components/RegistrationForm";

export const metadata = {
  title: "Register - BMad Ecomm",
  description: "Create a new customer account",
};

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="w-full">
        <RegistrationForm />
      </div>
    </main>
  );
}
