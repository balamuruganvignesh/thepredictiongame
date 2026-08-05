// The chaos-roles browser: one page per role with its tagline, blurb and full
// ability list. Available in either mode -- reading it in classic is how you
// learn what you're signing up for.

import { useState } from 'react'
import * as RoleDefs from '@shared/roleDefs'

export function RolesGallery({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0)
  const role = RoleDefs.getRole(RoleDefs.roleOrder[page])
  if (!role) return null

  const step = (delta: number) =>
    setPage((current) => (current + delta + RoleDefs.roleOrder.length) % RoleDefs.roleOrder.length)

  return (
    <div className="backdrop" onClick={onClose} role="presentation">
      <div
        className="note modal modal--gallery"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Chaos roles"
      >
        <button className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="gallery__emoji">{role.emoji}</div>
        <h2 className="gallery__name" style={{ color: role.color }}>
          {role.name.toUpperCase()}
        </h2>
        <p className="gallery__tagline">“{role.tagline}”</p>
        <p className="gallery__blurb">{role.blurb}</p>

        <ul className="gallery__abilities">
          {role.abilities.map((id) => {
            const def = RoleDefs.getAbility(id)
            if (!def) return null
            return (
              <li key={id}>
                <b>{def.name}</b> — {def.desc}
              </li>
            )
          })}
        </ul>

        <div className="gallery__nav">
          <button className="button button--ghost" onClick={() => step(-1)}>
            ‹ prev
          </button>
          <div className="gallery__dots" aria-hidden="true">
            {RoleDefs.roleOrder.map((id, i) => (
              <span key={id} className={i === page ? 'is-active' : ''} />
            ))}
          </div>
          <button className="button button--ghost" onClick={() => step(1)}>
            next ›
          </button>
        </div>
      </div>
    </div>
  )
}
