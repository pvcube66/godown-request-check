'use client';

import { useRouter } from 'next/navigation';
import ActionForm from './ActionForm';
import type { MasterActionState } from './action-state';
import { MAX_MAPPING_FILE_BYTES } from './upload-limits';

export default function ImportForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  async function upload(_state: MasterActionState, form: FormData): Promise<MasterActionState> {
    const file = form.get('mappingFile');
    if (!(file instanceof File) || !file.size) return { error: 'Choose a non-empty CSV or XLSX mapping file.' };
    if (file.size > MAX_MAPPING_FILE_BYTES) return { error: 'Mapping files must be 2 MB or smaller.' };
    try {
      const response = await fetch('/master/import', { method: 'POST', body: form, credentials: 'same-origin' });
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object') throw new Error('Invalid response');
      if ('error' in result && typeof result.error === 'string') return { error: result.error };
      if (response.ok && 'success' in result && typeof result.success === 'string') {
        router.refresh();
        return { success: result.success };
      }
      throw new Error('Invalid response');
    } catch { return { error: 'Could not finish the upload. Check your connection and admin access. Retrying an identical file safely skips completed mappings.' }; }
  }
  return <ActionForm action={upload} submitLabel="Validate and import mappings" pendingLabel="Validating and importing…" disabled={disabled}>
    <label className="master-field">Mapping file<input name="mappingFile" type="file" accept=".csv,.xlsx" required disabled={disabled} /></label>
  </ActionForm>;
}
