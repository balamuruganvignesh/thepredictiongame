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
  matter how far off you were. One click, and it's final.
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
| The Detective | 🕵️ | Read hands, bids and the undealt deck. Cast an illusion, or seize the lead outright. |
| The Joker | 🃏 | Swap cards, hands and bids — but only 60% of swaps land. |
| The Gambler | 🎲 | Raise your own stakes and flip coins with fate. |
| The Judge | ⚖️ | Bend other players' bids, steal their tricks, disguise the truth. |
| The Guardian | 🛡️ | Nullify anything aimed at you; lock your bid against meddling. |
| The Mirrorer | 🪞 | **Rare.** Bet on another player and ride their tricks. |

