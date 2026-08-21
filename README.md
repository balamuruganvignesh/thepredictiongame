# The Prediction Game

🎴 A multiplayer trick-taking card game where strategy beats luck. Predict
exactly how many tricks you'll win each round, then play them out. Hit your
prediction and you score big. Miss and your score drops.

2–10 players, in the browser, no accounts. Open a table, share the 4-letter
code, deal.


**Four games at one table.** Pick The Prediction Game, [Hearts](#hearts), Golf,
or [Blackjack](#blackjack) on the landing screen when you open a table, and
the host can still switch it from a card in the lobby. Joining by code puts
you in whatever that table is already playing. Same table, same code, same
chat — different game.

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
- **A beat between cards.** Once a card hits the table there's a 3-second pause
  before the next player's turn opens, so a trick can actually be watched. It
  never skips anyone — during it nobody is on the clock at all, and a Time
  Traveler's Rewind aimed at that moment is held rather than refused.
- **No turn timers, ever.** Nobody is ever skipped for thinking too long. The
  server only plays for a seat that has actually disconnected. That 5-second
  Double window is the one clock in the game, and all it closes is an optional
  side bet.

The first player at a table is the host: everyone else readies up, the host
picks the mode and starts. No auto-start countdown.

## Hearts

The other game on the menu, and the opposite instinct: **points are bad here,
and the lowest score wins.** 3–7 players.

Every card in the deck is dealt out, so a round is as long as your hand. Each
♥ you collect is 1 point and the Q♠ is 13 — 26 points on the table every round.

- **Pass three.** Before each round you give three cards away: left, then
  right, then across, then a round with no passing at all, repeating. (At three
  players the "across" round is a no-pass round — across is already your
  neighbour.) Everyone chooses at the same time.
- **The 2♣ opens**, and whoever holds it must lead it. At table sizes where the
  deck doesn't divide evenly, the lowest non-scoring cards are removed to make
  it fit — every heart and the queen always stay in — so the opening card is
  simply the lowest club dealt.
- **Follow suit if you can.** No trump: the highest card of the led suit takes
  the trick, and the winner leads the next.
- **Hearts must be broken** before anyone can lead one. They break the first
  time somebody discards a heart because they couldn't follow suit.
- **Nothing painful on the first trick**: no hearts, no queen, unless penalty
  cards are all you hold.
- **Shoot the moon.** Take all 13 hearts *and* the queen and you score nothing
  while everyone else takes 26.
- **The game ends** after the round in which somebody crosses the target score
  (the host picks 50, 100 or 200). Lowest total wins — reaching the target
  isn't losing by itself, it just calls time.

Chaos roles are a Prediction Game feature; a Hearts table is always straight.

## Blackjack

The fourth game. 2–7 players, dealt fresh from a multi-deck shoe every round.
**Hands are dealt face up and stay that way** — everyone at the table can see
everyone's cards, the way blackjack is actually played.

The host picks a mode from the lobby:

- **Vs Dealer** — classic blackjack. Each seat plays its hand against one
  shared dealer, whose second card stays hidden until the dealer's own turn.
- **Vs Players** — no dealer. Whoever lands closest to 21 without busting
  wins the round; a tie for the best hand splits the win.

On your turn: **Hit** for another card, **Stand** to lock in your total, or
**Double** — take exactly one more card and your turn ends immediately, for
double the round's points either way. Double is only on offer as your very
first decision.

- **A natural — 21 on your first two cards — settles on the spot**, before
  you're even offered a turn.
- **The dealer plays a fixed rule**: hit under 17, stand on 17 or more, soft
  or hard. No insurance, no peeking.
- **Scoring is simple points, not chips.** Push scores 0; a natural beats a
  non-natural for +2; a regular win or loss is ±1 (±2 if you doubled). In Vs
  Players, busting always costs −1 and everyone else who isn't the winner
  scores 0.
- **Most points after the host-chosen round count wins.**

No Split, no chip stacks — just hit, stand, and double. Chaos roles are a
Prediction Game feature; a Blackjack table is always straight.

## Chaos mode

The host can flip a table from classic to chaos. Every seat is dealt a secret
role, and each round that role deals you **one** of its abilities at random —
use it or lose it.

| Role | | What it does |
| --- | --- | --- |
| The Detective | 🕵️ | Read hands and the undealt deck. Black out cards nobody can then see, or decide who opens the next trick. |
| The Joker | 🃏 | Swap cards, hands and bids — but only 75% of swaps land. |
| The Gambler | 🎲 | Raise your own stakes and flip coins with fate. |
| The Judge | ⚖️ | Bend other players' bids, steal their tricks, disguise the truth. |
| The Guardian | 🛡️ | Nullify anything aimed at you; lock your bid against meddling. |
| The Time Traveler | ⏳ | Reopen a bid, pull a played card back, or trade your ability for another role's. |
| The Angel | 😇 | Every ability is spent on somebody else. They say kindness comes back around. |
| The Mirrorer | 🪞 | Never plays its own game — rides your bid, your tricks, your score. |

Announcements name the **role**, never the player — working out who holds what
is most of the game. Roles are revealed on the final standings.

Seven standard roles means a table of 7 or fewer never has a duplicate. You're
never dealt an ability the round can't use, either — no Rewind in a 1-card
round, no two-target ability at a table of two.

One button, above the dock: **⚡ your ability** while it's live, opening a small
panel that doesn't cover the table so you can aim while watching the trick, then
**🎭 ROLE** once it's spent. Everything private that happens to you — what your
ability found *and* what somebody else quietly did to you — is kept there for
the round, and you can browse every role from it mid-game.

Full ability lists are on the **[Chaos Mode wiki page](https://github.com/balamuruganvignesh/thepredictiongame/wiki/Chaos-Mode)**.


## Spectating

Join a table that's already playing and you'll watch instead of bouncing off an
error: you see the tricks, the score sheet and the chat, but no hand. When that
game ends you're given a seat automatically, so you're in for the next one.

## Signing in, coins and the shop

> **Running it locally with sign-in enabled:** `npm run dev` reads `.env`, so put
> `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in there (get them from the Google
> Cloud Console as a **Web application** OAuth client, with
> `http://localhost:3001/auth/google/callback` as an authorized redirect URI).
> With them unset the `/auth/*` routes simply aren't registered and the game runs
> anonymously, exactly as it always has.

Signing in with Google is **optional** — a table code and a name is still all you
need, and always will be. What an account buys you is one identity instead of
one per browser: your history, your coins and your cosmetics follow you to your
phone, and you can pick a game back up on another device mid-round.

Finish in the **top three** of any game and you earn coins — 50 for first, 30 for
second, 15 for third. Ties share the better placing. Abandoned games (a restart
vote) pay nothing, and neither do two-player tables.

Coins buy cosmetics in the **shop**: table themes and card backs (both change
how the game looks for you) and extra reactions (which everyone sees). Nothing
in there affects play — no powerups, no advantage, nothing to buy with real
money. You earn coins even while playing anonymously, and they
come with you the first time you sign in.

## Credits

Card faces are the [Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack)
by [Kenney](https://kenney.nl), released under CC0.
