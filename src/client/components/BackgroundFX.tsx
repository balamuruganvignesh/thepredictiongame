// Animated backdrop: soft grey "splotches" that slowly drift and pulse behind
// everything, so the table isn't just a flat dark screen. Pure CSS.

const BLOBS = [
  { from: [18, 30], to: [30, 55], size: 560, tint: '#464a58', dur: 26 },
  { from: [82, 24], to: [68, 44], size: 620, tint: '#383c48', dur: 32 },
  { from: [50, 72], to: [44, 52], size: 700, tint: '#404250', dur: 38 },
  { from: [30, 82], to: [20, 62], size: 480, tint: '#4e5060', dur: 29 },
  { from: [74, 78], to: [84, 60], size: 540, tint: '#343846', dur: 34 },
  { from: [50, 20], to: [58, 36], size: 500, tint: '#484c5c', dur: 23 },
]

export function BackgroundFX() {
  return (
    <div className="bg-fx" aria-hidden="true">
      {BLOBS.map((blob, i) => (
        <span
          key={i}
          className="bg-fx__blob"
          style={
            {
              '--from-x': `${blob.from[0]}%`,
              '--from-y': `${blob.from[1]}%`,
              '--to-x': `${blob.to[0]}%`,
              '--to-y': `${blob.to[1]}%`,
              '--blob-size': `${blob.size}px`,
              '--blob-tint': blob.tint,
              '--drift': `${blob.dur}s`,
              '--pulse': `${blob.dur * 0.6}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
