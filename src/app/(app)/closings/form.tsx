'use client';

import { useState } from 'react';
import { createClosing } from '@/actions/records';
import { ActionForm, Field, Select, TargetSelect, TextInput } from '@/components/forms';
import type { TargetGroup } from '@/lib/targets';

export function ClosingForm({
  materials,
  targets,
}: {
  materials: { id: number; name: string; kind: string; unit: string }[];
  targets: TargetGroup[];
}) {
  const [materialId, setMaterialId] = useState('');
  const material = materials.find((m) => String(m.id) === materialId);

  return (
    <ActionForm action={createClosing} submitLabel="Запроцентовать">
      <Field label="Месяц">
        <TextInput name="month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} />
      </Field>
      <Field label="Конструктив" hint="Захватка этажа, которую закрываете">
        <TargetSelect name="target" defaultValue="" groups={targets} placeholder="Выберите конструктив" />
      </Field>
      <Field label="Материал">
        <Select name="materialId" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
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
      <Field
        label={`Закрыто${material ? `, ${material.unit}` : ''}`}
        hint="По строке поставки КС-6а: м³ закупки бетона, т арматуры"
      >
        <TextInput name="quantity" inputMode="decimal" placeholder="277,8" />
      </Field>
      <Field
        label="Объём конструктива, м³"
        hint={material?.kind === 'concrete' ? 'По строке работ — обязательно для бетона' : 'Для арматуры не нужен'}
      >
        <TextInput name="designQuantity" inputMode="decimal" placeholder="264,58" disabled={material?.kind !== 'concrete'} />
      </Field>
      <Field label="Документ">
        <TextInput name="document" placeholder="КС-2 № 7 от 31.10.2026" />
      </Field>
    </ActionForm>
  );
}
