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
