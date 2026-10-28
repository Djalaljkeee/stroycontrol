'use client';

import { useState } from 'react';
import { createDelivery } from '@/actions/records';
import { ActionForm, Field, Select, TargetSelect, TextInput } from '@/components/forms';
import type { TargetGroup } from '@/lib/targets';

export function DeliveryForm({
  materials,
  targets,
  targetRequired,
}: {
  materials: { id: number; name: string; kind: string; unit: string }[];
  targets: TargetGroup[];
  /** Снабжение может оставить бетон без разнесения — его разнесёт прораб. */
  targetRequired: boolean;
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
            ? targetRequired
              ? 'Обязательно для бетона: он уходит сразу в дело. Если на площадке не разделили — весь этаж'
              : 'Если не знаете — оставьте пустым, прораб разнесёт'
            : 'Для арматуры — под конкретный блок этажа или на склад'
        }
      >
        <TargetSelect
          name="target"
          defaultValue=""
          groups={targets}
          placeholder={isConcrete ? (targetRequired ? 'Выберите этаж или конструктив' : 'не разнесено') : 'на склад'}
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
