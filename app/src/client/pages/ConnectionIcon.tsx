/** Connection-page artwork from the approved draft; independent of brand artwork. */
export function ConnectionIcon({ name }: { name: "plug" | "package" | "privacy" }) {
  return <svg className={`ui-glyph connection-artwork connection-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "plug" ? <><path d="M9 3v5m6-5v5" /><rect x="5" y="8" width="14" height="4" rx="1.5" /><path d="M7 12v3a5 5 0 0 0 10 0v-3M12 20v2" /></> : name === "package" ? <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5v4" /></> : <><path d="M12 3 4 6v5c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>}
  </svg>;
}
