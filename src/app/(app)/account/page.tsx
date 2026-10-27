import { requireUser } from '@/lib/auth';
import { Card } from '@/components/ui';
import { PasswordForm } from './form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Профиль — СтройКонтроль' };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{user.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Логин {user.login} · {user.roleName}
          {user.roleDescription ? `: ${user.roleDescription}` : ''}.
        </p>
      </div>
      <Card title="Смена пароля" hint="Остальные открытые входы под этой учёткой будут закрыты.">
        <PasswordForm />
      </Card>
    </div>
  );
}
