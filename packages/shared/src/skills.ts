/**
 * Static technology dictionary for the deterministic scoring formula (ADR-025
 * §6). A formula cannot know that Vue experience is close to React, or that
 * "ReactJS" and "React.js" are one thing; this table tells it.
 *
 * Keys are lower-case canonical names, the same spelling `resume-terms.ts`
 * uses, so a profile built by the fallback path and one written by the LLM end
 * up on the same keys.
 */

export interface SkillEntry {
  /** Canonical lower-case key. */
  key: string;
  /** How the skill is written on a card. */
  label: string;
  /** Other spellings that mean exactly this skill. */
  aliases?: string[];
  /**
   * The phrases searched for in a posting, when the key or an alias is also an
   * ordinary word ("go", "express", "spring"). Replaces key + aliases for text
   * search only; resolving a typed skill still uses key + aliases.
   */
  textPatterns?: string[];
  /** Adjacent technologies: experience transfers, half credit in scoring. */
  related?: string[];
}

export const SKILL_DICTIONARY: SkillEntry[] = [
  { key: 'react', label: 'React', aliases: ['react.js', 'reactjs'], related: ['next.js', 'preact', 'react native', 'remix'] },
  { key: 'next.js', label: 'Next.js', aliases: ['nextjs'], related: ['react', 'remix', 'nuxt'] },
  { key: 'remix', label: 'Remix', textPatterns: ['remix.run', 'remix framework'], related: ['react', 'next.js'] },
  { key: 'preact', label: 'Preact', related: ['react'] },
  { key: 'react native', label: 'React Native', aliases: ['react-native'], related: ['react', 'flutter'] },
  { key: 'vue', label: 'Vue', aliases: ['vue.js', 'vuejs', 'vue 3', 'vue3'], related: ['nuxt', 'react', 'svelte'] },
  { key: 'nuxt', label: 'Nuxt', aliases: ['nuxt.js', 'nuxtjs'], related: ['vue', 'next.js'] },
  { key: 'angular', label: 'Angular', aliases: ['angularjs', 'angular.js'], related: ['rxjs', 'typescript'] },
  { key: 'svelte', label: 'Svelte', aliases: ['sveltekit'], related: ['vue', 'react'] },
  { key: 'typescript', label: 'TypeScript', aliases: ['ts'], related: ['javascript'] },
  { key: 'javascript', label: 'JavaScript', aliases: ['js', 'es6', 'ecmascript'], related: ['typescript'] },
  { key: 'redux', label: 'Redux', aliases: ['redux toolkit', 'rtk', 'redux-toolkit'], related: ['zustand', 'mobx', 'redux-saga', 'tanstack query'] },
  { key: 'redux-saga', label: 'Redux-Saga', aliases: ['redux saga'], related: ['redux'] },
  { key: 'zustand', label: 'Zustand', related: ['redux', 'mobx'] },
  { key: 'mobx', label: 'MobX', related: ['redux', 'zustand'] },
  { key: 'rxjs', label: 'RxJS', related: ['angular'] },
  { key: 'tanstack query', label: 'TanStack Query', aliases: ['react query', 'react-query', 'tanstack'], related: ['redux', 'swr'] },
  { key: 'swr', label: 'SWR', related: ['tanstack query'] },
  { key: 'graphql', label: 'GraphQL', related: ['apollo', 'relay'] },
  { key: 'apollo', label: 'Apollo', aliases: ['apollo client', 'apollo server'], related: ['graphql'] },
  { key: 'relay', label: 'Relay', textPatterns: ['relay modern', 'react relay'], related: ['graphql'] },
  { key: 'webpack', label: 'Webpack', related: ['vite', 'rollup', 'esbuild'] },
  { key: 'vite', label: 'Vite', related: ['webpack', 'rollup', 'esbuild'] },
  { key: 'rollup', label: 'Rollup', related: ['vite', 'webpack'] },
  { key: 'esbuild', label: 'esbuild', related: ['vite', 'webpack'] },
  { key: 'babel', label: 'Babel', related: ['webpack'] },
  { key: 'html', label: 'HTML', aliases: ['html5'], related: ['css'] },
  { key: 'css', label: 'CSS', aliases: ['css3'], related: ['sass', 'tailwind', 'styled-components', 'html'] },
  { key: 'sass', label: 'Sass/SCSS', aliases: ['scss'], related: ['css', 'less'] },
  { key: 'less', label: 'Less', textPatterns: ['less.js', 'less css'], related: ['sass', 'css'] },
  { key: 'tailwind', label: 'Tailwind', aliases: ['tailwindcss', 'tailwind css'], related: ['css'] },
  { key: 'styled-components', label: 'styled-components', aliases: ['styled components', 'emotion', 'css-in-js'], related: ['css'] },
  { key: 'mui', label: 'MUI', aliases: ['material ui', 'material-ui'], related: ['ant design', 'chakra ui'] },
  { key: 'ant design', label: 'Ant Design', aliases: ['antd'], related: ['mui'] },
  { key: 'chakra ui', label: 'Chakra UI', related: ['mui'] },
  { key: 'storybook', label: 'Storybook' },
  { key: 'jest', label: 'Jest', related: ['vitest', 'testing library'] },
  { key: 'vitest', label: 'Vitest', related: ['jest'] },
  { key: 'testing library', label: 'Testing Library', aliases: ['react testing library'], related: ['jest', 'vitest'] },
  { key: 'cypress', label: 'Cypress', related: ['playwright'] },
  { key: 'playwright', label: 'Playwright', related: ['cypress'] },
  { key: 'micro-frontends', label: 'Micro-frontends', aliases: ['microfrontends', 'micro frontends', 'module federation'] },
  { key: 'pwa', label: 'PWA' },
  { key: 'ssr', label: 'SSR', aliases: ['server-side rendering', 'server side rendering'], related: ['next.js', 'nuxt'] },
  { key: 'websocket', label: 'WebSocket', aliases: ['websockets', 'socket.io'] },
  { key: 'webrtc', label: 'WebRTC' },
  { key: 'three.js', label: 'Three.js', aliases: ['threejs'], related: ['webgl'] },
  { key: 'webgl', label: 'WebGL', related: ['three.js'] },
  { key: 'd3', label: 'D3', aliases: ['d3.js'] },
  { key: 'figma', label: 'Figma' },
  { key: 'electron', label: 'Electron', textPatterns: ['electron.js', 'electronjs', 'electron app'] },
  { key: 'flutter', label: 'Flutter', related: ['dart', 'react native'] },
  { key: 'dart', label: 'Dart', related: ['flutter'] },
  { key: 'node.js', label: 'Node.js', aliases: ['nodejs', 'node'], related: ['nestjs', 'express'] },
  { key: 'nestjs', label: 'NestJS', aliases: ['nest.js'], related: ['node.js', 'express'] },
  { key: 'express', label: 'Express', aliases: ['express.js', 'expressjs'], textPatterns: ['express.js', 'expressjs', 'express framework'], related: ['node.js', 'nestjs'] },
  { key: 'deno', label: 'Deno', related: ['node.js'] },
  { key: 'bun', label: 'Bun', textPatterns: ['bun.sh', 'bun runtime'], related: ['node.js'] },
  { key: 'python', label: 'Python', related: ['django', 'fastapi', 'flask'] },
  { key: 'django', label: 'Django', related: ['python', 'fastapi', 'flask'] },
  { key: 'flask', label: 'Flask', related: ['python', 'fastapi', 'django'] },
  { key: 'fastapi', label: 'FastAPI', related: ['python', 'flask', 'django'] },
  { key: 'java', label: 'Java', related: ['kotlin', 'spring'] },
  { key: 'spring', label: 'Spring', aliases: ['spring boot'], textPatterns: ['spring boot', 'spring framework', 'spring cloud'], related: ['java', 'kotlin'] },
  { key: 'kotlin', label: 'Kotlin', related: ['java'] },
  { key: 'swift', label: 'Swift', related: ['objective-c'] },
  { key: 'objective-c', label: 'Objective-C', related: ['swift'] },
  { key: 'go', label: 'Go', aliases: ['golang'], textPatterns: ['golang', 'go developer', 'go engineer'] },
  { key: 'rust', label: 'Rust' },
  { key: 'c#', label: 'C#', related: ['.net'] },
  { key: '.net', label: '.NET', aliases: ['dotnet', 'asp.net'], related: ['c#'] },
  { key: 'php', label: 'PHP', related: ['laravel', 'symfony'] },
  { key: 'laravel', label: 'Laravel', related: ['php', 'symfony'] },
  { key: 'symfony', label: 'Symfony', related: ['php', 'laravel'] },
  { key: 'ruby', label: 'Ruby', related: ['rails'] },
  { key: 'rails', label: 'Ruby on Rails', aliases: ['ruby on rails', 'ror'], textPatterns: ['ruby on rails', 'rails'], related: ['ruby'] },
  { key: 'elixir', label: 'Elixir' },
  { key: 'scala', label: 'Scala', related: ['java'] },
  { key: 'sql', label: 'SQL', related: ['postgresql', 'mysql'] },
  { key: 'postgresql', label: 'PostgreSQL', aliases: ['postgres'], related: ['mysql', 'sql'] },
  { key: 'mysql', label: 'MySQL', related: ['postgresql', 'sql'] },
  { key: 'mongodb', label: 'MongoDB', aliases: ['mongo'] },
  { key: 'redis', label: 'Redis' },
  { key: 'elasticsearch', label: 'Elasticsearch' },
  { key: 'kafka', label: 'Kafka', related: ['rabbitmq'] },
  { key: 'rabbitmq', label: 'RabbitMQ', related: ['kafka'] },
  { key: 'docker', label: 'Docker', related: ['kubernetes'] },
  { key: 'kubernetes', label: 'Kubernetes', aliases: ['k8s'], related: ['docker'] },
  { key: 'terraform', label: 'Terraform', related: ['ansible'] },
  { key: 'ansible', label: 'Ansible', related: ['terraform'] },
  { key: 'aws', label: 'AWS', related: ['gcp', 'azure'] },
  { key: 'gcp', label: 'GCP', aliases: ['google cloud'], related: ['aws', 'azure'] },
  { key: 'azure', label: 'Azure', related: ['aws', 'gcp'] },
  { key: 'ci/cd', label: 'CI/CD', related: ['github actions', 'jenkins'] },
  { key: 'github actions', label: 'GitHub Actions', related: ['ci/cd'] },
  { key: 'jenkins', label: 'Jenkins', related: ['ci/cd'] },
  { key: 'tensorflow', label: 'TensorFlow', related: ['pytorch'] },
  { key: 'pytorch', label: 'PyTorch', related: ['tensorflow'] },
];

const BY_KEY = new Map(SKILL_DICTIONARY.map((entry) => [entry.key, entry]));
const BY_SPELLING = new Map<string, SkillEntry>();
for (const entry of SKILL_DICTIONARY) {
  for (const spelling of [entry.key, ...(entry.aliases ?? [])]) BY_SPELLING.set(spelling, entry);
}

/** Lower-cased, inner whitespace collapsed — the form spellings are looked up in. */
export function normalizeSkillName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The canonical key of a skill however it was written ("ReactJS" → "react"),
 * or the normalized name itself when the dictionary does not know it — a skill
 * outside the table still matches literally, it just has no neighbours.
 */
export function canonicalSkill(raw: string): string {
  const name = normalizeSkillName(raw);
  return BY_SPELLING.get(name)?.key ?? name;
}

export function skillEntry(key: string): SkillEntry | undefined {
  return BY_KEY.get(key);
}

/** The card label for a key: the dictionary's spelling, else the key as given. */
export function skillLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/**
 * Adjacent technologies, symmetric: a relation stated on either entry counts
 * for both, so the table never has to repeat itself to stay consistent.
 */
export function relatedSkills(key: string): string[] {
  const out = new Set(BY_KEY.get(key)?.related ?? []);
  for (const entry of SKILL_DICTIONARY) {
    if (entry.related?.includes(key)) out.add(entry.key);
  }
  out.delete(key);
  return [...out];
}

/** The phrases that mean `key` in a posting's text. */
export function skillTextPatterns(key: string): string[] {
  const entry = BY_KEY.get(key);
  if (!entry) return [key];
  return entry.textPatterns ?? [entry.key, ...(entry.aliases ?? [])];
}
