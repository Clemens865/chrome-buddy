// primitives.tsx — small shared UI primitives.
import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface IconBtnProps {
  icon: ReactElement;
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: number;
  style?: CSSProperties;
}

export function IconBtn({ icon, label, onClick, active, size = 32, style }: IconBtnProps) {
  return (
    <button
      type="button"
      className={'icon-btn' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: size, height: size, ...style }}
    >
      <span className="ic">{icon}</span>
    </button>
  );
}

export function Pill({ children, tone = 'default', style }: { children: ReactNode; tone?: 'default' | 'ok'; style?: CSSProperties }) {
  return <span className={'pill pill-' + tone} style={style}>{children}</span>;
}

export interface SegOption {
  v: string;
  l: string;
}

export function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SegOption[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={'seg-btn' + (value === o.v ? ' is-on' : '')}
          onClick={() => onChange(o.v)}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
