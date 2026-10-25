# Relay mark adoption

User approved Concept 01 on 2026-10-26. Baseline: h2 a13f15b.

- Adopt the exact approved mark from docs/brand/relay-concept-01/mark.svg as the canonical desktop brand SVG. Preserve its original viewBox and clip geometry.
- Derive the README header, native SVG/PNG/ICNS icon and all native sizes from that canonical source. Preserve unique clip IDs when embedding.
- Keep the gfot name and existing UI/workflows. Update actual desktop screenshots and README hero to the charcoal/blue relay identity.
- Render and visually check the hero, icon and small sizes; confirm source and packaged Electron load the new mark. Confirm the bundled native icon matches the generated ICNS.
- Do not introduce provider calls, change accounts or interrupt active user tasks.
