/**** Tailwind Config ****/
const { miewebUIPreset } = require('@mieweb/ui/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [miewebUIPreset],
  darkMode: ['class', '.dark &'],
  content: [
    './client/**/*.{js,ts,jsx,tsx,html}',
    './imports/**/*.{js,ts,jsx,tsx,html}',
    './node_modules/@mieweb/ui/dist/**/*.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
