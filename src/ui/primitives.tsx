import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface SelectMenuOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`ui-button ui-button-${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button className="ui-icon-button" type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      {children}
    </button>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`ui-status ui-status-${tone}`}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      {icon ? <div className="ui-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="ui-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={tab.id === active ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          <span>{tab.label}</span>
          {typeof tab.count === "number" ? <small>{tab.count}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  size = "regular",
  icon,
}: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  size?: "compact" | "regular";
  icon?: ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const selected = options.find((option) => option.value === value) || options[0];

  const updatePlacement = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 14;
    const optionHeight = 42;
    const menuHeight = Math.min(
      360,
      Math.max(46, options.length * optionHeight + 12),
      window.innerHeight - viewportPadding * 2,
    );
    const menuWidth = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const nextPlacement = spaceBelow >= menuHeight || spaceBelow >= spaceAbove ? "below" : "above";
    const top = nextPlacement === "below"
      ? Math.min(rect.bottom + 8, window.innerHeight - menuHeight - viewportPadding)
      : Math.max(viewportPadding, rect.top - menuHeight - 8);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );

    setPlacement(nextPlacement);
    setPopoverStyle({
      top,
      left,
      width: menuWidth,
      maxHeight: menuHeight,
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePlacement();
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const updateOnViewportChange = () => updatePlacement();
    document.addEventListener("pointerdown", closeOnPointer, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateOnViewportChange);
    window.addEventListener("scroll", updateOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateOnViewportChange);
      window.removeEventListener("scroll", updateOnViewportChange, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [options, value]);

  const openMenu = () => {
    updatePlacement();
    setOpen(true);
  };

  const commit = (option: SelectMenuOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      setActiveIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = (current + delta + options.length) % options.length;
        return next;
      });
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        const option = options[activeIndex] || options[0];
        if (option) commit(option);
      }
      else openMenu();
    }
  };

  return (
    <div className={`ui-select-menu ui-select-menu-${size}`} ref={rootRef}>
      <button
        type="button"
        className="ui-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
      >
        {icon ? <span className="ui-select-icon">{icon}</span> : null}
        <span className="ui-select-value">{selected?.label || ariaLabel}</span>
        <ChevronDown size={14} />
      </button>
      {open ? createPortal(
        <div
          ref={popoverRef}
          className={`ui-select-popover ui-select-popover-${placement}`}
          role="listbox"
          id={`${id}-listbox`}
          aria-label={ariaLabel}
          style={popoverStyle}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`${option.value === value ? "selected" : ""} ${index === activeIndex ? "active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(option)}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
