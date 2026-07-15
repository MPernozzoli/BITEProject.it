export default {
  plugins: {
    // Must run before tailwindcss: src/index.css pulls in the main site's stylesheet,
    // and Tailwind needs its @tailwind directives inlined into a single file.
    "postcss-import": {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
