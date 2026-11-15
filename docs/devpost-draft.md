# Devpost: Stitch

**Elevator pitch:** A wound that won't heal can be life or death. Nobody has the luxury of guessing. Stitch tells you hours early whether a lab wound will close, and how sure it is.

**Try it out:** https://github.com/ephemerallyCaden/imperial-ai-hack · Figma: https://www.figma.com/design/vTCApH2oLBShNu4Oi9dsGg

**Entered for:** AI for Science (main track) · Best Designed AI Product (Figma) · Best use of Adaption

**Built with:** python, javascript, pytorch, numpy, scipy, pandas, three.js, claude, anthropic-api, adaption, qwen, lora, figma, html5, css3, github, conformal-prediction, neural-cellular-automata, computer-vision, agentic-ai

---

## Inspiration

Before a new wound treatment gets anywhere near a patient, it gets tested in a dish. Scientists scratch a line through a layer of living cells and film it for a day to see whether the gap closes. That's a scratch assay, and it's everywhere: wound biology, cancer cell migration, fibrosis, drug screens.

The catch is that every tool we found measures closure after it has happened. So the plate sits on the microscope for 19 hours, often to confirm what was obvious at hour two. Watching paint dry has a cousin, and it's watching cells crawl. We wanted to answer the question a scientist actually has at hour two: will this well close by the end of the run, and how sure are you?

## What it does

Stitch watches the first frames of a time-lapse and forecasts the rest of the closure curve, with a 90% band, the time to 50% and 90% closed, and the chance the wound is 90% closed by 19 h.

Then an agent runs the plate check by check. At 1.9, 3.8, 5.7 and 9.5 hours it looks at the new frames, updates the forecast and proposes what to do next: keep imaging, image again or stop because the wound clearly won't close. Anything that stops a plate waits for a person to approve it.

The app has three modes, designed in Figma first:

- Assay plays an agent run on one wound. You get a 3D field of simulated cells closing the scratch, the forecast with its band and a decision card to approve or reject. Right-drag a box to zoom in: the area stays in colour and the rest drops to grey, with stats for the selection. You can also draw your own wound and watch the model heal it live, or upload your own frames.
- Ops is mission control for the agent. It replays every recorded run on one clock, shows which wounds need you and lights up each step of the pipeline as it runs.
- Stats replays our held-out test one wound at a time, revealing the real frames against the band, and lets you inspect any of the 55 series. Sort by worst first, because we'd rather you found our failures than a judge did.

## How we built it

Computer vision first. A classical texture segmenter finds the wound in each phase-contrast frame: cells are textured and the gap is smooth, so local standard deviation plus a threshold and some morphological clean-up gives the wound mask. It scores IoU 0.84 against the dataset's hand-drawn masks (0.60 on the harder later frames), and it refuses blank, blurry or badly segmented frames with a reason instead of guessing. From two masks in a row we compute the speed of every point on the wound edge, no cell tracking needed, which shows exactly where a front is stuck.

The forecaster is a neural cellular automaton (NCA). Caden wrote a cell-agent simulator from published migration rules and trained the NCA to emulate it. It failed our pre-set test, so we sent it back to school: we fine-tuned it on real wound videos in four wound-level folds, so no wound is ever forecast by a model that saw it in training. It now matches the best simple baseline and has the lowest score in our comparison at the first and last checks.

Honest uncertainty came next. Raw NCA ensembles are overconfident: their 90% band covers only 19% of what happens. Rand added leave-one-wound-out conformal calibration, which corrects each wound's forecast using the errors on every other wound. After that the 90% band holds 92% of real outcomes on 28 unseen wounds.

The agent is a lead agent with helpers, and code does the science. At each check the tools run QC, the forecast, a stall flag and the stop-early advice. Policy code lists the decisions that are allowed, Claude picks one and explains it, and a code Critic deletes any number in the explanation that doesn't match a tool output. A refusal or a fired stall flag forces "ask a person". When a wound goes off track, an Investigator re-runs the simulator from other starting conditions and ranks them as hypotheses, never causes.

Traceability and monitoring were built in from the start. Every step goes to an append-only run log with its inputs, outputs, model, tokens, cost and time, so any number in a summary traces back to the tool call that made it. Our five recorded runs have 0 untraced numbers and cost about $0.23 each. Ops reads those same logs.

We used Adaption to fine-tune Qwen 3.5 2B with LoRA for the Intake step, which reads a protocol paragraph and pulls out the frame interval, pixel size and condition. On 30 real Methods paragraphs it went from 47.4% to 80.4% field accuracy (platform win rate 0.95), and the agent uses it, with Claude as the fallback. We also trained Triage and Reporter models and kept them as evaluation results: Triage went from 9.5% to 99.8%, but we changed its pass rule after seeing the results and we say so in the repo.

The data comes from five open datasets. The main one is WHAD, 28 MCF10A wounds filmed for 19 hours. WHiM-BC, Zaritsky, fly embryo laser wounds and Jin 2016 serve as extra tests and priors. The front end is plain JavaScript and three.js with no build step, so anyone can clone it and open it with one command.

## Challenges we ran into

- Our first NCA lost to a two-parameter edge-speed model by 30%. It's humbling to be beaten by a ruler. Fine-tuning on real frames fixed it, but only because we had set the pass mark before scoring.
- Part II of the WHAD dataset turned out to be the same wounds as part I, filmed later. Treating them as separate wounds would have leaked answers between training and testing, so every split is by physical wound.
- Calibration doesn't travel. Bands tuned on ordinary breast cancer cells covered only 15-58% of outcomes on stem-cell-enriched cells, which close about twice as fast. We show that failure on screen instead of hiding it.
- Our stall flag ranks stalls well (AUC 0.77-0.90) but is right only 48-75% of the time when it fires. So it can only ask a person; it can never stop a plate by itself.
- Keeping an LLM honest about numbers. The Critic, the fixed decision list and an adversarial set of 15 attacks (prompt injection, decompression bombs, a reply with a made-up number) all came from asking "what would we need to see to trust this?"

## Accomplishments that we're proud of

- A 90% band that holds 92% of outcomes on wounds the model never saw.
- With a stop rule fixed in advance, 71% of held-out series get a call at the very first check and 82% by 9.5 h, with 91% of calls right. That's 13.5 hours of a 19 hour run freed per well on average, in simulation on recorded data.
- 100% of the numbers the agent writes trace back to a tool output, and 15 of 15 attacks are handled as expected.
- A model that failed its own exam, got fixed and got re-scored honestly. We kept the failed version in the results.
- An interface a scientist can read in five seconds: what needs me, what will each well do and how sure is it.

## What we learned

- The calibration step matters as much as the model. A forecaster with a lying band is worse than no forecaster.
- Most of the value in our agent comes from boring, reliable code: the forecaster, the policy and the Critic. Claude is great at choosing among safe options and explaining them, and we designed it so that's all it needs to do.
- Set the bar before you look at the scores. It stopped us fooling ourselves more than once.
- Pre-registering failure cases (new cell type, new condition) makes the successes believable.

## What's next for Stitch

- Calibrate on a lab's own microscope and cell line, starting with a pilot on one plate.
- Connect it to a live microscope so the agent's "image again" actually triggers the next frame.
- Move the Triage and Reporter fine-tunes from evaluation into the agent once they pass a rule set in advance.
- Try other assays where an early, honest call saves time, such as organoid growth and spheroid invasion.
