import { ReactNode } from "react";

interface MetricCardProps {
  value: string;
  label: string;
  icon?: ReactNode;
}

const MetricCard = ({ value, label, icon }: MetricCardProps) => (
  <div className="glass-panel rounded-2xl p-6 flex flex-col gap-3">
    {icon && (
      <div className="text-teal">{icon}</div>
    )}
    <p className="metric-value">{value}</p>
    <p className="metric-label">{label}</p>
  </div>
);

export default MetricCard;
