/** A plain horizontal bar chart made of HTML, so it prints well and needs no chart library. */
export default function BarChart({ title, note, data, unit }: {
  title: string; note: string; data: { label: string; value: number }[]; unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <section className="chart">
      <h2>{title}</h2>
      <p className="mut">{note}</p>
      {data.length === 0 ? <p className="mut">Nothing to show yet.</p> : (
        <ul>
          {data.map((d) => (
            <li key={d.label}>
              <span className="lab">{d.label}</span>
              <span className="chart-track"><i style={{ width: `${Math.max(3, (d.value / max) * 100)}%` }} /></span>
              <b>{d.value} <small>{unit}{d.value === 1 ? '' : 's'}</small></b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
