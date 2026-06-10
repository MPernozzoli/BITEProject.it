interface SeaPeopleIconProps {
  size?: number;
  className?: string;
}

const SeaPeopleIcon = ({ size = 16, className }: SeaPeopleIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 3v18" />
    <path d="M7 4v4.5c0 3 1.8 5.2 5 6.8" />
    <path d="M17 4v4.5c0 3-1.8 5.2-5 6.8" />
    <path d="M7 4 4.5 7" />
    <path d="M17 4 19.5 7" />
  </svg>
);

export default SeaPeopleIcon;
