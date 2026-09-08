'use client';

import { createPour } from '@/actions/records';
import { ActionForm, Field, Select, TextInput } from '@/components/forms';

export function PourForm({
  structures,
  materials,
}: {
  structures: { id: number; name: string; code: string }[];
  materials: { id: number; name: string; concreteClass: string | null }[];
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionForm action={createPour} submitLabel="Создать захватку">
      <Field label="Конструктив">
        <Select name="structureId" defaultValue="">
          <option value="" disabled>
            Выберите конструктив
          </option>
          {structures.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Номер или название захватки">
        <TextInput name="label" placeholder="Захватка 3, ось А–Г" />
      </Field>
      <Field label="Дата заливки">
        <TextInput name="pouredAt" type="date" defaultValue={today} />
      </Field>
      <Field label="Проектный объём, м³" hint="Конструктивный объём захватки по чертежу">
        <TextInput name="designVolumeM3" inputMode="decimal" placeholder="24,2" />
      </Field>
      <Field label="Класс бетона">
        <Select name="concreteMaterialId" defaultValue="">
          <option value="" disabled>
            Выберите класс
          </option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.concreteClass ?? m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Статус" hint="В расчёт выполненного объёма идут только залитые">
        <Select name="status" defaultValue="done">
          <option value="planned">Запланирована</option>
          <option value="in_progress">В работе</option>
          <option value="done">Залита</option>
        </Select>
      </Field>
    </ActionForm>
  );
}
