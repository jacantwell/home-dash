import type { ButtonHTMLAttributes, ReactNode } from "react";

import { type IconName, PixelIcon } from "./pixel-icon";

interface TitleBarProps {
  title: string;
  icon?: IconName;
  /** Dialogs only get a close box; windows get the full set. */
  variant?: "window" | "dialog";
}

// Caption buttons are chrome, not controls: there is nothing to minimise on a web page.
export function TitleBar({ title, icon, variant = "window" }: TitleBarProps) {
  return (
    <div className="xp-titlebar">
      {icon && <PixelIcon name={icon} size={16} />}
      <span className="title">{title}</span>
      <span aria-hidden className="flex gap-0.5">
        {variant === "window" && (
          <>
            <span className="xp-caption-btn min" />
            <span className="xp-caption-btn max" />
          </>
        )}
        <span className="xp-caption-btn close" />
      </span>
    </div>
  );
}

interface WindowProps {
  title: string;
  icon?: IconName;
  menu?: string[];
  children: ReactNode;
}

export function Window({ title, icon, menu, children }: WindowProps) {
  return (
    <div className="xp-window">
      <TitleBar title={title} icon={icon} />
      {menu && (
        <div className="xp-menubar" aria-hidden>
          {menu.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

interface DialogProps {
  title: string;
  icon?: IconName;
  role?: "alert" | "status" | "dialog";
  children: ReactNode;
  actions?: ReactNode;
}

export function Dialog({ title, icon, role = "dialog", children, actions }: DialogProps) {
  return (
    <div className="xp-overlay">
      <div className="xp-dialog" role={role} aria-label={title}>
        <TitleBar title={title} icon={icon} variant="dialog" />
        <div className="xp-dialog-body">{children}</div>
        {actions && <div className="xp-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
}

export function ToolButton({ icon, label, type = "button", ...rest }: ToolButtonProps) {
  return (
    <button type={type} className="xp-tool" {...rest}>
      <PixelIcon name={icon} size={28} />
      <span>{label}</span>
    </button>
  );
}

export function ToolSeparator() {
  return <span className="xp-sep" aria-hidden />;
}

export function Button({
  type = "button",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={className ? `xp-btn ${className}` : "xp-btn"} {...rest} />;
}

export function Progress({ label }: { label: string }) {
  return (
    <div className="xp-progress" role="progressbar" aria-label={label}>
      <i />
    </div>
  );
}

export function StatusBar({ children }: { children: ReactNode }) {
  return <div className="xp-statusbar">{children}</div>;
}
