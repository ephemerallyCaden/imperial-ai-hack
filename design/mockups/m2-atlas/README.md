# M2 Atlas
Concept: a specimen plate on warm paper (#FBF8F1) where five numbered callouts on the simulated field match a numbered key in the margin column.
Differs: only variant with on-canvas leader lines (0.75px, targets found from the render's pixels), small-caps kickers, serif body, "Plate I" title.
Primary tone: medium (`?tone=light|medium|deep`; palettes are muted, illustrative, loosely anchored on Monk tones). Everything on the canvas is SIMULATED.
Type: Charter / Iowan Old Style / Palatino serif; -apple-system sans for controls; ui-monospace for readouts. No web fonts, no network.
Strengths: (1) legend and canvas read as one plate, so states are learnable without hovering; (2) ribbon chart and scrubber share one time axis; (3) chrome stays warm grey/ink, so only the tissue is saturated.
Risks: (1) dock is 140 px, taller than the 112 px target, and the ribbon plot is only about 55 px high; (2) callout targets are picked by position, so they would need recomputing on a live field; (3) the margin column is dense at 320 px (5 legend entries, forecast and scorecard).
Files: index.html, preview.png (= tone-medium), tone-light.png, tone-deep.png. Render: Playwright Firefox, 1440x900.
