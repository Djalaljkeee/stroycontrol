import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { LoginForm } from './form';

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.home);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1>
          <img src="/logo.svg" alt="СтройКонтроль" width={175} height={26} className="h-7 w-auto" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Учёт расхода бетона и арматуры. Лабораторно-производственный корпус, Зеленоград.
        </p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
