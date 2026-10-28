'use client';

import { useState } from 'react';
import { createDelivery } from '@/actions/records';
import { ActionForm, Field, Select, TargetSelect, TextInput } from '@/components/forms';
import type { TargetGroup } from '@/lib/targets';

export function DeliveryForm({
  materials,
  targets,
}: {
  materials: { id: number; name: string; kind: string; unit: string }[];
  targets: TargetGroup[];
}) {
  const [materialId, setMaterialId] = useState<string>('');
  const material = materials.find((m) => String(m.id) === materialId);

  return (
    <ActionForm action={createDelivery} submitLabel="Записать приход">
      <Field label="Дата">
        <TextInput name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Материал">
        <Select
          name="materialId"
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
        >
          <option value="" disabled>
            Выберите материал
          </option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Количество${material ? `, ${material.unit}` : ''}`}>
        <TextInput name="quantity" inputMode="decimal" placeholder="25,41" />
      </Field>
      <Field
        label="Конструктив"
        hint="Приход сразу списывается сюда. Если на площадке не разделили — весь этаж"
      >
        <TargetSelect
          name="target"
          defaultValue=""
          required
          groups={targets}
          placeholder="Выберите конструктив или этаж"
        />
      </Field>
      <Field label="Оси / примечание" hint="Где именно в конструктиве: оси, захватка, участок">
        <TextInput name="note" placeholder="оси 1–4 / А–В" />
      </Field>
      <Field label="Номер ТТН">
        <TextInput name="ttnNumber" placeholder="ТТН-10482" />
      </Field>
      <Field label="Поставщик">
        <TextInput name="supplier" placeholder="БСУ" />
      </Field>
    </ActionForm>
  );
}
