# Add the uploaded 3D models

## Changes
- Use the Neon Core Processor as the AI chip and the Neon Neuron as the neuron model.
- Add the Luminous Pink Brain beside the right-hand Brain network.
- Use the stylized bio model as the VR pen/controller pointer.
- Keep the sci-fi platform upload unused because the requested scene already has its own pedestals.
- Store the four app models as CDN assets, preload them, and retain the existing safe fallback behavior.

## Technical details
- Update only the model-loading and scene model placement code.
- Preserve the network layout, camera, drawing, inference, spiking, lesion, and guidance behavior.
- Fit each imported model to the existing scene scale; the VR pointer continues to follow the right controller ray.
- Verify loading and rendering in the desktop preview; VR controller alignment remains headset-dependent.
