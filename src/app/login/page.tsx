import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { LoginForm } from './form';

export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-900">СтройКонтроль</h1>
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
