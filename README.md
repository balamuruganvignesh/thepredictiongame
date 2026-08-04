# The Prediction Game

🎴 A multiplayer trick-taking card game where strategy beats luck. Predict
exactly how many tricks you'll win each round, then play them out. Hit your
prediction and you score big. Miss and your score drops.

2–10 players, in the browser, no accounts. Open a table, share the 4-letter
code, deal.

## How to play

Each round you bid how many tricks you think you'll win, from 0 up to the
number of cards you were dealt. Once everyone has bid, play out the hand:
follow suit if you can, play trump or discard if you can't. Highest trump wins
the trick; with no trump played, the highest card of the led suit wins.

**Hit your bid exactly and you score `10 + bid`. Miss it and you lose the
difference.** Bidding 3 and winning 3 pays 13; bidding 3 and winning 1 costs 2.

- **10 rounds**, dealing 5-4-3-2-1-1-2-3-4-5 cards.
- **Trump rotates** every round: ♠ → ♦ → ♣ → ♥ → no trump.
- **The last bidder is squeezed**: they can't make the bids add up to the
  number of tricks, so somebody always misses.
- **Double**: right after you bid you get 5 seconds to double your stake. Hit
  it and you score `2 × (10 + bid)`. Miss it and you lose `10 + bid` flat, no
  matter how far off you were. One click, and it's final — and nobody else is
  told. Your double stays secret until the scores land.
- **No turn timers, ever.** Nobody is ever skipped for thinking too long. The
  server only plays for a seat that has actually disconnected. That 5-second
  Double window is the one clock in the game, and all it closes is an optional
  side bet.

The first player at a table is the host: everyone else readies up, the host
picks the mode and starts. No auto-start countdown.

## Chaos mode

The host can flip a table from classic to chaos. Every seat is dealt a secret
role, and each round that role deals you **one** of its abilities at random —
use it or lose it.

| Role | | What it does |
| --- | --- | --- |
| The Detective | 🕵️ | Read hands and the undealt deck. Cast an illusion, or decide who opens the next trick. |
| The Joker | 🃏 | Swap cards, hands and bids — but only 75% of swaps land. |
| The Gambler | 🎲 | Raise your own stakes and flip coins with fate. |
| The Judge | ⚖️ | Bend other players' bids, steal their tricks, disguise the truth. |
| The Guardian | 🛡️ | Nullify anything aimed at you; lock your bid against meddling. |
| The Time Traveler | ⏳ | Reopen a bid, pull a played card back, or trade your ability for another role's. |
| The Angel | 😇 | Every ability is spent on somebody else. They say kindness comes back around. |
| The Mirrorer | 🪞 | **Rare.** Bet on another player and ride their tricks. |

Announcements name the **role**, never the player — working out who holds what
is most of the game. Roles are revealed on the final standings.

Seven standard roles means a table of 7 or fewer never has a duplicate.

Full ability lists are on the **[Chaos Mode wiki page](https://github.com/balamuruganvignesh/thepredictiongame/wiki/Chaos-Mode)**.


## Spectating

Join a table that's already playing and you'll watch instead of bouncing off an
error: you see the tricks, the score sheet and the chat, but no hand. When that
game ends you're given a seat automatically, so you're in for the next one.

## Credits

Card faces are the [Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack)
by [Kenney](https://kenney.nl), released under CC0.
