'use client';

import { createIssue } from '@/actions/records';
import { ActionForm, Field, Select, TextInput } from '@/components/forms';

export function IssueForm({
  materials,
  structures,
  pours,
  structureNames,
}: {
  materials: { id: number; name: string; isAggregate: boolean }[];
  structures: { id: number; name: string }[];
  pours: { id: number; label: string; structureId: number }[];
  structureNames: { id: number; name: string }[];
}) {
  const names = new Map(structureNames.map((s) => [s.id, s.name]));

  return (
    <ActionForm action={createIssue} submitLabel="Списать">
      <Field label="Дата">
        <TextInput name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field
        label="Позиция"
        hint="Общая позиция — когда акт не разделён по диаметрам, как в КС-6а"
      >
        <Select name="materialId" defaultValue="">
          <option value="" disabled>
            Выберите позицию
          </option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Количество, т">
        <TextInput name="quantity" inputMode="decimal" placeholder="8,84" />
      </Field>
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
      <Field label="Захватка" hint="Необязательно: каркас часто вяжут задолго до заливки">
        <Select name="pourId" defaultValue="">
          <option value="">не указывать</option>
          {pours.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {names.get(p.structureId) ?? ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Документ">
        <TextInput name="document" placeholder="Акт монтажа № 14" />
      </Field>
    </ActionForm>
  );
}
