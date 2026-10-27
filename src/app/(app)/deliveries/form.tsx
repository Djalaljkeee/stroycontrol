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
  const isConcrete = material?.kind === 'concrete';

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
        label="Куда"
        hint={
          isConcrete
            ? 'Обязательно для бетона: он уходит сразу в дело. Если на площадке не разделили — весь ярус'
            : 'Для арматуры — под конкретный блок яруса или на склад'
        }
      >
        <TargetSelect
          name="target"
          defaultValue=""
          groups={targets}
          placeholder={isConcrete ? 'Выберите ярус или конструктив' : 'на склад'}
        />
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
