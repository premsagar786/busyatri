/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#19352f',
    tint: '#176d5d',
    background: '#f4f6f0',
    foreground: '#19352f',
    card: '#ffffff',
    cardForeground: '#19352f',
    primary: '#176d5d',
    primaryForeground: '#ffffff',
    secondary: '#e8eee6',
    secondaryForeground: '#28473f',
    muted: '#edf0e9',
    mutedForeground: '#718079',
    accent: '#d8f177',
    accentForeground: '#203a30',
    destructive: '#c94a3c',
    destructiveForeground: '#ffffff',
    border: '#dce4da',
    input: '#dce4da',
  },

  dark: {
    text: '#e7f0e9',
    tint: '#79cfb4',
    background: '#101e1a',
    foreground: '#e7f0e9',
    card: '#1a2b25',
    cardForeground: '#e7f0e9',
    primary: '#79cfb4',
    primaryForeground: '#10251e',
    secondary: '#263a32',
    secondaryForeground: '#e1eee6',
    muted: '#22332d',
    mutedForeground: '#a2b5aa',
    accent: '#d8f177',
    accentForeground: '#203a30',
    destructive: '#ff7668',
    destructiveForeground: '#ffffff',
    border: '#30443b',
    input: '#30443b',
  },

  radius: 18,
};

export default colors;
