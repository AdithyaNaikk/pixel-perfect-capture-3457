<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- App-served 3D models use Lovable Assets pointer files under `src/assets`; this keeps large GLBs out of source control while preserving stable URLs.
- The Brain visualization is one procedural output neuron driven from full recorded SNN telemetry; the hidden 64×10 network remains simulated but is not rendered.
- Brain-side effects align to the unchanged neuron.glb via hand-tuned guide curves in `src/lib/brainGuides.ts` (toggle "Debug guides"); the GLB is never replaced by generated geometry.
- VR right hand is arbitrated through `src/lib/rightHand.ts` so drawing (trigger) and teleport (grip) never run at once.
- Brain simulation is the user-provided `snnRun` in `src/lib/snnRun.ts`, kept verbatim (ts-nocheck); app glue lives in `src/lib/snn.ts` — why: user requires the exact code.
- Neuron firing is drawn by a shader patched onto neuron.glb's own materials (`src/lib/neuronShader.ts`), no separate glow objects — why: pulses must live in the model surface.
