export default [
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        globalThis: "readonly",
        WebSocket: "readonly",
        setImmediate: "readonly",
        AbortController: "readonly",
        FormData: "readonly",
        Blob: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },
  {
    ignores: ["node_modules/", "public/"],
  },
];
