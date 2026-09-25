# Replace the Brain network with one living neuron

## Build
- Keep the Brain eye and optic nerve, but hide the Brain’s 64-neuron grid, 10 output neurons, labels, and connection web. The AI network remains unchanged and is still the only visible place to edit lesions.
- Add one large low-poly procedural neuron on the Brain side: branching dendrites toward the eye, a soma in the middle, and a long axon ending beside a small head and thought bubble. Keep the existing neuron model only as a faint background decoration.
- Keep the real hidden and output network running off-screen. Visualize the final winning output neuron without revealing its digit early.
- Feed up to 40 pooled dendrite pulses from actual hidden-neuron spikes with non-zero weights to that output. Positive weights use warm pulses, negative weights use cool blue pulses, and pulse size follows normalized weight magnitude.
- Animate soma charge from that output neuron’s recorded membrane potential. On a real spike, flash it white-yellow, briefly enlarge it, show a glow halo, reset it dim, and send a pulse down the axon to the head.
- Show a live firing counter and a compact live bar chart for all 10 output spike counts. Highlight the winner only from the recorded decision step onward.
- Keep the thought bubble at “...” until the recorded decision step, then reveal the digit and “decided at step X”. Retain confidence, calculation count, and a clear no-answer state.
- Add the caption: “Output neuron of the brain-style network. The network behind it is running, just hidden.”
- Keep the Brain eye-to-neuron flow readable with a faint optic-nerve bundle that represents the hidden network between them.

## Lesion-mode drawing fix
- Desktop drawing remains active in lesion mode; only clicking an AI hidden neuron toggles its shared lesion index.
- In VR, the right controller always draws and uses the existing drawing buttons. Lesion selection moves to the left-controller ray and trigger so drawing and lesion controls cannot compete.
- Preserve lesions across new drawings, runs, and leaving lesion mode; only Heal all clears them.

## Simulation data and display rules
- Extend the existing simulation result with each output neuron’s post-update/post-reset membrane potential per timestep; do not change weights, thresholds, seeded spikes, lesion masking, or prediction math.
- Use the final predicted output as the displayed neuron. Reveal it only when playback reaches `decisionStep`.
- Treat zero total output spikes as “No answer”. Otherwise show confidence as the winner’s spike count divided by all output spikes, while preserving the existing calculation count.
- Keep the 4-second playback, frame-time animation, pooled objects, basic materials, and no per-frame React allocations.

## Verification
- Verify the AI side is visually and behaviorally unchanged.
- Run a real drawing and confirm dendrite events, membrane charging/reset, output spikes, axon pulses, all 10 bars, delayed reveal, confidence, and calculations all match the recorded simulation.
- Turn lesion mode on, lesion AI hidden neurons, draw and run again on desktop, then confirm the Brain result reflects the same damage.
- Check the VR interaction code so the right trigger still draws in lesion mode and only the left ray/trigger lesions neurons; report headset-only verification separately.
