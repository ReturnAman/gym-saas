import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/open",
    name: "Gym SaaS — Gym Management",
    short_name: "Gym SaaS",
    description: "One platform for gyms and fitness studios. Each gym has its own workspace.",
    start_url: "/open",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      {
        src: "/gym-saas-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/gym-saas-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
