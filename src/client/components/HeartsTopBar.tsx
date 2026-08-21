// Hearts' version of the top bar. Same strip, different numbers: there is no
// trump, so the glyph slot carries the broken-hearts state, and each player's
// chip shows the penalty points they've taken THIS round over their running
// total. Low is good here, so a clean chip is the green one.

type Props = {
  roundNumber: number
  trickNumber: number
  totalTricks: number
  heartsBroken: boolean
  targetScore: number
  players: { id: string; name: string; penalty: number; total: number; isTurn: boolean }[]
}

export function HeartsTopBar({
  roundNumber,
  trickNumber,
  totalTricks,
  heartsBroken,
  targetScore,
  players,
}: Props) {
  return (
    <div className={`topbar${players.length >= 7 ? ' topbar--big' : ''}`}>
      <div className="topbar__info">
        <span
          className="topbar__trump"
          style={{ color: heartsBroken ? '#eb6064' : undefined, opacity: heartsBroken ? 1 : 0.45 }}
          title={heartsBroken ? 'hearts are broken' : 'hearts not broken yet'}
        >
          {heartsBroken ? '💔' : '♥'}
        </span>
        <span className="topbar__round">
          Round {roundNumber} · to {targetScore}
        </span>
        <span className="topbar__hand">
          {trickNumber > 0 ? `Hand ${trickNumber} of ${totalTricks}` : 'Passing…'}
        </span>
      </div>

      {players.map((player) => (
        <div
          key={player.id}
          data-player-id={player.id}
          className={`chip${player.isTurn ? ' chip--turn' : ''}`}
          title={`${player.name}: ${player.penalty} this round, ${player.total} total`}
        >
          <span className="chip__name">{player.name}</span>
          <span className={`chip__score${player.penalty === 0 ? ' is-good' : ' is-bad'}`}>
            <span key={`${player.penalty}-${player.total}`} className="score-pop">
              +{player.penalty} / {player.total}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
