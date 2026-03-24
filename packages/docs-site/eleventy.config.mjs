import { IdAttributePlugin, HtmlBasePlugin } from "@11ty/eleventy";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

/** @param {import("@11ty/eleventy").UserConfig} eleventyConfig */
export default function (eleventyConfig) {
  // Passthrough: static assets
  eleventyConfig.addPassthroughCopy("src/assets");

  // Passthrough: .nojekyll tells GitHub Pages not to process the site with Jekyll
  eleventyConfig.addPassthroughCopy({ "src/.nojekyll": ".nojekyll" });

  // Passthrough: docs images from repo root (read-only, do not copy sources)
  eleventyConfig.addPassthroughCopy({ "../../docs/images": "docs/images" });

  // Filter: render a raw markdown string to HTML (used by reference doc pages)
  eleventyConfig.addFilter("renderMarkdown", (content) =>
    content ? md.render(String(content)) : ""
  );

  // Plugins
  eleventyConfig.addPlugin(IdAttributePlugin);
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // Watch targets that live outside the input directory
  eleventyConfig.addWatchTarget("../../README.md");
  eleventyConfig.addWatchTarget("../../CHANGELOG.md");
  eleventyConfig.addWatchTarget("../../docs/**/*.md");
  eleventyConfig.addWatchTarget("../../packages/*/README.md");
  eleventyConfig.addWatchTarget("../../examples/**/*.md");

  return {
    dir: {
      input: "src",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
    pathPrefix: "/kanban-lite/",
  };
}
