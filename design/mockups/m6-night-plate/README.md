# M6 Night plate (primary tone: medium; `?tone=light|medium|deep`)
Concept: the simulated dish as a specimen on an ink-navy anatomical plate, with numbered leader-line callouts, corner brackets, a log-scale magnification ruler (Cells 80x / Colony 40x / Wound 20x / Field 5x) and engraved-serif captions.
Differs from M1-M5: dark ground, circular dish with graduated rim and reflection ring, callouts placed from the render (positions computed from the wound geometry and a colour scan), segmented telemetry bars (P(close), stall, ensemble spread), Light|Medium|Deep tone switcher in the header.
Type: condensed uppercase `Avenir Next Condensed` headings (600, .12em), mono amber numerals only, Charter captions. Tones are illustrative, muted derivations (not a Monk-scale claim).
Strengths: strong specimen focus and hierarchy; callouts double as the key to the tissue states; chrome stays monochrome so tissue and amber numerals carry the colour.
Risks: (1) darkest tone on navy is only 3.97:1 and wound vs intact is 2.6 to 3.0:1 (cellfield colours, unchanged); (2) white leaders vanish on pale tissue (1.2:1 on light), so each has a dark under-stroke; (3) amber and violet need words beside them, which they have; (4) dense small type (11 to 13 px), and a dark UI beside a bright specimen may glare in the demo room.
Contrast checks run (WCAG ratios, computed): #E8EAF2 on panel #0B0E1B 16.0, on ground #0E1224 15.5; #AEB4C8 9.3 / 9.0; #7C84A0 5.2 (axis zero line, tertiary only); amber #E0A458 8.8; violet #B8A9E8 9.0; blue #56B4E9 8.3.
Controls and graphics: control border #8B93AE 6.1 to 6.3; dark text on Heal blue 8.3; on white active buttons 16.0; segment fill white vs empty #2A3150 10.6, violet 6.0; dish rim vs ground 15.5.
Tissue vs ground: light 12.9, medium 8.3, deep 4.0; wound vs intact: light 3.0, medium 2.7, deep 2.6 (below 3:1, so state is also carried by the soft gradient, speckle and nuclei cues and the legend words).
Decorative only (not relied on): hairlines #3A4160 1.9:1, grid, empty telemetry segments 1.5:1.
Honesty chip "SIMULATED CELLS - not tracked cells", plate caption and source line are always visible. Renders use cellfield.js v2 unmodified.
