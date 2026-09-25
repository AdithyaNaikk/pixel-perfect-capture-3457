import { createFileRoute } from "@tanstack/react-router";

import { XRApp } from "@/components/XRApp";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Same Weights, Two Brains — WebXR neural network viewer" },
      {
        name: "description",
        content:
          "Step into VR and compare two neural networks running the same weights, side by side in 3D.",
      },
      { property: "og:title", content: "Same Weights, Two Brains" },
      {
        property: "og:description",
        content:
          "A WebXR visualisation of two neural networks sharing one set of weights.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: XRApp,
});
