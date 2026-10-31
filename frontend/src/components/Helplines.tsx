const HELPLINES = [
  { number: '112', label: 'Emergency (police, fire, ambulance)' },
  { number: '181', label: "Women's Helpline" },
  { number: '1098', label: 'Childline' },
]

export function Helplines() {
  return (
    <section className="card helplines" aria-labelledby="helplines-title">
      <h2 id="helplines-title">Helplines (India)</h2>
      <ul>
        {HELPLINES.map((h) => (
          <li key={h.number}>
            <a href={`tel:${h.number}`} className="helpline">
              <span className="helpline-num">{h.number}</span>
              <span>{h.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="muted">
        This app complements, and does not replace, emergency services. If you are in immediate danger,
        call 112.
      </p>
    </section>
  )
}
