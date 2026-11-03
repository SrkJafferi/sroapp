'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Specialization } from '@sro/types';
import styles from './department-select.module.css';

/** Searchable single assignment: departments are supplied by the scoped clinic snapshot. */
export function DepartmentSelect({
  departments,
  value,
  onChange,
  disabled = false,
}: {
  departments: Specialization[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = departments.find((d) => d.id === value);
  const options = departments.filter((d) =>
    `${d.name} ${d.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const expanded = open && !disabled;
  useEffect(() => {
    if (expanded)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded, id]);
  const choose = (department: Specialization) => {
    onChange(department.id);
    setQuery('');
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div
      className={styles.field}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery('');
        }
      }}
    >
      <label htmlFor={id}>Department</label>
      <div className={styles.control}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-activedescendant={expanded && options[active] ? `${id}-option-${active}` : undefined}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          disabled={disabled || !departments.length}
          placeholder="Search departments…"
          value={expanded ? query : (selected?.name ?? '')}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onClick={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setQuery('');
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                !expanded
                  ? 0
                  : Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            } else if (e.key === 'Enter' && expanded) {
              e.preventDefault();
              if (options[active]) choose(options[active]);
            }
          }}
        />
        <ChevronDown size={16} aria-hidden="true" />
        {expanded && (
          <div className={styles.menu}>
            <ul id={`${id}-list`} role="listbox" aria-label="Departments">
              {options.map((d, i) => (
                <li
                  id={`${id}-option-${i}`}
                  key={d.id}
                  role="option"
                  aria-selected={value === d.id}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(d)}
                >
                  <span>{d.name}</span>
                  {value === d.id && <Check size={16} aria-hidden="true" />}
                </li>
              ))}
            </ul>
            {!options.length && <p role="status">No matching departments.</p>}
          </div>
        )}
      </div>
      <small id={`${id}-hint`} className="muted">
        {selected ? `Current selection: ${selected.name}. ` : ''}
        {departments.length
          ? 'Choose from your clinic departments.'
          : 'No departments are available.'}
      </small>
    </div>
  );
}
