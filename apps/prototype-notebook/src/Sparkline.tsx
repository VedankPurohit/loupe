type SparklineProps = {
  label: string;
  values: number[];
  tone: "token" | "context";
};

function points(values: number[]) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 35 - ((value - min) / span) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Sparkline({ label, values, tone }: SparklineProps) {
  const latest = values.at(-1);
  return (
    <figure className={`sparkline sparkline-${tone}`}>
      <figcaption>
        <span>{label}</span>
        <strong>{latest == null ? "Unavailable" : latest.toLocaleString()}</strong>
      </figcaption>
      {values.length > 0 ? (
        <svg viewBox="0 0 100 40" role="img" aria-label={`${label}: ${values.join(", ")}`}>
          <path className="spark-grid" d="M0 35H100 M0 20H100" />
          <polyline points={points(values)} vectorEffect="non-scaling-stroke" />
          {values.map((value, index) => {
            const [x, y] = points(values).split(" ")[index]!.split(",");
            return <circle key={`${index}-${value}`} cx={x} cy={y} r="1.8" />;
          })}
        </svg>
      ) : (
        <p>Unavailable from captured evidence.</p>
      )}
    </figure>
  );
}
