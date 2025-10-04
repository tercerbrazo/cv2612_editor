import React, { useState, FC } from 'react'

type MenuDropdownOption = { label: string; value: number | string }

type MenuDropdownProps = {
  title: string
  text: string
  options: MenuDropdownOption[]
  onSelect: (option: MenuDropdownOption) => void
}

const MenuDropdown: FC<MenuDropdownProps> = ({
  title,
  text,
  options,
  onSelect,
}) => {
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
              <li key={o.value} onClick={() => onSelect(o)}>
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
