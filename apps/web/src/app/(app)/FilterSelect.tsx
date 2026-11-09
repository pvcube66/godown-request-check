'use client';
import { useRouter } from 'next/navigation';

export default function FilterSelect({ label, name, value, options, base }: {
  label: string; name: string; value: string; options: { value: string; label: string }[]; base: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} onChange={(e) => {
        const p = new URLSearchParams({ ...base, [name]: e.target.value });
        for (const [k, v] of [...p]) if (!v) p.delete(k);
        router.push(`/?${p}`);
      }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
