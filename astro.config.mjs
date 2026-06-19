// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { generateSidebar } from "./sidebar-generator.ts";
import { generateRedirects } from "./redirect-generator.ts";

// https://astro.build/config
export default defineConfig({
  site: 'https://amity.github.io/watransguide/',
  redirects: generateRedirects(),
  integrations: [
    starlight({
      favicon: "favicon.ico",
      title: "WA Trans Resource and Relocation Guide",
      titleDelimiter: "|",
      logo: {src: "./src/assets/transcadia.png", alt: "Cascadia Douglas Fir flag with trans stripes."},
      social: [],
      sidebar: generateSidebar(),
      components: {
        Footer: "./src/components/Footer.astro",
        Head: "./src/components/Head.astro",
      },
    }),
  ],
});
