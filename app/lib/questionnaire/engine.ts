import type { Answers, ColorsAnswer, ColorSlot, DesignInspirationAnswer, PromptData } from './types';
import { primaryQuestions, secondaryUniversal, secondaryConditional } from './data';
import type { Question } from './types';

// ── Helpers ───────────────────────────────────────────────────

function getPromptData(questionList: Question[], questionId: string, answerId: string): PromptData {
  const q = questionList.find((q) => q.id === questionId);
  if (!q || !q.options) return {};
  const opt = q.options.find((o) => o.id === answerId);
  return opt?.prompt ?? {};
}

function getOptionLabel(questionList: Question[], questionId: string, answerId: string): string {
  const q = questionList.find((q) => q.id === questionId);
  if (!q || !q.options) return answerId ?? '';
  const opt = q.options.find((o) => o.id === answerId);
  return opt ? opt.label : (answerId ?? '');
}

function pad(str: string, len: number): string {
  return str.padEnd(len, ' ');
}

function divider(): string {
  return '════════════════════════════════════════';
}

function buildColorBlock(colorsAnswer: ColorsAnswer | undefined): string | null {
  if (!colorsAnswer || colorsAnswer.noPreference) return null;
  const slots = (colorsAnswer.slots ?? []).filter((s: ColorSlot) => s.hex);
  if (slots.length === 0) return null;

  const lines: string[] = [];
  lines.push('Color palette (apply exactly — these are hard requirements):');
  slots.forEach((s: ColorSlot) => {
    lines.push('  ' + pad(s.role + ':', 12) + s.hex);
  });
  lines.push('');
  lines.push('UI color rules:');
  lines.push('  — Primary color: main CTAs, navigation active states, key interactive elements');
  lines.push('  — Secondary color: backgrounds, card surfaces, sidebar fills');
  lines.push('  — Accent color: highlights, badges, notifications, calls to attention');
  if (slots.length > 3) {
    lines.push('  — Additional colors: use as supporting tones for data visualisation or section dividers');
  }
  lines.push('  Do not introduce any other brand colors. These are the only colors in the palette.');
  return lines.join('\n');
}

// ── Primary Prompt ────────────────────────────────────────────

export function buildPrimaryPrompt(answers: Answers, companyContext?: string): string {
  const appTypeData = getPromptData(primaryQuestions, 'app_type', answers.app_type as string);
  const usersData = getPromptData(primaryQuestions, 'users', answers.users as string);
  const paymentsData = getPromptData(primaryQuestions, 'payments', answers.payments as string);
  const authData = getPromptData(primaryQuestions, 'auth_method', answers.auth_method as string);
  const context = ((answers.context as string) ?? '').trim();
  const colorsAnswer = answers.colors as ColorsAnswer | undefined;

  const lines: string[] = [];

  lines.push('You are an expert full-stack software engineer and solution architect.');
  lines.push('');

  if (companyContext?.trim()) {
    lines.push(divider());
    lines.push('YOUR COMPANY CONTEXT');
    lines.push(divider());
    lines.push('The following describes the company this tool is being built for.');
    lines.push('Use it throughout — for naming conventions, design decisions, feature scope, and UX tone.');
    lines.push('');
    lines.push(companyContext.trim());
    lines.push('');
  }

  lines.push(divider());
  lines.push("WHAT I'M BUILDING");
  lines.push(divider());

  if (context) {
    lines.push(context);
    lines.push('');
  }

  lines.push('App type:  ' + (appTypeData.archetype ?? 'Web application'));
  lines.push('');
  if (appTypeData.archetypeNotes) {
    lines.push(appTypeData.archetypeNotes);
    lines.push('');
  }

  const colorBlock = buildColorBlock(colorsAnswer);
  if (colorBlock) {
    lines.push(divider());
    lines.push('VISUAL DESIGN — COLOR PALETTE');
    lines.push(divider());
    lines.push(colorBlock);
    lines.push('');
  }

  lines.push(divider());
  lines.push('CORE REQUIREMENTS');
  lines.push(divider());

  lines.push('Target users');
  lines.push('  ' + (usersData.userScope ?? ''));
  lines.push('  ' + (usersData.authScope ?? ''));
  lines.push('');

  lines.push('Authentication');
  lines.push('  Method: ' + (authData.authMethod ?? ''));
  lines.push('  ' + (authData.authDetail ?? ''));
  lines.push('');

  const payments = paymentsData.payments ?? 'None';
  lines.push('Payments');
  lines.push('  ' + payments);
  if (paymentsData.paymentNotes && payments !== 'None') {
    lines.push('  ' + paymentsData.paymentNotes);
  }
  lines.push('');

  lines.push(divider());
  lines.push('WHAT TO BUILD — PRE-ALPHA SCAFFOLD');
  lines.push(divider());
  lines.push("Build the pre-alpha foundation of this app. This is the skeleton I'll");
  lines.push('develop on top of — focus on the core architecture, not polish.');
  lines.push('');
  lines.push('Deliver the following, in order:');
  lines.push('');
  lines.push('1. Complete project directory structure with all files listed');
  lines.push('');
  lines.push('2. package.json (or equivalent) with all core dependencies.');
  lines.push('   The dev script MUST start PGlite before the app:');
  lines.push('   "dev": "node scripts/dev-db.js & next dev"   (adjust for your framework)');
  lines.push('');
  lines.push('3. Environment files — THREE files, not one:');
  lines.push('   — .env.example      — every variable with a comment explaining each');
  lines.push('   — .env.development  — safe local defaults so the app runs immediately:');
  lines.push('       DATABASE_URL=postgresql://127.0.0.1:5433/dev');
  lines.push('       SESSION_SECRET=dev-secret-change-in-production-min-32-chars');
  lines.push('       NEXTAUTH_SECRET=dev-nextauth-secret-change-in-production');
  lines.push('       NEXTAUTH_URL=http://localhost:3000');
  lines.push('       NODE_ENV=development');
  lines.push('       (add any other required secrets with safe dev defaults)');
  lines.push('   — .env.production   — all values blank or commented (injected on deploy):');
  lines.push('       DATABASE_URL=');
  lines.push('       SESSION_SECRET=');
  lines.push('       NEXTAUTH_SECRET=');
  lines.push('       NEXTAUTH_URL=');
  lines.push('');
  lines.push('4. scripts/dev-db.js — PGlite sidecar that runs alongside the app in dev:');
  lines.push('   This file starts a PGlite PostgreSQL-in-WASM socket server on port 5433.');
  lines.push('   The app connects to it via the standard pg/Prisma/Drizzle client using');
  lines.push('   DATABASE_URL from .env.development. Zero config, no native binaries.');
  lines.push('   Example content:');
  lines.push('     import { PGlite } from "@electric-sql/pglite";');
  lines.push('     import { startSocketServer } from "@electric-sql/pglite-socket";');
  lines.push('     const db = new PGlite("memory://");');
  lines.push('     await startSocketServer({ db, port: 5433 });');
  lines.push('     console.log("PGlite ready on port 5433");');
  lines.push('');
  lines.push('5. Database schema — all tables, fields, types, and relations.');
  lines.push('   Use Prisma ORM (or Drizzle) with the DATABASE_URL connection string.');
  lines.push('   The SAME schema and queries run against PGlite in dev and Supabase in production.');
  lines.push('   Do NOT use any SQLite-specific or native-binary drivers (no better-sqlite3).');
  lines.push('');
  lines.push('6. Authentication — ' + (authData.authMethod ?? 'standard auth'));
  lines.push('   Include: sign-up, login, logout, session handling, and route protection');

  if (payments !== 'None') {
    lines.push('');
    lines.push('7. Payments — ' + payments);
    lines.push('   ' + (paymentsData.paymentNotes ?? ''));
  }

  lines.push('');
  const coreStep = payments !== 'None' ? '8' : '7';
  lines.push(`${coreStep}. Core pages and routes for the main user flow`);
  lines.push('   (the 3–5 screens a user must interact with to get value from the app)');
  if (colorBlock) {
    lines.push('   Apply the specified color palette to all UI components and pages');
  }
  lines.push('');
  const crudStep = payments !== 'None' ? '9' : '8';
  lines.push(`${crudStep}. Basic CRUD API endpoints for the core data models`);
  lines.push('');
  const readmeStep = payments !== 'None' ? '10' : '9';
  lines.push(`${readmeStep}. README.md covering:`);
  lines.push('   — Prerequisites and tech stack');
  lines.push('   — Installation steps (including: npm install @electric-sql/pglite @electric-sql/pglite-socket)');
  lines.push('   — Environment variable setup (explain the dev vs production DATABASE_URL split)');
  lines.push('   — Running locally with: npm run dev  (PGlite starts automatically)');
  lines.push('   — Deploying to production (set DATABASE_URL to Supabase connection string)');
  lines.push('');
  lines.push(divider());
  lines.push('IMPORTANT NOTES');
  lines.push(divider());
  lines.push('— Keep this lean. This is the pre-alpha foundation, not the finished product.');
  lines.push('— Do NOT add features beyond what is listed above.');
  lines.push('— Write clean, well-commented code — I will be building on top of this.');
  lines.push('— Use TypeScript where applicable.');
  lines.push('— ENV RULE: The app must start with zero errors using only .env.development values.');
  lines.push('   Every required secret (SESSION_SECRET, NEXTAUTH_SECRET, API keys, etc.) must have');
  lines.push('   a safe hardcoded dev default in .env.development. Never throw on missing env vars in dev.');
  lines.push('— DATABASE RULE: All database code must use the DATABASE_URL env var only.');
  lines.push('   Dev = PGlite on port 5433 (via scripts/dev-db.js).');
  lines.push('   Production = Supabase PostgreSQL (DATABASE_URL injected by the platform).');
  lines.push('   The app code must be identical in both environments — no environment conditionals in DB code.');
  lines.push('— Do NOT use better-sqlite3, native SQLite, or any package requiring native .node binaries.');
  if (colorBlock) {
    lines.push('— The color palette above is a hard requirement. Use only those hex values for brand colors.');
  }
  lines.push('— After this, I will send a follow-up prompt with refinements and additional features.');
  lines.push('');
  lines.push('Start with the full directory tree, then implement each section step by step.');

  return lines.join('\n');
}

// ── Refined Prompt ────────────────────────────────────────────

export function buildRefinedPrompt(
  primaryAnswers: Answers,
  secondaryAnswers: Answers,
  companyContext?: string,
): string {
  const appType = (primaryAnswers.app_type as string) ?? 'landing';
  const condList = secondaryConditional[appType] ?? [];
  const uniList = secondaryUniversal;

  const frontendData = getPromptData(uniList, 'frontend', secondaryAnswers.frontend as string);
  const backendData = getPromptData(uniList, 'backend', secondaryAnswers.backend as string);
  const databaseData = getPromptData(uniList, 'database', secondaryAnswers.database as string);
  const emailData = getPromptData(uniList, 'email', secondaryAnswers.email as string);
  const uploadsData = getPromptData(uniList, 'uploads', secondaryAnswers.uploads as string);
  const searchData = getPromptData(uniList, 'search', secondaryAnswers.search as string);
  const hostingData = getPromptData(uniList, 'hosting', secondaryAnswers.hosting as string);
  const authExtrasData = getPromptData(uniList, 'auth_extras', secondaryAnswers.auth_extras as string);
  const securityData = getPromptData(uniList, 'security', secondaryAnswers.security as string);

  const colorsAnswer = primaryAnswers.colors as ColorsAnswer | undefined;
  const colorBlock = buildColorBlock(colorsAnswer);
  const designInspiration = secondaryAnswers.design_inspiration as DesignInspirationAnswer | undefined;

  const lines: string[] = [];

  lines.push("Great — now let's refine and extend the app you just built.");
  lines.push('');
  lines.push('Paste this as your next message in the same conversation.');
  lines.push('');

  if (companyContext?.trim()) {
    lines.push(divider());
    lines.push('YOUR COMPANY CONTEXT (REMINDER)');
    lines.push(divider());
    lines.push(companyContext.trim());
    lines.push('');
  }

  lines.push(divider());
  lines.push('TECHNICAL REFINEMENTS');
  lines.push(divider());
  lines.push('Apply the following choices to the existing codebase:');
  lines.push('');

  lines.push(pad('Frontend:', 16) + (frontendData.frontend ?? ''));
  lines.push(pad('', 16) + (frontendData.frontendDetail ?? ''));
  lines.push('');

  lines.push(pad('Backend:', 16) + (backendData.backend ?? ''));
  lines.push(pad('', 16) + (backendData.backendDetail ?? ''));
  lines.push('');

  lines.push(pad('Database:', 16) + (databaseData.database ?? ''));
  lines.push(pad('', 16) + (databaseData.databaseDetail ?? ''));
  lines.push(pad('', 16) + 'Dev/preview: PGlite on port 5433 via scripts/dev-db.js (.env.development)');
  lines.push(pad('', 16) + 'Production:  Supabase PostgreSQL via DATABASE_URL (.env.production — injected on deploy)');
  lines.push(pad('', 16) + 'Same pg/Prisma/Drizzle code runs in both — only the connection string changes.');
  lines.push('');

  lines.push(pad('Email:', 16) + (emailData.email ?? 'None'));
  if (emailData.emailDetail && emailData.email !== 'None') {
    lines.push(pad('', 16) + emailData.emailDetail);
  }
  lines.push('');

  lines.push(pad('File uploads:', 16) + (uploadsData.uploads ?? 'None'));
  if (uploadsData.uploadsDetail && uploadsData.uploads !== 'None') {
    lines.push(pad('', 16) + uploadsData.uploadsDetail);
  }
  lines.push('');

  lines.push(pad('Search:', 16) + (searchData.search ?? ''));
  lines.push(pad('', 16) + (searchData.searchDetail ?? ''));
  lines.push('');

  lines.push(pad('Hosting:', 16) + (hostingData.hosting ?? ''));
  lines.push(pad('', 16) + (hostingData.hostingDetail ?? ''));
  lines.push('');

  lines.push(pad('Auth extras:', 16) + (authExtrasData.authExtras ?? ''));
  if (authExtrasData.authExtrasDetail && authExtrasData.authExtras !== 'Basic auth only') {
    lines.push(pad('', 16) + authExtrasData.authExtrasDetail);
  }
  lines.push('');

  if (securityData.security) {
    lines.push(pad('Access / Security:', 18) + securityData.security);
    if (securityData.securityDetail) lines.push(pad('', 18) + securityData.securityDetail);
    lines.push('');
  }

  if (colorBlock) {
    lines.push(divider());
    lines.push('VISUAL DESIGN — COLOR PALETTE (REMINDER)');
    lines.push(divider());
    lines.push(colorBlock);
    lines.push('Ensure all new UI components added in this refinement use the same palette.');
    lines.push('');
  }

  if (designInspiration?.brands?.length && designInspiration.content) {
    lines.push(divider());
    lines.push('VISUAL DESIGN INSPIRATION');
    lines.push(divider());
    lines.push('The following design system(s) define the visual style for this app.');
    lines.push('Use them as binding reference for component structure, spacing, typography,');
    lines.push('color usage, and interaction patterns when building all UI.');
    lines.push('');
    designInspiration.brands.forEach((brandId) => {
      const mdContent = designInspiration.content[brandId];
      if (!mdContent) return;
      lines.push('━━━ ' + brandId.toUpperCase() + ' DESIGN SYSTEM ━━━');
      lines.push('');
      lines.push(mdContent.trim());
      lines.push('');
    });
  }

  if (condList.length > 0) {
    const appTypeLabel = getOptionLabel(primaryQuestions, 'app_type', appType);
    lines.push(divider());
    lines.push(appTypeLabel.toUpperCase() + ' — SPECIFIC REQUIREMENTS');
    lines.push(divider());

    condList.forEach((q) => {
      const answerId = secondaryAnswers[q.id] as string;
      if (!answerId) return;
      const opt = q.options?.find((o) => o.id === answerId);
      if (!opt?.prompt) return;
      const p = opt.prompt;
      Object.entries(p).forEach(([key, val]) => {
        if (key.toLowerCase().endsWith('detail')) return;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
        lines.push(pad(label + ':', 20) + val);
        const detailKey = key + 'Detail';
        if (p[detailKey]) {
          lines.push(pad('', 20) + p[detailKey]);
        }
      });
      lines.push('');
    });
  }

  const customFeatures = secondaryAnswers.custom_features as string | undefined;
  if (!condList.length && customFeatures?.trim()) {
    lines.push(divider());
    lines.push('ADDITIONAL FEATURES & CUSTOM REQUIREMENTS');
    lines.push(divider());
    lines.push(customFeatures.trim());
    lines.push('');
  }

  lines.push(divider());
  lines.push('WHAT TO ADD / CHANGE');
  lines.push(divider());
  lines.push('Please update the existing codebase as follows:');
  lines.push('');

  let stepNum = 1;

  if (frontendData.frontend && !frontendData.frontend.includes('Next.js')) {
    lines.push(`${stepNum++}. Migrate the frontend to ${frontendData.frontend}`);
    lines.push('   Update component syntax, routing, and build config accordingly.');
    lines.push('');
  }

  if (backendData.backend && !backendData.backend.includes('Node')) {
    lines.push(`${stepNum++}. Migrate the backend to ${backendData.backend}`);
    lines.push('   Rewrite API routes and middleware to match the new framework.');
    lines.push('');
  }

  if (databaseData.database) {
    lines.push(`${stepNum++}. Set up ${databaseData.database} as the primary database`);
    lines.push('   Update schema, migrations, and all DB queries accordingly.');
    lines.push('   Ensure scripts/dev-db.js (PGlite sidecar) is present and the dev script starts it.');
    lines.push('   Verify .env.development points to PGlite (port 5433) and .env.production is blank.');
    lines.push('   All database code must use DATABASE_URL only — no environment conditionals in DB logic.');
    lines.push('');
  }

  if (emailData.email && emailData.email !== 'None') {
    lines.push(`${stepNum++}. Implement email sending (${emailData.email})`);
    lines.push('   Wire up emails for: auth flows, notifications, and any other relevant triggers.');
    lines.push('');
  }

  if (uploadsData.uploads && uploadsData.uploads !== 'None') {
    lines.push(`${stepNum++}. Add file upload support (${uploadsData.uploads})`);
    lines.push('   Include upload UI components, server handling, and storage integration.');
    lines.push('');
  }

  if (searchData.search) {
    lines.push(`${stepNum++}. Implement search (${searchData.search})`);
    lines.push('   Add search input, results page, and any required indexing setup.');
    lines.push('');
  }

  if (authExtrasData.authExtras && authExtrasData.authExtras !== 'Basic auth only') {
    lines.push(`${stepNum++}. Add auth extras: ${authExtrasData.authExtras}`);
    lines.push('   ' + (authExtrasData.authExtrasDetail ?? ''));
    lines.push('');
  }

  if (
    securityData.security &&
    securityData.security !== 'Publicly accessible — no access restrictions'
  ) {
    lines.push(`${stepNum++}. Implement access control: ${securityData.security}`);
    lines.push('   ' + (securityData.securityDetail ?? ''));
    lines.push('');
  }

  if (colorBlock) {
    lines.push(`${stepNum++}. Apply the color palette to all UI components`);
    lines.push('   Update all CSS variables, Tailwind config, or theme files to use the specified hex values.');
    lines.push('   Ensure the palette is applied consistently across every new and existing screen.');
    lines.push('');
  }

  if (designInspiration?.brands?.length) {
    const brandNames = designInspiration.brands
      .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
      .join(' + ');
    lines.push(`${stepNum++}. Apply the ${brandNames} design system(s) to all UI`);
    lines.push(
      '   Follow the VISUAL DESIGN INSPIRATION section above for typography, spacing, components, and motion.',
    );
    lines.push(
      "   Adapt the aesthetic — do not copy brand identity. The goal is the visual language, not the product.",
    );
    lines.push('');
  }

  if (condList.length > 0) {
    const appTypeLabel = getOptionLabel(primaryQuestions, 'app_type', appType);
    lines.push(`${stepNum++}. Implement the ${appTypeLabel}-specific features listed above`);
    lines.push('   Add the required database models, API routes, and UI components.');
    lines.push('');
  }

  if (!condList.length && customFeatures?.trim()) {
    lines.push(`${stepNum++}. Implement the additional custom features described above`);
    lines.push('');
  }

  if (hostingData.hosting) {
    lines.push(`${stepNum++}. Configure deployment for ${hostingData.hosting}`);
    lines.push('   Add/update Dockerfile, CI config, or deployment files as needed.');
    lines.push('');
  }

  lines.push(`${stepNum++}. Update the README with any new setup steps, environment variables, and services.`);
  lines.push('');

  lines.push(divider());
  lines.push('IMPORTANT NOTES');
  lines.push(divider());
  lines.push('— Build these as extensions of the existing codebase. Do not start from scratch.');
  lines.push('— Keep all existing functionality working as you add new features.');
  lines.push('— Update the database schema and run migrations for any new models.');
  lines.push('— Add new environment variables to .env.example with comments.');
  lines.push('— ENV RULE: .env.development must have safe defaults for every secret so the app');
  lines.push('   starts with zero errors after npm install. Never throw on missing env vars in dev.');
  lines.push('— DATABASE RULE: All DB code must use DATABASE_URL only.');
  lines.push('   Dev = PGlite (scripts/dev-db.js, port 5433). Production = Supabase (injected).');
  lines.push('   Do NOT use better-sqlite3 or any package requiring native .node binaries.');
  if (colorBlock) {
    lines.push('— The color palette is a hard requirement. Do not deviate from the specified hex values.');
  }
  if (designInspiration?.brands?.length) {
    lines.push(
      '— The design system files are a visual reference, not brand guidelines. Adapt the aesthetic to fit this app.',
    );
  }

  return lines.join('\n');
}
