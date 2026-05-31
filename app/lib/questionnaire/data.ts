import type { Question } from './types';

export const primaryQuestions: Question[] = [
  {
    id: 'app_type',
    label: 'What kind of app?',
    description: 'This shapes the entire architecture and feature set.',
    options: [
      {
        id: 'crm',
        label: 'CRM / Forecast Tools',
        description: 'Sales forecasting, customer tracking, pipeline management',
        prompt: {
          archetype: 'CRM / Sales Forecasting platform',
          archetypeNotes:
            'Customer relationship management with contact records, deal pipeline, activity logging, and revenue forecasting. Role-based views for sales reps and managers. Reporting and target tracking built in.',
        },
      },
      {
        id: 'inventory',
        label: 'Inventory Management',
        description: 'Product and stock tracking for physical or digital goods',
        prompt: {
          archetype: 'Inventory Management system',
          archetypeNotes:
            'Stock-level tracking with product catalogue, quantity management, low-stock alerts, and reorder workflows. Supports physical products, raw materials, and digital stock. Audit trail on all stock movements.',
        },
      },
      {
        id: 'hr',
        label: 'HR App',
        description: 'Timesheets, leave, expenses, and payroll for your team',
        prompt: {
          archetype: 'HR management application',
          archetypeNotes:
            'Staff-facing HR platform. Timesheet submission and approval, leave request management, expense claims with receipt upload, and payroll summary. Manager approval flows and admin oversight panel.',
        },
      },
      {
        id: 'appointment',
        label: 'Appointment App',
        description: 'Booking system, timetables, and scheduling',
        prompt: {
          archetype: 'Appointment / scheduling application',
          archetypeNotes:
            'Calendar-based booking with configurable availability, time-slot management, booking confirmations, and reminders. Supports self-service booking by customers or staff-managed scheduling. Calendar sync integration.',
        },
      },
      {
        id: 'knowledge',
        label: 'Knowledge Hub',
        description: 'Dashboards, document sharing, and internal wikis',
        prompt: {
          archetype: 'Knowledge hub / document portal',
          archetypeNotes:
            'Centralised content platform for sharing documents, guides, and dashboards. Category-based organisation with full-text search. Role-based access to control who can view or edit content. Version history on documents.',
        },
      },
      {
        id: 'landing',
        label: 'Landing Page / Blog',
        description: 'Portfolio, business website, or content blog',
        prompt: {
          archetype: 'Landing page / marketing website',
          archetypeNotes:
            'Public-facing website with static or CMS-managed content. SEO-optimised pages, blog or news section, contact/lead capture forms, and clear calls to action. Fast load times and mobile-first design.',
        },
      },
    ],
  },
  {
    id: 'users',
    label: 'Who uses it?',
    description: 'Shapes who can sign up and how they access your app.',
    options: [
      {
        id: 'customers',
        label: 'My customers',
        description: 'External users — anyone can sign up and access it',
        prompt: {
          userScope: 'External customers (public-facing)',
          authScope:
            'Public signup flow with email verification. OAuth social login support. Password reset. CDN and edge deployment for performance. SEO-optimised frontend.',
        },
      },
      {
        id: 'team',
        label: 'My team',
        description: 'Internal only — employees and partners, no public signup',
        prompt: {
          userScope: 'Internal team / staff only',
          authScope:
            'No public signup. Invite-only or company email domain restriction. SSO-ready. Admin-controlled user creation. Admin-focused UI, no SEO requirement.',
        },
      },
      {
        id: 'both',
        label: 'Both',
        description: 'Your team manages it; customers or clients use it too',
        prompt: {
          userScope: 'Both internal staff and external customers',
          authScope:
            'Dual auth flows: invite-only or SSO for staff (admin panel), OAuth + email signup for customers (public-facing app). Role-based routing to separate interfaces.',
        },
      },
    ],
  },
  {
    id: 'colors',
    type: 'color',
    label: 'Choose your color palette',
    description: 'Pick colors that represent your app. Click a card to browse the grid or enter an exact hex code.',
  },
  {
    id: 'context',
    type: 'fillblanks',
    label: 'Tell us about your app',
    description: 'Fill in the blanks — click each highlighted word to choose, or type your own.',
    templates: {
      crm: {
        parts: ["I'm building a CRM for ", ' businesses, to help their ', ' sales team ', '.'],
        blanks: [
          {
            id: 'industry',
            options: [
              'real estate',
              'retail',
              'finance',
              'healthcare',
              'tech',
              'logistics',
              'hospitality',
              'e-commerce',
              'construction',
            ],
          },
          { id: 'team_size', options: ['small', 'growing', 'large', 'remote', 'multi-location'] },
          {
            id: 'goal',
            options: [
              'manage their pipeline',
              'track customers',
              'forecast revenue',
              'close more deals',
              'organise contacts',
              'improve follow-ups',
            ],
          },
        ],
      },
      inventory: {
        parts: ["I'm building an inventory system for ", ' to track ', ' across ', '.'],
        blanks: [
          {
            id: 'business_type',
            options: [
              'a retail store',
              'a warehouse',
              'a restaurant',
              'a manufacturer',
              'an e-commerce business',
              'a pharmacy',
              'a supplier',
            ],
          },
          {
            id: 'stock_type',
            options: [
              'physical products',
              'raw materials',
              'ingredients',
              'digital licenses',
              'equipment',
              'spare parts',
            ],
          },
          {
            id: 'locations',
            options: ['one location', 'multiple warehouses', 'online and physical stores', 'multiple branches'],
          },
        ],
      },
      hr: {
        parts: ["I'm building an HR app for a ", ' ', ' company to help manage ', '.'],
        blanks: [
          { id: 'company_size', options: ['small', 'growing', 'mid-sized', 'large'] },
          {
            id: 'industry',
            options: [
              'retail',
              'tech',
              'hospitality',
              'healthcare',
              'construction',
              'logistics',
              'financial',
              'manufacturing',
            ],
          },
          {
            id: 'scope',
            options: [
              'timesheets and leave',
              'expenses and payroll',
              'all HR tasks',
              'attendance and scheduling',
              'employee onboarding',
            ],
          },
        ],
      },
      appointment: {
        parts: ["I'm building a booking app for ", ' where ', ' can schedule ', '.'],
        blanks: [
          {
            id: 'business_type',
            options: [
              'a salon',
              'a clinic',
              'a consultancy',
              'a fitness studio',
              'a repair service',
              'a coaching business',
              'a dental practice',
            ],
          },
          { id: 'booker', options: ['customers', 'staff', 'both customers and staff'] },
          {
            id: 'service_type',
            options: ['appointments', 'classes and sessions', 'consultations', 'treatments', 'meetings', 'home visits'],
          },
        ],
      },
      knowledge: {
        parts: ["I'm building a knowledge hub for ", ' to share ', ' about ', '.'],
        blanks: [
          {
            id: 'audience',
            options: ['our internal team', 'our company', 'our clients', 'our partners', 'the public'],
          },
          {
            id: 'content_type',
            options: [
              'documents and guides',
              'training materials',
              'policies and procedures',
              'product knowledge',
              'video tutorials',
              'FAQs and wikis',
            ],
          },
          {
            id: 'topic',
            options: [
              'our products',
              'our services',
              'company processes',
              'technical documentation',
              'onboarding materials',
            ],
          },
        ],
      },
      landing: {
        parts: ["I'm building a ", ' for ', ' to ', '.'],
        blanks: [
          {
            id: 'site_type',
            options: [
              'business website',
              'portfolio',
              'blog',
              'landing page',
              'product showcase',
              'personal brand site',
            ],
          },
          {
            id: 'business_type',
            options: [
              'a freelancer',
              'a startup',
              'a local business',
              'an agency',
              'a personal brand',
              'a non-profit',
              'a consultancy',
            ],
          },
          {
            id: 'goal',
            options: [
              'showcase our work',
              'attract new clients',
              'share our story',
              'generate leads',
              'promote a product',
              'build an audience',
            ],
          },
        ],
      },
    },
  },
];

export const secondaryUniversal: Question[] = [
  {
    id: 'frontend',
    label: 'Which interface framework?',
    description: 'The toolkit used to build the part of your app that users see and click on.',
    options: [
      {
        id: 'react',
        label: 'React',
        description: 'Most popular choice — works for any project, huge community',
        prompt: {
          frontend: 'React + Next.js (App Router)',
          frontendDetail:
            'Next.js with React Server Components, App Router, and TailwindCSS. File-based routing. Excellent for both static and dynamic apps.',
        },
      },
      {
        id: 'vue',
        label: 'Vue',
        description: 'Clean and approachable — great developer experience',
        prompt: {
          frontend: 'Vue 3 + Nuxt.js',
          frontendDetail:
            'Nuxt.js with Vue 3 Composition API and TailwindCSS. File-based routing and SSR. Approachable syntax.',
        },
      },
      {
        id: 'svelte',
        label: 'Svelte',
        description: 'Lightweight and fast — compiles to minimal code',
        prompt: {
          frontend: 'Svelte + SvelteKit',
          frontendDetail:
            'SvelteKit with Svelte 5 and TailwindCSS. Compiled output, no virtual DOM overhead. Very lean bundles.',
        },
      },
      {
        id: 'nopref',
        label: 'No preference',
        description: 'Let the AI choose what fits the project best',
        prompt: {
          frontend: 'React + Next.js (recommended default)',
          frontendDetail: 'Next.js chosen as default for ecosystem size, deployment options, and community support.',
        },
      },
    ],
  },
  {
    id: 'backend',
    label: 'Which server language?',
    description: "The programming language that runs your app's logic and data behind the scenes.",
    options: [
      {
        id: 'node',
        label: 'Node.js',
        description: 'JavaScript on the server — same language as the interface layer',
        prompt: {
          backend: 'Node.js + Express / Fastify',
          backendDetail:
            'Node.js with Express (or Fastify for performance). REST API with JSON. Shared TypeScript types with frontend.',
        },
      },
      {
        id: 'python',
        label: 'Python',
        description: 'Readable and versatile — great for data-heavy or AI-powered apps',
        prompt: {
          backend: 'Python + FastAPI',
          backendDetail:
            'FastAPI with async support, automatic OpenAPI docs, and Pydantic validation. Or Django for a batteries-included approach with Django REST Framework.',
        },
      },
      {
        id: 'ruby',
        label: 'Ruby',
        description: 'Fast to build with — convention-driven, popular with startups',
        prompt: {
          backend: 'Ruby on Rails',
          backendDetail:
            'Rails 7+ in API mode. Convention-over-configuration, built-in ActiveRecord ORM, and rapid scaffolding.',
        },
      },
      {
        id: 'go',
        label: 'Go',
        description: 'Fast and lean — built for high-performance, high-traffic systems',
        prompt: {
          backend: 'Go + Gin / Echo',
          backendDetail:
            'Go with Gin or Echo framework. Statically compiled, very fast, low memory footprint. Great for high-concurrency APIs.',
        },
      },
      {
        id: 'nopref',
        label: 'No preference',
        description: 'Let the AI choose what pairs best with the stack',
        prompt: {
          backend: 'Node.js + Express (recommended default)',
          backendDetail: 'Node.js chosen as default for seamless full-stack JavaScript development.',
        },
      },
    ],
  },
  {
    id: 'database',
    label: 'How is your data structured?',
    description: 'Shapes how your app stores and retrieves information.',
    options: [
      {
        id: 'structured',
        label: 'Fixed — like connected spreadsheets',
        description: 'Records have consistent fields and link to each other in defined ways',
        prompt: {
          database: 'PostgreSQL via Supabase',
          databaseDetail:
            'Supabase PostgreSQL for production with Prisma ORM. PGlite (@electric-sql/pglite) for local dev and WebContainer preview — identical SQL queries, no native binaries, zero config. Connection string swapped via DATABASE_URL in .env.development vs .env.production.',
        },
      },
      {
        id: 'flexible',
        label: 'Flexible — data varies between records',
        description: "Fields change often or records don't all look the same",
        prompt: {
          database: 'PostgreSQL with JSONB via Supabase',
          databaseDetail:
            'Supabase PostgreSQL with JSONB columns for flexible, schema-less data within typed tables. PGlite for local dev and WebContainer preview. Gives MongoDB-style flexibility on a real relational database — no migration headaches, full SQL power.',
        },
      },
      {
        id: 'simple',
        label: 'Simple — just basic storage',
        description: 'Small project with straightforward storage needs',
        prompt: {
          database: 'PostgreSQL via Supabase (lightweight)',
          databaseDetail:
            'Supabase PostgreSQL for production. PGlite for local dev and WebContainer preview — in-memory, zero install, no native binaries. Same standard pg/Prisma queries work in both environments via DATABASE_URL env var swap.',
        },
      },
      {
        id: 'notsure',
        label: 'Not sure — pick a solid default',
        description: 'Give me whatever works reliably for most apps',
        prompt: {
          database: 'PostgreSQL via Supabase (recommended default)',
          databaseDetail:
            'Supabase PostgreSQL for production — real SQL, Supabase Studio for data editing, built-in auth and storage. PGlite (@electric-sql/pglite) for local dev and WebContainer preview. Industry-standard choice: full ownership, no lock-in, works everywhere.',
        },
      },
    ],
  },
  {
    id: 'email',
    label: 'Need to send emails?',
    description: 'Choose how your app sends emails to users.',
    options: [
      {
        id: 'no',
        label: 'No',
        description: 'No emails at all',
        prompt: { email: 'None', emailDetail: 'No email infrastructure. Do not include any email provider.' },
      },
      {
        id: 'basics',
        label: 'Just basics',
        description: 'Password resets, confirmations, welcome emails',
        prompt: {
          email: 'Resend (transactional)',
          emailDetail:
            'Resend for transactional emails: verification, password reset, welcome. Simple API, excellent deliverability, generous free tier.',
        },
      },
      {
        id: 'marketing',
        label: 'Basics + marketing',
        description: 'Transactional + product updates and promotions',
        prompt: {
          email: 'SendGrid (transactional + marketing)',
          emailDetail:
            'SendGrid for both transactional and marketing emails. List management, templates, open/click tracking.',
        },
      },
      {
        id: 'full',
        label: 'Full email platform',
        description: 'Newsletters, drip campaigns, automation sequences',
        prompt: {
          email: 'SendGrid + queue system',
          emailDetail:
            'SendGrid with a job queue (BullMQ) for drip campaigns, scheduled sequences, and high-volume newsletters. Full unsubscribe management and list segmentation.',
        },
      },
    ],
  },
  {
    id: 'uploads',
    label: 'Will users upload files?',
    description: 'Choose how uploaded files are stored and delivered.',
    options: [
      {
        id: 'no',
        label: 'No',
        description: 'No file uploads needed',
        prompt: {
          uploads: 'None',
          uploadsDetail: 'No file storage infrastructure. Do not include S3, Cloudinary, or any upload handling.',
        },
      },
      {
        id: 'images',
        label: 'Images only',
        description: 'Profile photos, product images, avatars',
        prompt: {
          uploads: 'Cloudinary (image storage + CDN)',
          uploadsDetail:
            'Cloudinary for image upload, optimisation, transformation, and CDN delivery. Client SDK for direct upload. Auto-resize and format conversion.',
        },
      },
      {
        id: 'documents',
        label: 'Documents',
        description: 'PDFs, spreadsheets, Word docs, etc.',
        prompt: {
          uploads: 'AWS S3 (document storage)',
          uploadsDetail:
            'AWS S3 for secure document storage. Pre-signed URLs for direct client upload. Per-user or per-resource access control. Virus scan hook optional.',
        },
      },
      {
        id: 'mixed',
        label: 'Mixed media',
        description: 'Images, videos, documents, and other files',
        prompt: {
          uploads: 'AWS S3 + CDN + processing pipeline',
          uploadsDetail:
            'S3 for storage, CloudFront CDN for delivery. Background processing jobs for video transcoding and image resizing. Chunked upload support for large files.',
        },
      },
    ],
  },
  {
    id: 'search',
    label: 'How will users find things?',
    description: 'From simple filtering to full-text and faceted search.',
    options: [
      {
        id: 'filters',
        label: 'Browse and filter',
        description: 'Dropdown filters, sort by date / price / category',
        prompt: {
          search: 'Database query filters',
          searchDetail:
            'Standard SQL/NoSQL query filters with sorting. No dedicated search engine. Filter state persisted in URL params.',
        },
      },
      {
        id: 'keyword',
        label: 'Search by keyword',
        description: 'Text search across titles, descriptions, tags',
        prompt: {
          search: 'Full-text search (PostgreSQL tsvector or MongoDB Atlas Search)',
          searchDetail:
            'Native database full-text search. Ranked results, stemming, and basic relevance scoring. No external search service needed.',
        },
      },
      {
        id: 'advanced',
        label: 'Smart search with autocomplete',
        description: 'Faceted filters, geo, autocomplete, fuzzy matching',
        prompt: {
          search: 'Meilisearch (dedicated search engine)',
          searchDetail:
            'Meilisearch for fast, typo-tolerant full-text search with faceted filters, geo search, and autocomplete. Synced from primary database via webhooks or queue.',
        },
      },
    ],
  },
  {
    id: 'hosting',
    label: 'Hosting preference?',
    description: 'Trade off between simplicity and control.',
    options: [
      {
        id: 'easy',
        label: 'Easy & automatic',
        description: 'Deploy with git push — no DevOps needed',
        prompt: {
          hosting: 'Vercel (frontend) + Railway (backend + DB)',
          hostingDetail:
            'Vercel for frontend with global CDN and preview deploys. Railway for backend API and managed database. Automatic deployments from GitHub.',
        },
      },
      {
        id: 'balanced',
        label: 'More control, less automation',
        description: 'More flexibility without managing full infrastructure',
        prompt: {
          hosting: 'Railway or Render (full stack)',
          hostingDetail:
            'Railway or Render for full-stack hosting. Docker-based deploys, managed databases, easy horizontal scaling, straightforward pricing.',
        },
      },
      {
        id: 'control',
        label: 'Full control',
        description: 'I want full infrastructure ownership (AWS, GCP, etc.)',
        prompt: {
          hosting: 'AWS / GCP (full cloud)',
          hostingDetail:
            'AWS (EC2 + RDS + S3 + CloudFront) or GCP equivalent. Terraform or AWS CDK for infrastructure as code. Full control over scaling, security groups, and configuration.',
        },
      },
      {
        id: 'nopref',
        label: 'No preference',
        description: 'Recommend whatever pairs best with the stack',
        prompt: {
          hosting: 'Vercel + Railway (recommended defaults)',
          hostingDetail:
            'Vercel + Railway chosen as sensible defaults — easy to use, generous free tiers, excellent developer experience.',
        },
      },
    ],
  },
  {
    id: 'auth_extras',
    label: 'How should user accounts work?',
    description: 'Beyond basic sign-in and sign-out.',
    options: [
      {
        id: 'none',
        label: 'No — basics are fine',
        description: 'Just sign up, log in, log out',
        prompt: {
          authExtras: 'Basic auth only',
          authExtrasDetail: 'Standard sign-up, login, logout, and session management. No advanced auth features.',
        },
      },
      {
        id: 'twofa',
        label: 'Add 2FA',
        description: 'Two-factor authentication via authenticator app',
        prompt: {
          authExtras: '2FA (TOTP)',
          authExtrasDetail:
            'TOTP-based two-factor auth (compatible with Google Authenticator / Authy). QR code setup flow, backup recovery codes, and 2FA enforcement option.',
        },
      },
      {
        id: 'multisign',
        label: 'Link multiple sign-in methods',
        description: 'Users can connect email + social to one account',
        prompt: {
          authExtras: 'Multi-provider account linking',
          authExtrasDetail:
            'Users can link multiple sign-in methods (email, Google, GitHub) to a single account. Account merge and unlink flows included.',
        },
      },
      {
        id: 'teams',
        label: 'Team management & invites',
        description: 'Workspaces, member invites, roles per team',
        prompt: {
          authExtras: 'Team / workspace management + RBAC',
          authExtrasDetail:
            'Organisation or workspace model. Owner invites members via email. Role-based access control (Owner, Admin, Member). Accept/decline invite flow. Member removal and role change.',
        },
      },
    ],
  },
  {
    id: 'security',
    label: 'Who should be able to access your app?',
    description: 'This controls how your app is protected and who can reach it',
    options: [
      {
        id: 'open',
        label: 'Open to everyone',
        description: 'Anyone on the internet can visit without signing in',
        prompt: {
          security: 'Publicly accessible — no access restrictions',
          securityDetail:
            'No IP restrictions or VPN required. HTTPS enforced. Standard rate limiting on API routes. No additional firewall rules needed.',
        },
      },
      {
        id: 'login',
        label: 'Login required',
        description: 'Users must create an account or sign in to see anything',
        prompt: {
          security: 'Authentication wall — login required to access any page',
          securityDetail:
            'All routes protected behind authentication middleware. Unauthenticated requests redirected to login. Session-based or JWT access control enforced throughout.',
        },
      },
      {
        id: 'team',
        label: 'Team or company only',
        description: 'Restricted to specific people you invite or approve',
        prompt: {
          security: 'Invite-only / company-restricted access',
          securityDetail:
            'No public signup. Invite-only or company email domain restriction. Admin controls user creation and removal. All routes require authenticated session with role check.',
        },
      },
      {
        id: 'strict',
        label: 'Extra security layer',
        description: 'Restrict access to specific locations, devices, or networks',
        prompt: {
          security: 'Strict access control — IP whitelist or VPN',
          securityDetail:
            'IP whitelist firewall rules at hosting/CDN level. Optional VPN-only access. Rate limiting, brute-force protection, and audit logging on all access events.',
        },
      },
    ],
  },
  {
    id: 'design_inspiration',
    type: 'designInspiration',
    label: 'Any brands that inspire your design?',
    description: 'Optional — pick up to 2. Their full design systems get added to your prompt.',
    maxSelect: 2,
    brands: [
      { id: 'apple', label: 'Apple', tagline: 'Minimalist & premium' },
      { id: 'airbnb', label: 'Airbnb', tagline: 'Warm & human' },
      { id: 'stripe', label: 'Stripe', tagline: 'Professional & trustworthy' },
      { id: 'notion', label: 'Notion', tagline: 'Document-first & structured' },
      { id: 'linear', label: 'Linear', tagline: 'Dark, dense & precise' },
      { id: 'figma', label: 'Figma', tagline: 'Creative & colorful' },
      { id: 'spotify', label: 'Spotify', tagline: 'Bold & expressive' },
      { id: 'framer', label: 'Framer', tagline: 'Motion-rich & modern' },
      { id: 'raycast', label: 'Raycast', tagline: 'Focused & keyboard-first' },
      { id: 'supabase', label: 'Supabase', tagline: 'Dashboard & data-rich' },
    ],
  },
];

export const secondaryConditional: Record<string, Question[]> = {
  crm: [
    {
      id: 'crm_focus',
      label: 'What do you mainly need to manage?',
      description: 'Choose the core purpose of your CRM',
      options: [
        {
          id: 'contacts',
          label: 'Customers & contacts',
          description: 'Keep track of who your clients are and their details',
          prompt: {
            crmFocus: 'Contact management',
            crmFocusDetail:
              'Contact records with full history — calls, emails, meetings, notes. Company and person records linked. Import from CSV. Search and filter by tag, status, or owner.',
          },
        },
        {
          id: 'pipeline',
          label: 'Sales pipeline',
          description: 'Track deals from first contact through to closed sale',
          prompt: {
            crmFocus: 'Sales pipeline tracking',
            crmFocusDetail:
              'Kanban-style deal pipeline with configurable stages (Lead, Qualified, Proposal, Won/Lost). Deal value, probability, and expected close date per card. Stage history and activity log.',
          },
        },
        {
          id: 'forecast',
          label: 'Revenue forecasting',
          description: 'Predict future income based on your pipeline and history',
          prompt: {
            crmFocus: 'Revenue forecasting',
            crmFocusDetail:
              'Forecast dashboard aggregating pipeline value by stage probability. Monthly and quarterly projections. Actuals vs. target comparison. Drill-down by rep or product line.',
          },
        },
        {
          id: 'all',
          label: 'All of the above',
          description: 'A full CRM — contacts, pipeline, and forecast reports',
          prompt: {
            crmFocus: 'Full CRM — contacts + pipeline + forecasting',
            crmFocusDetail:
              'Complete CRM platform. Contact and company records, deal pipeline with stage management, activity logging, and revenue forecasting dashboard. Unified view across all modules.',
          },
        },
      ],
    },
    {
      id: 'crm_team',
      label: 'How does your team use it?',
      description: 'This shapes the access levels and workflow setup',
      options: [
        {
          id: 'solo',
          label: 'Just me',
          description: 'I manage everything myself — no other users',
          prompt: {
            crmTeam: 'Single user — no team collaboration',
            crmTeamDetail:
              'Single-user mode. No team management or assignment features needed. Simplified UI focused on personal workflow.',
          },
        },
        {
          id: 'small',
          label: 'Small team',
          description: 'A few people share access and update records',
          prompt: {
            crmTeam: 'Small team — shared access',
            crmTeamDetail:
              'Multiple users share one workspace. Records show who last updated them. Basic activity feed. No complex hierarchy needed.',
          },
        },
        {
          id: 'managed',
          label: 'Manager + sales reps',
          description: 'Managers assign tasks to reps and review their work',
          prompt: {
            crmTeam: 'Manager + rep hierarchy',
            crmTeamDetail:
              "Manager role sees all reps' records and targets. Sales rep role sees only assigned contacts and deals. Manager can reassign and override. Rep performance dashboard for managers.",
          },
        },
        {
          id: 'departments',
          label: 'Multiple departments',
          description: 'Different teams (sales, support) with their own sections',
          prompt: {
            crmTeam: 'Multi-department — segmented access',
            crmTeamDetail:
              'Department-level data segmentation. Each team has its own contacts, pipelines, and reports. Cross-department visibility controlled by role. Admin sees all departments.',
          },
        },
      ],
    },
    {
      id: 'crm_reports',
      label: 'What reports matter most to you?',
      description: 'This determines which dashboards and metrics are built',
      options: [
        {
          id: 'sales',
          label: 'Sales performance',
          description: 'Who is closing deals and hitting targets',
          prompt: {
            crmReports: 'Sales performance dashboard',
            crmReportsDetail:
              'Per-rep deal count, revenue closed, win rate, and target attainment. Leaderboard view. Filter by date range and team.',
          },
        },
        {
          id: 'revenue',
          label: 'Revenue forecast',
          description: 'What income to expect over the next weeks or months',
          prompt: {
            crmReports: 'Revenue forecast report',
            crmReportsDetail:
              'Pipeline-weighted revenue projection by month and quarter. Actuals vs. forecast chart. Stage-by-stage conversion funnel.',
          },
        },
        {
          id: 'activity',
          label: 'Team activity',
          description: 'Calls made, emails sent, meetings held by each rep',
          prompt: {
            crmReports: 'Activity tracking report',
            crmReportsDetail:
              'Per-user activity log: calls, emails, tasks completed, and meetings. Daily and weekly activity summaries. Manager view across full team.',
          },
        },
        {
          id: 'pipeline',
          label: 'Pipeline overview',
          description: 'A summary of all open deals and their current stage',
          prompt: {
            crmReports: 'Pipeline overview report',
            crmReportsDetail:
              'Total open deal value by stage. Average time in stage. Stale deal alerts. Pipeline health score. Filter by owner, team, and date.',
          },
        },
      ],
    },
  ],
  inventory: [
    {
      id: 'inv_type',
      label: 'What are you keeping track of?',
      description: 'This shapes the structure of your product catalogue',
      options: [
        {
          id: 'physical',
          label: 'Physical products',
          description: 'Items stored in a warehouse, shop, or location',
          prompt: {
            invType: 'Physical product inventory',
            invTypeDetail:
              'Product catalogue with SKU, name, description, quantity on hand, location, and cost price. Multi-location support optional. Stock movement log on every change.',
          },
        },
        {
          id: 'materials',
          label: 'Raw materials or ingredients',
          description: 'Components or ingredients used to make your products',
          prompt: {
            invType: 'Raw materials / component inventory',
            invTypeDetail:
              'Material catalogue with unit of measure, current stock, minimum threshold, and supplier link. Bill of materials support to track consumption per finished product.',
          },
        },
        {
          id: 'digital',
          label: 'Digital stock',
          description: 'Licenses, vouchers, or digital items with a limited quantity',
          prompt: {
            invType: 'Digital stock inventory',
            invTypeDetail:
              'Digital item tracking with quantity, serial or license key management, and instant delivery on fulfillment. No physical location needed.',
          },
        },
        {
          id: 'mixed',
          label: 'A mix of all types',
          description: 'Physical products, materials, and digital items together',
          prompt: {
            invType: 'Mixed inventory — physical, materials, digital',
            invTypeDetail:
              'Unified catalogue supporting multiple item types. Each item tagged with type. Type-specific fields shown contextually. Shared stock movement and reporting layer.',
          },
        },
      ],
    },
    {
      id: 'inv_update',
      label: 'How do stock levels get updated?',
      description: 'This determines how stock changes are recorded in the system',
      options: [
        {
          id: 'manual',
          label: 'Manually by staff',
          description: 'Team members update quantities themselves',
          prompt: {
            invUpdate: 'Manual stock updates',
            invUpdateDetail:
              'Staff enter stock adjustments via form. Each adjustment records quantity, reason (sale, return, damage, restock), and staff member. Full audit trail.',
          },
        },
        {
          id: 'auto',
          label: 'Automatically when sold',
          description: 'Stock drops automatically when a sale or order is placed',
          prompt: {
            invUpdate: 'Auto-deduct on sale/order',
            invUpdateDetail:
              'Order or sale event triggers automatic stock decrement. Reservation system to hold stock during checkout. Rollback on cancellation. Oversell prevention.',
          },
        },
        {
          id: 'scan',
          label: 'Barcode or QR scanning',
          description: 'Staff scan items to record stock changes',
          prompt: {
            invUpdate: 'Barcode / QR scan-based updates',
            invUpdateDetail:
              'Camera-based or hardware scanner input for item lookup. Scan to receive, dispatch, or count. Batch scan mode for stocktakes. Mobile-friendly scanning interface.',
          },
        },
        {
          id: 'supplier',
          label: 'Connected to a supplier system',
          description: 'Stock is updated when orders are placed or received',
          prompt: {
            invUpdate: 'Supplier integration — stock sync on PO',
            invUpdateDetail:
              'Purchase order flow triggers stock updates on receipt. Supplier records linked to products. Expected delivery tracking. Discrepancy flagging on partial deliveries.',
          },
        },
      ],
    },
    {
      id: 'inv_alerts',
      label: 'What alerts do you need?',
      description: 'Choose the notifications that will help you stay on top of stock',
      options: [
        {
          id: 'lowstock',
          label: 'Low stock warnings',
          description: 'Get notified when an item is running low',
          prompt: {
            invAlerts: 'Low stock threshold alerts',
            invAlertsDetail:
              'Configurable minimum stock threshold per product. Alert triggered when quantity falls below threshold. Notification via email and in-app banner. Alert dashboard for admin.',
          },
        },
        {
          id: 'reorder',
          label: 'Reorder reminders',
          description: "Remind me when it's time to restock from a supplier",
          prompt: {
            invAlerts: 'Reorder point reminders',
            invAlertsDetail:
              'Reorder point set per product. System flags items ready to reorder and optionally auto-generates a draft purchase order. Supplier contact details surfaced in the alert.',
          },
        },
        {
          id: 'expiry',
          label: 'Expiry date alerts',
          description: 'Warn me when items are close to their expiry date',
          prompt: {
            invAlerts: 'Expiry date tracking and alerts',
            invAlertsDetail:
              'Expiry date field per batch or item. Alerts at configurable lead time before expiry (e.g. 30 days). Expired stock flagged separately. FIFO picking recommendation.',
          },
        },
        {
          id: 'none',
          label: 'No alerts needed',
          description: "I'll check stock levels manually",
          prompt: {
            invAlerts: 'No automated alerts',
            invAlertsDetail: 'No alerting infrastructure. Staff check stock levels manually via inventory dashboard.',
          },
        },
      ],
    },
  ],
  hr: [
    {
      id: 'hr_features',
      label: 'Which HR features do you need?',
      description: 'Select the main things your app needs to handle',
      options: [
        {
          id: 'timesheets',
          label: 'Timesheets & attendance',
          description: 'Track when staff clock in, clock out, and hours worked',
          prompt: {
            hrFeatures: 'Timesheet and attendance tracking',
            hrFeaturesDetail:
              'Daily timesheet entry or clock-in/clock-out per employee. Manager approval workflow. Monthly summary and overtime calculation. Export for payroll processing.',
          },
        },
        {
          id: 'leave',
          label: 'Leave & absence',
          description: 'Manage holiday requests, sick days, and approvals',
          prompt: {
            hrFeatures: 'Leave and absence management',
            hrFeaturesDetail:
              'Leave request form with type (holiday, sick, unpaid), date range, and notes. Approval/rejection by manager with email notification. Leave balance tracking. Team calendar showing who is absent.',
          },
        },
        {
          id: 'expenses',
          label: 'Expenses & claims',
          description: 'Staff submit expense receipts for reimbursement',
          prompt: {
            hrFeatures: 'Expense claim management',
            hrFeaturesDetail:
              'Expense submission with amount, category, date, and receipt photo upload. Manager approval flow. Finance export for reimbursement processing. Per-employee claim history.',
          },
        },
        {
          id: 'all',
          label: 'All of the above',
          description: 'Timesheets, leave, expenses, and payroll summary',
          prompt: {
            hrFeatures: 'Full HR suite — timesheets, leave, expenses, payroll',
            hrFeaturesDetail:
              'Complete HR platform: timesheet and attendance tracking, leave management with approvals, expense claims with receipt upload, and payroll summary report. Unified employee dashboard.',
          },
        },
      ],
    },
    {
      id: 'hr_approval',
      label: 'Who approves staff requests?',
      description: 'This determines the approval flow built into your app',
      options: [
        {
          id: 'manager',
          label: 'Direct manager',
          description: "Each employee's line manager reviews and approves",
          prompt: {
            hrApproval: 'Line manager approval chain',
            hrApprovalDetail:
              'Each employee linked to a manager. Requests routed to the assigned manager. Manager receives email and in-app notification. Employee notified on decision.',
          },
        },
        {
          id: 'hr',
          label: 'HR department',
          description: 'A dedicated HR team handles all approvals',
          prompt: {
            hrApproval: 'Central HR team approval',
            hrApprovalDetail:
              'All requests go to a shared HR approver queue. Any HR team member can action requests. HR role has full visibility across all employees.',
          },
        },
        {
          id: 'owner',
          label: 'Business owner',
          description: 'The owner or director approves everything',
          prompt: {
            hrApproval: 'Single approver — business owner',
            hrApprovalDetail:
              'One designated approver receives all requests. Simple single-level approval with email notification and in-app action buttons.',
          },
        },
        {
          id: 'auto',
          label: 'Automatic approval',
          description: 'Requests are approved instantly without manual review',
          prompt: {
            hrApproval: 'Automatic approval — no manual review',
            hrApprovalDetail:
              'Requests auto-approved based on rules (e.g. leave balance available). No approval queue. Employee and manager notified of auto-approval. Exceptions flagged for manual review.',
          },
        },
      ],
    },
    {
      id: 'hr_access',
      label: 'How do employees submit information?',
      description: 'This shapes how the app is built and accessed',
      options: [
        {
          id: 'desktop',
          label: 'On a computer',
          description: 'Using a browser on a desktop or laptop',
          prompt: {
            hrAccess: 'Desktop web application',
            hrAccessDetail:
              'Desktop-optimised responsive web app. Full feature set available in browser. No native mobile app needed.',
          },
        },
        {
          id: 'mobile',
          label: 'On a phone',
          description: 'Via a mobile-friendly app or website',
          prompt: {
            hrAccess: 'Mobile-first web application',
            hrAccessDetail:
              'Mobile-first responsive design. Touch-friendly UI, large tap targets, camera access for receipt uploads. Progressive Web App (PWA) support for add-to-homescreen.',
          },
        },
        {
          id: 'both',
          label: 'Both',
          description: 'Accessible on any device — phone, tablet, or computer',
          prompt: {
            hrAccess: 'Fully responsive — desktop and mobile',
            hrAccessDetail:
              'Fully responsive design working across all screen sizes. Desktop layout for managers, mobile layout for frontline staff. Camera access on mobile for receipt uploads.',
          },
        },
        {
          id: 'admin',
          label: 'Admin enters it for them',
          description: 'HR or managers enter data on behalf of staff',
          prompt: {
            hrAccess: 'Admin-managed data entry',
            hrAccessDetail:
              'Admin-only data entry. No self-service employee portal. HR or managers fill in timesheets, leave, and expenses on behalf of staff. Clean admin-focused UI.',
          },
        },
      ],
    },
  ],
  appointment: [
    {
      id: 'apt_booker',
      label: 'Who creates the bookings?',
      description: 'This determines whether customers can self-serve or if staff manage everything',
      options: [
        {
          id: 'customers',
          label: 'Customers book themselves',
          description: 'Clients visit your site and pick a time slot',
          prompt: {
            aptBooker: 'Customer self-service booking',
            aptBookerDetail:
              'Public booking page where customers select a service, choose an available slot, and confirm. No login required unless specified. Booking confirmation sent by email.',
          },
        },
        {
          id: 'staff',
          label: 'Staff schedule for customers',
          description: 'Your team books appointments on behalf of clients',
          prompt: {
            aptBooker: 'Staff-managed booking',
            aptBookerDetail:
              'Internal booking interface for staff. Customer selected from existing records or added on the fly. Staff pick date, time, and service. Customer receives confirmation email.',
          },
        },
        {
          id: 'both',
          label: 'Both',
          description: 'Either the customer or staff can create a booking',
          prompt: {
            aptBooker: 'Dual booking — customer self-serve + staff',
            aptBookerDetail:
              'Customer-facing public booking flow and staff internal booking interface. Both routes create the same appointment record. Conflict prevention shared across both.',
          },
        },
        {
          id: 'admin',
          label: 'Admin only',
          description: 'Only your internal team manages the schedule',
          prompt: {
            aptBooker: 'Admin-only schedule management',
            aptBookerDetail:
              'No public booking interface. Admin or manager creates and manages all appointments internally. Calendar view with drag-and-drop rescheduling.',
          },
        },
      ],
    },
    {
      id: 'apt_slots',
      label: 'How are time slots set?',
      description: 'This controls how your available times are managed',
      options: [
        {
          id: 'fixed',
          label: 'Fixed weekly schedule',
          description: 'The same hours every week — e.g. Mon–Fri, 9am–5pm',
          prompt: {
            aptSlots: 'Fixed recurring schedule',
            aptSlotsDetail:
              'Repeating weekly availability defined once in settings. Slot duration configurable. Breaks and lunch excluded. Simple to set up; same hours repeat indefinitely.',
          },
        },
        {
          id: 'custom',
          label: 'Each provider sets their own hours',
          description: 'Different staff or locations can have different availability',
          prompt: {
            aptSlots: 'Per-provider custom availability',
            aptSlotsDetail:
              "Each staff member or location sets their own availability calendar. Overrides for specific dates. Customer selects provider then sees that provider's available slots.",
          },
        },
        {
          id: 'open',
          label: 'Open — any time',
          description: 'Bookings can be made at any hour of the day',
          prompt: {
            aptSlots: 'Open availability — no fixed schedule',
            aptSlotsDetail:
              'No fixed slots. Customers pick any date and time within a configurable booking window. Overlap prevention ensures no double-booking.',
          },
        },
        {
          id: 'mixed',
          label: 'Mixed',
          description: 'Some fixed hours, some flexible depending on the provider',
          prompt: {
            aptSlots: 'Mixed availability — fixed and flexible per provider',
            aptSlotsDetail:
              'Per-provider availability type. Fixed-schedule providers use recurring slots. Flexible providers set custom availability. Unified booking interface handles both.',
          },
        },
      ],
    },
    {
      id: 'apt_after',
      label: 'What happens after a booking is made?',
      description: 'Choose how customers and staff are notified',
      options: [
        {
          id: 'email',
          label: 'Email confirmation only',
          description: 'The booker gets a confirmation email',
          prompt: {
            aptAfter: 'Email confirmation only',
            aptAfterDetail:
              'Confirmation email sent immediately after booking with appointment details, location or link, and cancellation option. No further follow-up.',
          },
        },
        {
          id: 'reminders',
          label: 'Reminders before the appointment',
          description: 'Automatic reminder sent ahead of time',
          prompt: {
            aptAfter: 'Confirmation + automated reminders',
            aptAfterDetail:
              'Confirmation email on booking. Automated reminder email (and optional SMS via Twilio) at configurable intervals before the appointment (e.g. 24h and 1h before).',
          },
        },
        {
          id: 'calendar',
          label: 'Calendar invite',
          description: "A calendar event added to the booker's Google or Outlook calendar",
          prompt: {
            aptAfter: 'Calendar invite (Google / Outlook)',
            aptAfterDetail:
              '.ics calendar file attached to confirmation email. Google Calendar and Outlook compatible. Event includes location, notes, and join link if virtual. Update sent on reschedule.',
          },
        },
        {
          id: 'all',
          label: 'All of the above',
          description: 'Confirmation email, reminders, and calendar sync',
          prompt: {
            aptAfter: 'Full notification suite — email + reminders + calendar invite',
            aptAfterDetail:
              'Confirmation email on booking with .ics calendar attachment. Automated reminder emails at 24h and 1h before. Optional SMS reminder via Twilio. Update notifications on reschedule or cancellation.',
          },
        },
      ],
    },
  ],
  knowledge: [
    {
      id: 'kh_content',
      label: 'What kind of content will be shared?',
      description: 'This shapes the storage and display of your content',
      options: [
        {
          id: 'docs',
          label: 'Documents & files',
          description: 'PDFs, Word docs, spreadsheets, and downloadable files',
          prompt: {
            khContent: 'Document and file sharing',
            khContentDetail:
              'File upload to S3 with version history. Preview for PDFs and common document types. Download button. Folder-style organisation. File size and type restrictions configurable.',
          },
        },
        {
          id: 'articles',
          label: 'Written guides & articles',
          description: 'Step-by-step guides, FAQs, and internal wikis',
          prompt: {
            khContent: 'Written articles and wiki pages',
            khContentDetail:
              'Rich text editor (e.g. TipTap or Quill) for creating guides, FAQs, and wiki pages. Version history per article. Internal linking between articles. Breadcrumb navigation.',
          },
        },
        {
          id: 'video',
          label: 'Video tutorials',
          description: 'Recorded walkthroughs or training videos',
          prompt: {
            khContent: 'Video content hosting',
            khContentDetail:
              'Video upload to S3 with transcoding pipeline. Embedded video player with progress tracking. Transcript support optional. Thumbnail generation. Chapter markers.',
          },
        },
        {
          id: 'mixed',
          label: 'Mix of all',
          description: 'Documents, written guides, and videos combined',
          prompt: {
            khContent: 'Mixed content — documents, articles, and videos',
            khContentDetail:
              'Flexible content schema supporting multiple content types. Unified search across all types. Each type rendered with its own viewer. Consistent tagging and categorisation.',
          },
        },
      ],
    },
    {
      id: 'kh_editors',
      label: 'Who can add or edit content?',
      description: 'This sets the publishing and editing permissions',
      options: [
        {
          id: 'admin',
          label: 'Admin only',
          description: 'Only administrators can post or update content',
          prompt: {
            khEditors: 'Admin-only content management',
            khEditorsDetail:
              'Content creation and editing restricted to admin role. Other users are read-only. Simple admin content panel with publish/unpublish toggle.',
          },
        },
        {
          id: 'editors',
          label: 'Designated editors',
          description: 'A specific group of people can publish and manage content',
          prompt: {
            khEditors: 'Editor role — designated publishers',
            khEditorsDetail:
              'Editor role can create, edit, and publish content. Admin manages who has editor access. Draft and review workflow with publish approval option.',
          },
        },
        {
          id: 'team',
          label: 'Any team member',
          description: 'All staff can contribute and edit content',
          prompt: {
            khEditors: 'Open team contribution',
            khEditorsDetail:
              'All authenticated users can create and edit content. Optional draft-and-review workflow. Edit history with author attribution. Admin can revert any change.',
          },
        },
        {
          id: 'public',
          label: 'Anyone (public)',
          description: 'External visitors can also submit or comment on content',
          prompt: {
            khEditors: 'Public contributions with moderation',
            khEditorsDetail:
              'Public users can submit content or comments. Moderation queue for admin or editor review before publishing. CAPTCHA on submission to prevent spam.',
          },
        },
      ],
    },
    {
      id: 'kh_discovery',
      label: 'How do people find what they need?',
      description: 'This determines your navigation and search setup',
      options: [
        {
          id: 'category',
          label: 'Browse by category',
          description: 'Content is organised into folders or topics',
          prompt: {
            khDiscovery: 'Category and topic navigation',
            khDiscoveryDetail:
              'Hierarchical category and topic tree. Category landing pages showing content count. Breadcrumb navigation. Subcategory support.',
          },
        },
        {
          id: 'search',
          label: 'Search by keyword',
          description: 'Users type to search across all content',
          prompt: {
            khDiscovery: 'Full-text keyword search',
            khDiscoveryDetail:
              'Full-text search across titles, body content, and tags. Relevance-ranked results. Search-as-you-type suggestions. Highlight matched terms in results.',
          },
        },
        {
          id: 'both',
          label: 'Both search and categories',
          description: 'Users can browse or search however they prefer',
          prompt: {
            khDiscovery: 'Category browse + full-text search',
            khDiscoveryDetail:
              'Category tree sidebar navigation combined with a global search bar. Search scoped to current category or across all content. Filter results by content type.',
          },
        },
        {
          id: 'homepage',
          label: 'Curated homepage',
          description: 'A handpicked selection of important content shown first',
          prompt: {
            khDiscovery: 'Curated homepage + category navigation',
            khDiscoveryDetail:
              'Admin-curated homepage featuring pinned content, featured categories, and recently updated items. Useful for onboarding new users to the most important resources.',
          },
        },
      ],
    },
  ],
  landing: [
    {
      id: 'lp_purpose',
      label: 'What is the main purpose of your site?',
      description: 'This determines the pages and features we build',
      options: [
        {
          id: 'business',
          label: 'Showcase a business or product',
          description: 'Present your company, services, and team professionally',
          prompt: {
            lpPurpose: 'Business / product showcase website',
            lpPurposeDetail:
              'Homepage with hero, features or services section, about page, team section, and contact form. SEO-optimised pages. Clear calls to action. Mobile-first design.',
          },
        },
        {
          id: 'blog',
          label: 'Blog or news site',
          description: 'Publish articles, updates, or announcements regularly',
          prompt: {
            lpPurpose: 'Blog / news publishing site',
            lpPurposeDetail:
              'Article listing page with category filtering. Individual article pages with rich content. Author profiles. RSS feed. SEO-optimised with Open Graph tags and sitemap.',
          },
        },
        {
          id: 'portfolio',
          label: 'Personal portfolio',
          description: 'Showcase your own work, projects, or CV',
          prompt: {
            lpPurpose: 'Personal portfolio website',
            lpPurposeDetail:
              'About / bio page, project gallery with case studies, skills section, CV download, and contact form. Minimal and elegant design. SEO-optimised for personal brand.',
          },
        },
        {
          id: 'leads',
          label: 'Lead generation',
          description: 'Attract visitors and get them to contact you or sign up',
          prompt: {
            lpPurpose: 'Lead generation / marketing landing page',
            lpPurposeDetail:
              'High-conversion landing page with headline, value proposition, social proof (testimonials, logos), and prominent CTA. Lead capture form with email integration. A/B testable sections.',
          },
        },
      ],
    },
    {
      id: 'lp_updates',
      label: 'How often will content be updated?',
      description: 'This shapes whether you need a CMS or a static site',
      options: [
        {
          id: 'static',
          label: 'Rarely — mostly static',
          description: 'Set it up once, minimal changes needed after launch',
          prompt: {
            lpUpdates: 'Static site — minimal updates',
            lpUpdatesDetail:
              'Static site generation (Next.js static export or similar). No CMS needed. Content updated by editing code or markdown files. Fast load times, low hosting cost.',
          },
        },
        {
          id: 'occasional',
          label: 'Occasionally',
          description: 'New posts or updates a few times a month',
          prompt: {
            lpUpdates: 'Occasional updates — lightweight CMS',
            lpUpdatesDetail:
              'Lightweight headless CMS (e.g. Sanity or Contentful free tier) for content editing without code changes. Editor-friendly interface. Pages rebuilt on content publish.',
          },
        },
        {
          id: 'regular',
          label: 'Regularly by a team',
          description: 'Multiple people posting and editing content frequently',
          prompt: {
            lpUpdates: 'Regular team content updates — full CMS',
            lpUpdatesDetail:
              'Full headless CMS with multi-user roles (Editor, Publisher, Admin). Draft and review workflow. Scheduled publishing. Media library. Content version history.',
          },
        },
        {
          id: 'frequent',
          label: 'Very often',
          description: 'New content published daily or multiple times a week',
          prompt: {
            lpUpdates: 'High-frequency publishing — CMS with automation',
            lpUpdatesDetail:
              'Headless CMS with API-driven content delivery. RSS or webhook-based automation support. Scheduled posts, content series, and tag-based categorisation. CDN caching for performance.',
          },
        },
      ],
    },
    {
      id: 'lp_contact',
      label: 'How should visitors get in touch?',
      description: 'Choose how you want potential customers to reach you',
      options: [
        {
          id: 'none',
          label: 'No contact option',
          description: "I don't need visitors to reach out",
          prompt: {
            lpContact: 'No contact mechanism',
            lpContactDetail: 'No contact form, chat widget, or booking link. Site is fully informational.',
          },
        },
        {
          id: 'form',
          label: 'Simple contact form',
          description: 'A basic form with name, email, and message',
          prompt: {
            lpContact: 'Contact form with email notification',
            lpContactDetail:
              'Simple contact form (name, email, message). Submission sends email notification to owner. Spam protection via CAPTCHA or honeypot. Confirmation message shown on submit.',
          },
        },
        {
          id: 'booking',
          label: 'Book a meeting',
          description: 'A link or widget to schedule a call or demo',
          prompt: {
            lpContact: 'Meeting booking link or embed',
            lpContactDetail:
              'Calendly, Cal.com, or similar booking widget embedded or linked. Visitors select a meeting type and time slot. Confirmation and reminder emails handled by the booking tool.',
          },
        },
        {
          id: 'chat',
          label: 'Live chat',
          description: 'A chat widget for real-time conversation with visitors',
          prompt: {
            lpContact: 'Live chat widget',
            lpContactDetail:
              'Live chat widget (e.g. Crisp, Tawk.to, or Intercom) embedded on the site. Owner notified of new chats via mobile app or email. Offline fallback captures visitor email for follow-up.',
          },
        },
      ],
    },
  ],
};

export function buildRefineQuestions(appType: string): Question[] {
  const questions = [...secondaryUniversal];
  const conditional = secondaryConditional[appType];

  if (conditional && conditional.length > 0) {
    return questions.concat(conditional);
  }

  return questions.concat([
    {
      id: 'custom_features',
      type: 'text',
      label: 'Anything else you want to add?',
      description: 'Describe any features, requirements, or constraints not covered above.',
      placeholder:
        'e.g. I also need a mobile app (React Native), an admin analytics dashboard, dark mode support, and multi-language support (English + Spanish).',
    },
  ]);
}
