// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { generateSidebar } from "./sidebar-generator.ts";
import { generateRedirects } from "./redirect-generator.ts";

// https://astro.build/config
export default defineConfig({
  site: 'https://watransguide.org',
  redirects: generateRedirects(),
  integrations: [
    starlight({
      favicon: "favicon.ico",
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: './src/assets/transcadia.png',
          },
          content: './src/assets/transcadia.png',
        },
        {
          tag: 'meta',
          attrs: {
            property: 'image',
            content: './src/assets/transcadia.png',
          },
          content: './src/assets/transcadia.png',
        },
      ],
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
