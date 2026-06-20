import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import html from "@html-eslint/eslint-plugin";

export default [
  { ignores: ["dist/**", "../static/**", "node_modules/**"] },
  // Scope the JS recommended ruleset to JS files so it never leaks onto HTML.
  { files: ["**/*.js"], ...js.configs.recommended },
  {
    ...html.configs["flat/recommended"],
    files: ["**/*.html"],
    language: "@html-eslint/html",
  },
  {
    files: ["**/*.html"],
    rules: {
      // Prettier owns HTML formatting; keep only the correctness rules.
      "@html-eslint/indent": "off",
      "@html-eslint/quotes": "off",
      "@html-eslint/attrs-newline": "off",
      "@html-eslint/element-newline": "off",
      "@html-eslint/no-extra-spacing-tags": "off",
      // Match Prettier, which self-closes void elements (<meta />, <link />).
      "@html-eslint/require-closing-tags": ["error", { selfClosing: "always" }],
      // The PWA deliberately uses manifest/theme-color etc. that aren't Baseline-wide yet.
      "@html-eslint/use-baseline": "off",
      // Hooks use data-el; the only remaining ids are ARIA/anchor targets, which are kebab-case.
      // This blocks reintroducing a camelCase id as a scripting hook.
      "@html-eslint/id-naming-convention": ["error", "kebab-case"],
    },
  },
  {
    // Partials are HTML fragments inlined into index.html at build time, so the
    // document-level rules don't apply; keep all correctness rules.
    files: ["partials/**/*.html"],
    rules: {
      "@html-eslint/require-doctype": "off",
      "@html-eslint/require-lang": "off",
      "@html-eslint/require-title": "off",
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
  {
    // Build config, lint config, and test files run in Node.
    files: ["*.config.js", "src/**/*.test.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  prettier,
];
