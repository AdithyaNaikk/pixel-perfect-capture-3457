# AI forward-pass mode

## Build
- Add a pure ANN forward-pass helper using ReLU, shared weights, and optional hidden-neuron lesions.
- Run the ANN whenever the drawing Run action increments its run identifier.
- Animate the AI hidden and output neuron brightness from dim to normalized activation over 150 ms.
- Add a halo around the predicted output and an AI answer/calculation panel above the left network.

## Technical details
- Keep all computation client-side and leave the SPIKING network unchanged.
- Use 50,816 calculations per run: `784 × 64 + 64 × 10`.
- Preserve the existing drawing controls, camera framing, layer positions, and connection rendering.
