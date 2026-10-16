// Official Lucide paths: https://lucide.dev/icons/ — ISC, see ../ICONS-LICENSE.txt.
const file = "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z";
const paths = {
  source: [file, "M14 2v5a1 1 0 0 0 1 1h5", "M10 12.5 8 15l2 2.5", "m14 12.5 2 2.5-2 2.5"],
  split: ["M12 3v18"],
  reading: ["M12 5v16", "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"],
  folder: ["m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  text: [file, "M14 2v5a1 1 0 0 0 1 1h5", "M10 9H8", "M16 13H8", "M16 17H8"],
  image: ["m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
  file: [file, "M14 2v5a1 1 0 0 0 1 1h5"],
  reload: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  wrap: ["m16 16-3 3 3 3", "M3 12h14.5a1 1 0 0 1 0 7H13", "M3 19h6", "M3 5h18"],
  minus: ["M5 12h14"], plus: ["M5 12h14", "M12 5v14"],
  fit: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
};
export type FileIconName = keyof typeof paths;
export function FileIcon({ name }: { name: FileIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(name === "split" || name === "image") && <rect width="18" height="18" x="3" y="3" rx="2" />}
    {name === "image" && <circle cx="9" cy="9" r="2" />}
    {paths[name].map((d, i) => <path key={i} d={d} />)}
  </svg>;
}
