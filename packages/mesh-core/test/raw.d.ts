// Vite's `?raw` imports (goldens read as text by the Node and the Chromium runs alike).
declare module '*.json?raw' {
  const text: string;
  export default text;
}
