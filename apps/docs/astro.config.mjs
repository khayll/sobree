import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

/**
 * docs.sobree.dev — built on Starlight.
 *
 * Sidebar matches the package surface: a Quick start, then Concepts
 * (architecture, plugins, OOXML model), then API reference grouped
 * by package. The actual API pages start as hand-written stubs;
 * future work threads TypeDoc through to auto-generate.
 */
export default defineConfig({
  site: "https://docs.sobree.dev",
  integrations: [
    starlight({
      title: "Sobree",
      logo: { src: "./src/assets/logo-mark.svg", replacesTitle: false },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/khayll/sobree" },
      ],
      customCss: ["./src/styles/sobree-tokens.css"],
      sidebar: [
        {
          label: "Get started",
          items: [
            { label: "Introduction", link: "/" },
            { label: "Quick start", link: "/quick-start/" },
            { label: "Live demo", link: "https://sobree.dev/try" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Architecture", link: "/concepts/architecture/" },
            { label: "Plugin model", link: "/concepts/plugins/" },
            { label: "Document model", link: "/concepts/document/" },
            { label: "Editing model", link: "/concepts/editing-model/" },
            { label: "Track changes", link: "/concepts/track-changes/" },
          ],
        },
        {
          label: "API reference",
          items: [
            { label: "createSobree()", link: "/api/create-sobree/" },
            { label: "Sobree (façade)", link: "/api/sobree/" },
            { label: "Editor", link: "/api/editor/" },
            { label: "HeadlessSobree", link: "/api/headless/" },
            { label: "MCP server (LLM tools)", link: "/api/mcp/" },
            { label: "BlobStore (binary parts)", link: "/api/blob/" },
            { label: "History (undo / redo)", link: "/api/history/" },
            { label: "Viewport", link: "/api/viewport/" },
            { label: "Document builders", link: "/api/builders/" },
            { label: "Fonts", link: "/api/fonts/" },
            { label: "DOCX I/O", link: "/api/docx/" },
          ],
        },
        {
          label: "Plugins",
          items: [
            { label: "Building your own", link: "/plugins/build-your-own/" },
            { label: "BlockTools (toolbar)", link: "/api/block-tools/" },
            { label: "Keyboard (shortcuts)", link: "/api/keyboard/" },
            { label: "Review (track changes + comments)", link: "/api/review/" },
            { label: "ZoomControls", link: "/api/zoom-controls/" },
          ],
        },
      ],
    }),
  ],
  vite: {
    optimizeDeps: { exclude: ["@sobree/core"] },
    ssr: { noExternal: ["@sobree/core"] },
  },
});
