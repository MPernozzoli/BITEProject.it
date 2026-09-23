/**
 * Planned vs actual route as a small static SVG (Mercator fitted to the
 * bounding box). Planned dashed and thin, actual solid: the value is in the
 * overlap, so they share one frame instead of two maps side by side.
 * Plain SVG so it survives `html-to-image` (the ticket download) and costs no map tiles.
 */
interface TrackRouteSketchProps {
  planned: [number, number][];
  actual: [number, number][][];
  width?: number;
  height?: number;
  className?: string;
  title?: string;
}

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const TrackRouteSketch = ({ planned, actual, width = 320, height = 150, className, title }: TrackRouteSketchProps) => {
  const all = [...planned, ...actual.flat()];
  if (all.length < 2) return null;
  const xs = all.map(([lng]) => lng);
  const ys = all.map(([, lat]) => mercatorY(lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 12;
  const spanX = ((maxX - minX) * Math.PI) / 180 || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = ([lng, lat]: [number, number]) =>
    `${(offsetX + ((lng - minX) * Math.PI) / 180 * scale).toFixed(1)},${(height - offsetY - (mercatorY(lat) - minY) * scale).toFixed(1)}`;
  const path = (coords: [number, number][]) => (coords.length > 1 ? `M${coords.map(project).join("L")}` : "");
  const start = actual[0]?.[0] ?? planned[0];
  const lastRun = actual[actual.length - 1];
  const end = lastRun?.[lastRun.length - 1] ?? planned[planned.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <path d={path(planned)} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.4} strokeDasharray="4 4" strokeLinecap="round" />
      {actual.map((run, i) => (
        <path key={i} d={path(run)} fill="none" stroke="hsl(24,88%,52%)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {start && <circle cx={project(start).split(",")[0]} cy={project(start).split(",")[1]} r={3.5} fill="hsl(24,88%,52%)" />}
      {end && <circle cx={project(end).split(",")[0]} cy={project(end).split(",")[1]} r={3.5} fill="none" stroke="hsl(24,88%,52%)" strokeWidth={2} />}
    </svg>
  );
};

export default TrackRouteSketch;
