'use client';

import { changeOwnPassword } from '@/actions/users';
import { ActionForm, Field, TextInput } from '@/components/forms';

export function PasswordForm() {
  return (
    <ActionForm action={changeOwnPassword} submitLabel="Сменить пароль">
      <Field label="Текущий пароль">
        <TextInput name="current" type="password" autoComplete="current-password" />
      </Field>
      <Field label="Новый пароль" hint="Не короче 8 символов">
        <TextInput name="next" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Повтор">
        <TextInput name="repeat" type="password" autoComplete="new-password" />
      </Field>
    </ActionForm>
  );
}
