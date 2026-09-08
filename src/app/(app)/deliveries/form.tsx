'use client';

import { useState } from 'react';
import { createDelivery } from '@/actions/records';
import { ActionForm, Field, Select, TextInput } from '@/components/forms';

export function DeliveryForm({
  materials,
  pours,
  structures,
}: {
  materials: { id: number; name: string; kind: string; unit: string }[];
  pours: { id: number; label: string; structureId: number; concreteMaterialId: number }[];
  structures: { id: number; name: string }[];
}) {
  const [materialId, setMaterialId] = useState<string>('');
  const material = materials.find((m) => String(m.id) === materialId);
  const isConcrete = material?.kind === 'concrete';
  const structureName = new Map(structures.map((s) => [s.id, s.name]));
  const options = pours.filter((p) => String(p.concreteMaterialId) === materialId);

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
        label="Захватка"
        hint={
          isConcrete
            ? 'Обязательна для бетона: он уходит сразу в дело'
            : 'Для арматуры не заполняется — она идёт на склад'
        }
      >
        <Select name="pourId" disabled={!isConcrete} defaultValue="">
          <option value="">{isConcrete ? 'Выберите захватку' : 'на склад'}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {structureName.get(p.structureId) ?? ''}
            </option>
          ))}
        </Select>
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
