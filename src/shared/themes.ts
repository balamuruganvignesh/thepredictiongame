// The table palettes a player can pick, mirrored onto `<html data-theme=...>`
// by client/theme.tsx. Each id has a matching :root[data-theme='<id>'] block
// in client/styles/tokens.css that overrides the palette tokens -- nothing
// else in the app knows a theme exists.
//
// A local display preference, not table state: there's no way to paint your
// palette onto someone else's screen, so this list is never shared with the
// server.

export type Theme = {
  id: string
  name: string
  blurb: string
  swatch: string
}

export const THEMES: readonly Theme[] = [
  {
    id: 'theme-felt',
    name: 'Card Room',
    blurb: 'Green baize and brass. The table your grandad lost money at.',
    swatch: '#1e6b4a',
  },
  {
    id: 'theme-parchment',
    name: 'Parchment',
    blurb: 'Warm paper and faded ink, for playing in daylight.',
    swatch: '#c8a870',
  },
  {
    id: 'theme-neon',
    name: 'Neon',
    blurb: 'Hot magenta on black. Loud, and unapologetic about it.',
    swatch: '#ff3fa4',
  },
  {
    id: 'theme-ember',
    name: 'Ember',
    blurb: 'Banked coals and low orange light.',
    swatch: '#e8642c',
  },
] as const
