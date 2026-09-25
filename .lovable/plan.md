# Make the AI computation visible

## Build
- Replace the AI’s current single fade with a fixed 0.4-second input → hidden → output sweep.
- Keep each completed layer steadily lit for the rest of the run, with no AI-side blinking or flashing.
- Normalize hidden and positive output activations per layer; give every positive activation at least 0.15 brightness while keeping zeros dark.
- Enlarge the winning AI output neuron and retain its bright cyan ring.
- During each sweep stage, brighten the corresponding AI connections from source activation × weight magnitude, then return them to their existing faint appearance.
- Add the requested small 3D explanation beneath each answer, without changing the Brain playback or any other behavior.

## Technical details
- Reuse the existing instanced neuron meshes and the single line geometry; update instance matrices/colors and line vertex colors in place.
- Use frame-time animation with no per-frame React state updates or allocations.
- Leave weights, forward-pass math, spiking simulation, drawing, lesions, camera, models, layout, and colors unchanged.
- Verify the scene renders, run a real drawing flow, and confirm the AI settles to a steady state without preview errors.
