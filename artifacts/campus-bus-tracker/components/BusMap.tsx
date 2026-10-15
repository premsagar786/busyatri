// Metro selects the `.native` or `.web` implementation for each platform.
// Keep a web fallback so TypeScript can resolve the shared component import.
export { default } from './BusMap.web';
