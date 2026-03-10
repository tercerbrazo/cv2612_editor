import React, { useState } from 'react'

type MenuDropdownOption<T extends string | number> = {
  label: string
  value: T
}

type MenuDropdownProps<T extends string | number> = {
  title: string
  text: string
  options: ReadonlyArray<MenuDropdownOption<T>>
  onSelect: (value: T) => void
}

const MenuDropdown = <T extends string | number>({
  title,
  text,
  options,
  onSelect,
}: MenuDropdownProps<T>) => {
  const [open, setOpen] = useState(false)

  return (
    <a
      href="/"
      title={title}
      onClick={(ev) => {
        ev.preventDefault()
        setOpen((prev) => !prev)
      }}
      className="menu-dropdown"
      onMouseLeave={() => setOpen(false)}
    >
      <span>{text}</span>
      <div className="options">
        {open && (
          <ul>
            {options.map((o) => (
              <li key={o.value} onClick={() => onSelect(o.value)}>
                {o.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </a>
  )
}

export { MenuDropdown, MenuDropdownOption }
