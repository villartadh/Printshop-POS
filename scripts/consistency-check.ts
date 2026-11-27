import fs from 'node:fs';
import path from 'node:path';

interface Failure {
  check: string;
  detail: string;
}

const rootDir = process.cwd();
const failures: Failure[] = [];

function fail(check: string, detail: string) {
  failures.push({ check, detail });
}

function readJson<T>(relPath: string): T {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Required file missing: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T;
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'dev-dist' ||
      entry.name === 'coverage' ||
      entry.name === 'playwright-report' ||
      entry.name === 'test-results' ||
      entry.name === 'data'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function resolveRelativeImport(fromFile: string, specifier: string): boolean {
  const baseDir = path.dirname(fromFile);
  const direct = path.resolve(baseDir, specifier);
  const candidates = [
    direct,
    `${direct}.ts`,
    `${direct}.tsx`,
    `${direct}.js`,
    `${direct}.jsx`,
    `${direct}.json`,
    `${direct}.css`,
    path.join(direct, 'index.ts'),
    path.join(direct, 'index.tsx'),
    path.join(direct, 'index.js'),
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function run() {
  // 1. Strict TypeScript settings check
  const tsconfig = readJson<{ compilerOptions?: Record<string, unknown> }>('tsconfig.json');
  const opts = tsconfig.compilerOptions ?? {};
  const requiredCompilerFlags = [
    'strict',
    'noImplicitAny',
    'strictNullChecks',
    'noImplicitReturns',
    'useUnknownInCatchVariables',
    'noUnusedLocals',
    'noUnusedParameters',
  ];
  for (const flag of requiredCompilerFlags) {
    if (opts[flag] !== true) {
      fail('tsconfig.json', `compilerOptions.${flag} must be enabled (true).`);
    }
  }

  // 2. Lockfile synchronization check
  const pkg = readJson<{
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>('package.json');

  if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) {
    const lock = readJson<{
      packages?: Record<
        string,
        { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      >;
    }>('package-lock.json');
    const rootLock = lock.packages?.[''] ?? {};
    if (JSON.stringify(pkg.dependencies ?? {}) !== JSON.stringify(rootLock.dependencies ?? {})) {
      fail('lockfile-sync', 'package-lock.json dependencies do not match package.json.');
    }
    if (
      JSON.stringify(pkg.devDependencies ?? {}) !==
      JSON.stringify(rootLock.devDependencies ?? {})
    ) {
      fail('lockfile-sync', 'package-lock.json devDependencies do not match package.json.');
    }
  }

  // 3. Metadata, HTML & .env.example consistency check
  const metadata = readJson<{
    name?: string;
    description?: string;
    majorCapabilities?: string[];
  }>('metadata.json');
  if (!metadata.name?.trim() || !metadata.description?.trim()) {
    fail('metadata.json', 'metadata.json must define non-empty name and description.');
  }
  if (!metadata.majorCapabilities?.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API')) {
    fail(
      'metadata.json',
      'metadata.json majorCapabilities must include MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API.',
    );
  }

  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  if (metadata.name && !indexHtml.includes(`<title>${metadata.name}`)) {
    fail('index.html', `<title> should include app name "${metadata.name}".`);
  }
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(indexHtml)) {
    fail('index.html', 'index.html must include a non-empty meta description.');
  }
  if (!/<meta\s+property="og:title"\s+content="[^"]+"/i.test(indexHtml)) {
    fail('index.html', 'index.html must include an og:title meta tag.');
  }

  const envExamplePath = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    fail('.env.example', '.env.example file is missing.');
  } else {
    const envExample = fs.readFileSync(envExamplePath, 'utf8');
    if (!envExample.includes('GEMINI_API_KEY') || !envExample.includes('APP_URL')) {
      fail('.env.example', '.env.example must document GEMINI_API_KEY and APP_URL.');
    }
  }

  // 4. Relative import resolution, iFrame safety & secret hygiene across TS/TSX files
  const files = [
    ...walkTsFiles(path.join(rootDir, 'src')),
    ...walkTsFiles(path.join(rootDir, 'scripts')),
    ...walkTsFiles(path.join(rootDir, 'tests')),
    path.join(rootDir, 'server.ts'),
  ].filter((f) => fs.existsSync(f));

  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  const secretPatterns: Array<{ label: string; regex: RegExp }> = [
    { label: 'Google API key', regex: /AIzaSy[0-9A-Za-z_-]{20,}/ },
    { label: 'GitHub PAT', regex: /ghp_[0-9A-Za-z]{20,}/ },
    { label: 'Private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  ];

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, 'utf8');

    // Relative import checks
    importRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(content)) !== null) {
      const specifier = match[1];
      if (!resolveRelativeImport(file, specifier)) {
        fail('broken-import', `${rel} imports unresolved relative module "${specifier}".`);
      }
    }

    // Secret hygiene check
    for (const pat of secretPatterns) {
      if (pat.regex.test(content)) {
        fail('secret-hygiene', `${rel} contains potential hardcoded ${pat.label}.`);
      }
    }

    // iFrame safety check inside src/ (outside tests)
    if (rel.startsWith(`src${path.sep}`) && !rel.includes(`${path.sep}test${path.sep}`)) {
      if (/\bwindow\.(alert|confirm|prompt|open)\s*\(/.test(content)) {
        fail(
          'iframe-safety',
          `${rel} calls blocked browser dialog/popup API (window.alert/confirm/prompt/open).`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Consistency verification failed (${failures.length} issue(s)):`);
    for (const f of failures) {
      console.error(` - [${f.check}] ${f.detail}`);
    }
    process.exit(1);
  }

  console.log(
    `Consistency checks passed across ${files.length} TypeScript files, tsconfig.json, package lockfile, metadata.json, index.html, and .env.example.`,
  );
}

run();
