import type { Platform } from "../domain/units.ts";

type Artwork = Platform | "brand";
type Placement = "header" | "welcome" | "connection";

/** Original material illustrations, not the platforms' official trademarks.
 * Fixed placement IDs keep SVG paint servers unique when several appear together.
 * Inline vectors work with the existing no-script/no-remote-assets page policy.
 */
export function artwork(kind: Artwork, placement: Placement) {
  const id = `art-${placement}-${kind}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  const defs = `<defs>
    <linearGradient id="${id}-frame" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e2c88e"/><stop offset=".25" stop-color="#fff0bf"/><stop offset=".48" stop-color="#aa8148"/><stop offset=".72" stop-color="#d0ad6e"/><stop offset="1" stop-color="#73532d"/></linearGradient>
    <linearGradient id="${id}-enamel" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#738e7c"/><stop offset=".45" stop-color="#3e6153"/><stop offset="1" stop-color="#1b392f"/></linearGradient>
    <linearGradient id="${id}-paper" x1="0" y1="0" x2="1" y2=".25"><stop stop-color="#b4a07b"/><stop offset=".12" stop-color="#eee1c4"/><stop offset=".48" stop-color="#fff8e5"/><stop offset="1" stop-color="#d9c8a5"/></linearGradient>
    <linearGradient id="${id}-ceramic" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#fff9e4"/><stop offset=".3" stop-color="#f0e4c7"/><stop offset=".72" stop-color="#d6c297"/><stop offset="1" stop-color="#b89d6e"/></linearGradient>
    <linearGradient id="${id}-amber" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#f1ca87"/><stop offset=".35" stop-color="#d89b50"/><stop offset="1" stop-color="#96632f"/></linearGradient>
    <linearGradient id="${id}-leather" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b88354"/><stop offset=".5" stop-color="#8f5e37"/><stop offset="1" stop-color="#593922"/></linearGradient>
    <linearGradient id="${id}-metal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f7edce"/><stop offset=".25" stop-color="#b9b29c"/><stop offset=".5" stop-color="#eee4ca"/><stop offset="1" stop-color="#736f60"/></linearGradient>
    <filter id="${id}-shadow" x="-30%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#14291f" flood-opacity=".38"/></filter>
  </defs>`;
  const shadow = `filter="${paint("shadow")}"`;
  const drawings: Record<Artwork, string> = {
    brand: `<g transform="translate(-9 -12) scale(1.2)">
      <g ${shadow}><path d="M20 28Q34 22 48 30Q62 22 76 28V62Q62 58 48 66Q34 58 20 62Z" fill="#82572e" stroke="#c3a062"/><path d="M23 27Q36 25 48 32V60Q36 53 23 56Z" fill="${paint("paper")}" stroke="#d1bd91"/><path d="M48 32Q61 25 73 27V56Q61 53 48 60Z" fill="${paint("paper")}" stroke="#d1bd91"/><path d="M48 32V61" stroke="#877048" stroke-width="2"/><path d="M28 35Q36 34 43 38M28 41Q36 40 43 44M28 47Q36 46 43 50M54 38Q62 34 68 35M54 44Q62 40 68 41M54 50Q62 46 68 47" fill="none" stroke="#b4a07b" stroke-width="1.5"/><path d="M62 27V42L66 39L69 41V27" fill="#9a5634"/></g>
      <path d="M29 70H67" stroke="#172e23" stroke-width="4"/><path d="M29 69H67" stroke="#ba9959" stroke-width="2"/><g fill="${paint("frame")}" stroke="#76552d"><circle cx="29" cy="70" r="4"/><circle cx="48" cy="70" r="4"/><circle cx="67" cy="70" r="4"/></g><g fill="#284737"><circle cx="29" cy="70" r="1.5"/><circle cx="48" cy="70" r="1.5"/><circle cx="67" cy="70" r="1.5"/></g></g>`,
    ed: `<g ${shadow}><path d="M21 39Q21 25 35 25H68Q82 25 82 39V62Q82 74 68 74H62L49 85L51 73H35Q21 73 21 61Z" fill="#8d602f"/><path d="M21 35Q21 22 35 22H68Q82 22 82 35V58Q82 71 68 71H62L49 81L51 70H35Q21 70 21 58Z" fill="${paint("amber")}" stroke="#d2ae75"/>
      <path d="M11 27Q11 14 24 14H56Q69 14 69 27V48Q69 61 56 61H35L20 72L22 60Q11 59 11 48Z" fill="#9a8157"/><path d="M11 23Q11 10 24 10H56Q69 10 69 23V44Q69 57 56 57H35L20 68L22 56Q11 55 11 44Z" fill="${paint("ceramic")}" stroke="#dcca9e"/><path d="M17 24Q17 16 26 16H53" fill="none" stroke="#fffdf0" stroke-width="2.5" stroke-linecap="round"/><g fill="#9d875e"><circle cx="27" cy="35" r="4"/><circle cx="40" cy="35" r="4"/><circle cx="53" cy="35" r="4"/></g><g fill="#f9f1d9"><circle cx="27" cy="36" r="2.5"/><circle cx="40" cy="36" r="2.5"/><circle cx="53" cy="36" r="2.5"/></g></g>`,
    moodle: `<g ${shadow}><path d="M15 63L62 54L83 64V79L35 89L14 78Z" fill="#183b30"/><path d="M17 65L62 57L80 65L35 75Z" fill="${paint("enamel")}" stroke="#719477"/><path d="M35 75L79 66V76L35 85Z" fill="${paint("paper")}"/><path d="M39 78L75 71M39 82L75 75" stroke="#c0ad86"/><path d="M14 63L35 75V87L14 76" fill="#315c4a"/>
      <path d="M12 44L59 36L80 45V58L34 68L12 57Z" fill="#82542c"/><path d="M14 44L59 37L77 45L34 55Z" fill="${paint("amber")}" stroke="#e4bb7e"/><path d="M34 55L77 46V56L34 65Z" fill="${paint("paper")}"/><path d="M39 58L73 51M39 62L73 55" stroke="#c0ad86"/><path d="M12 44L34 55V67L12 56" fill="#ac783f"/>
      <path d="M20 25L61 18L81 28V40L39 50L20 39Z" fill="#543a26"/><path d="M20 24L61 16L81 27L39 37Z" fill="${paint("leather")}" stroke="#d1a06a"/><path d="M39 37L79 28V38L39 47Z" fill="${paint("paper")}"/><path d="M44 39L74 33M44 43L74 37" stroke="#c0ad86"/><path d="M20 24L39 37V49L20 37" fill="#8c5b36"/><path d="M25 25L39 33L75 26" fill="none" stroke="#e1b987" stroke-opacity=".6"/><path d="M52 19L59 18L73 27L73 46L68 42L65 47V29Z" fill="${paint("frame")}" stroke="#9d7940"/></g>`,
    ontrack: `<g ${shadow}><rect x="18" y="14" width="63" height="76" rx="8" fill="#18382b"/><rect x="18" y="10" width="63" height="76" rx="8" fill="${paint("enamel")}" stroke="#7d9579"/><path d="M24 27V20Q24 16 29 16H68" fill="none" stroke="#a2b292" stroke-opacity=".75"/><path d="M25 26H74V73L65 79H25Z" fill="#bdab83"/><path d="M25 23H74V70L65 76H25Z" fill="${paint("paper")}" stroke="#e9d9b7"/><path d="M65 76V68H74" fill="#dbcaab" stroke="#b8a581"/>
      <rect x="35" y="10" width="28" height="15" rx="4" fill="#77705a"/><rect x="35" y="7" width="28" height="15" rx="4" fill="${paint("metal")}" stroke="#88826b"/><rect x="43" y="5" width="12" height="7" rx="3" fill="${paint("metal")}" stroke="#88826b"/><path d="M40 16H58" stroke="#faf1d5"/>
      <g stroke="#b6a67f" fill="#eee2c7"><rect x="32" y="33" width="9" height="9" rx="1"/><rect x="32" y="49" width="9" height="9" rx="1"/><rect x="32" y="65" width="9" height="6" rx="1"/></g><path d="M33 35L37 39L43 31M33 51L37 55L43 47" fill="none" stroke="#40684e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 37H65M48 53H65M48 68H59" stroke="#b3a17a" stroke-width="2" stroke-linecap="round"/></g>`,
  };
  return `<svg class="material-art" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${defs}${drawings[kind]}</svg>`;
}
