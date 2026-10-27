'use client';

import { completeStructure } from '@/actions/records';
import { ActionForm, Field, Select, TargetSelect, TextInput } from '@/components/forms';
import type { TargetGroup } from '@/lib/targets';

export function CompleteForm({
  targets,
  materials,
}: {
  targets: TargetGroup[];
  materials: { id: number; name: string }[];
}) {
  return (
    <ActionForm action={completeStructure} submitLabel="Отметить выполнение">
      <Field label="Конструктив" hint="Захватки сгруппированы по ярусам">
        <TargetSelect name="target" defaultValue="" groups={targets} placeholder="Выберите конструктив" />
      </Field>
      <Field label="Дата окончания">
        <TextInput name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Объём, м³" hint="Пусто — весь оставшийся объём по проекту">
        <TextInput name="volume" inputMode="decimal" placeholder="по проекту" />
      </Field>
      <Field label="Класс бетона" hint="Нужен, только если у конструктива их несколько">
        <Select name="concreteMaterialId" defaultValue="">
          <option value="">по проекту</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Примечание">
        <TextInput name="label" placeholder="захватка 2, оси 1–7" />
      </Field>
    </ActionForm>
  );
}
