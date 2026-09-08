'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSession, destroySession, verifyCredentials } from '@/lib/auth';

const schema = z.object({
  login: z.string().min(1, 'Укажите логин'),
  password: z.string().min(1, 'Укажите пароль'),
});

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    login: formData.get('login'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Проверьте поля' };
  }

  const user = await verifyCredentials(parsed.data.login, parsed.data.password);
  // Сообщение одно на оба случая: иначе форма подсказывает, какие логины существуют.
  if (!user) return { error: 'Неверный логин или пароль' };

  await createSession(user.id);
  redirect('/dashboard');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
