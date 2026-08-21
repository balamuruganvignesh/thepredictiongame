// Table talk.
//
// System lines (joins, leaves, someone doubling down) come through the same
// list with no author, styled apart from player messages.

import { useEffect, useRef, useState } from 'react'
import { MAX_CHAT_LENGTH, type ChatMessage } from '@shared/protocol'

type Props = {
  messages: ChatMessage[]
  meId: string | null
  onSend: (text: string) => void
  onClose: () => void
  /** Chaos deals a ROLE + ABILITY column top-right (see Table.tsx) that shares
   *  this corner -- drop the panel's top edge clear of it instead of letting
   *  chat bury it underneath. */
  raised?: boolean
}

export function ChatPanel({ messages, meId, onSend, onClose, raised = false }: Props) {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <aside className={`note chat${raised ? ' chat--raised' : ''}`} aria-label="Table chat">
      <header className="note__header chat__header">
        chat
        <button className="modal__close" onClick={onClose} aria-label="Close the chat">
          ×
        </button>
      </header>

      {/* role="log": new lines are appended to an ongoing record, which is
          exactly what a log is -- and unlike aria-live on the whole panel it
          doesn't re-read the entire backlog when one message lands. */}
      <div className="chat__messages" role="log" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && <p className="chat__empty">say something to the table.</p>}
        {messages.map((message) =>
          message.from == null ? (
            <p key={message.id} className="chat__line chat__line--system">
              {message.text}
            </p>
          ) : (
            <p
              key={message.id}
              className={`chat__line${message.from === meId ? ' chat__line--mine' : ''}`}
            >
              <b className="chat__author">{message.name}</b> {message.text}
            </p>
          ),
        )}
        <div ref={bottom} />
      </div>

      <form className="chat__compose" onSubmit={submit}>
        <input
          className="field__input chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="message the table…"
          aria-label="Chat message"
          // The score-sheet shortcut ignores keystrokes aimed at a text field
          // anyway (see ../useScoresheetShortcut), but stopping propagation
          // here keeps typing entirely local to the box regardless.
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button className="button button--primary chat__send" type="submit" disabled={!draft.trim()}>
          send
        </button>
      </form>
    </aside>
  )
}
