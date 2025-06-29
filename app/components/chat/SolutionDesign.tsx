import React, { useState } from 'react';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';

interface SolutionDesignProps {
  applicationType: string;
  businessType: string;
  additionalDetails: string;
  onProceedToCode: () => void;
  onBackToForm: () => void;
}

interface SolutionSection {
  id: string;
  title: string;
  icon: string;
  content: React.ReactNode;
}

export const SolutionDesign: React.FC<SolutionDesignProps> = ({
  applicationType,
  businessType,
  additionalDetails,
  onProceedToCode,
  onBackToForm,
}) => {
  const [activeSection, setActiveSection] = useState<string>('summary');

  const constructPrompt = () => {
    return `Build me a ${applicationType} for ${businessType}${additionalDetails ? ` - ${additionalDetails}` : ''}`;
  };

  const sections: SolutionSection[] = [
    {
      id: 'summary',
      title: 'A) Summary of the Application',
      icon: 'i-ph:file-text',
      content: (
        <div className="space-y-4">
          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Project Overview</h4>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
              We'll be building a <span className="font-medium text-bolt-elements-textPrimary">{applicationType}</span>{' '}
              specifically designed for{' '}
              <span className="font-medium text-bolt-elements-textPrimary">{businessType}</span>.
              {additionalDetails && (
                <>
                  <br />
                  <span className="text-bolt-elements-textSecondary">Additional requirements: {additionalDetails}</span>
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
              <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Key Features</h4>
              <ul className="text-sm text-bolt-elements-textSecondary space-y-1">
                <li>• Modern, responsive design</li>
                <li>• User-friendly interface</li>
                <li>• Industry-specific functionality</li>
                <li>• Scalable architecture</li>
              </ul>
            </div>

            <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
              <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Target Users</h4>
              <ul className="text-sm text-bolt-elements-textSecondary space-y-1">
                <li>• {businessType} staff and administrators</li>
                <li>• End users and customers</li>
                <li>• Mobile and desktop users</li>
                <li>• Various technical skill levels</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'beginner-design',
      title: 'B) Solution Design for Beginners',
      icon: 'i-ph:lightbulb',
      content: (
        <div className="space-y-6">
          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Simple Explanation</h4>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed mb-4">
              Think of this {applicationType} like building a digital storefront or workspace for your {businessType}.
              It's like creating a website that helps your business serve its customers better.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-ph:users text-2xl text-bolt-elements-textSecondary mb-2"></div>
                <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Users</h5>
                <p className="text-xs text-bolt-elements-textTertiary">Who will use it</p>
              </div>
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-ph:gear text-2xl text-bolt-elements-textSecondary mb-2"></div>
                <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Features</h5>
                <p className="text-xs text-bolt-elements-textTertiary">What it will do</p>
              </div>
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-ph:paint-brush text-2xl text-bolt-elements-textSecondary mb-2"></div>
                <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Design</h5>
                <p className="text-xs text-bolt-elements-textTertiary">How it will look</p>
              </div>
            </div>
          </div>

          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">What You'll Get</h4>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="i-ph:check-circle text-green-500 mt-0.5"></div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Complete Website</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">A fully functional website ready to use</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="i-ph:check-circle text-green-500 mt-0.5"></div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Source Code</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">All the code files to understand and modify</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="i-ph:check-circle text-green-500 mt-0.5"></div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Documentation</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">Step-by-step guides to help you understand</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'implementation',
      title: 'C) Implementation Guide',
      icon: 'i-ph:map-trifold',
      content: (
        <div className="space-y-6">
          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Development Process</h4>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-bolt-elements-background-depth-4 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">1</span>
                </div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Planning & Design</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">
                    Define features, user interface, and technical requirements
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-bolt-elements-background-depth-4 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">2</span>
                </div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Frontend Development</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">
                    Create the user interface and user experience
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-bolt-elements-background-depth-4 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">3</span>
                </div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Backend Integration</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">Connect to databases and external services</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-bolt-elements-background-depth-4 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">4</span>
                </div>
                <div>
                  <h5 className="font-medium text-bolt-elements-textPrimary text-sm">Testing & Deployment</h5>
                  <p className="text-xs text-bolt-elements-textTertiary">
                    Ensure everything works and deploy to production
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Technology Stack</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-logos:react text-2xl mb-1"></div>
                <p className="text-xs text-bolt-elements-textSecondary">React</p>
              </div>
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-logos:typescript-icon text-2xl mb-1"></div>
                <p className="text-xs text-bolt-elements-textSecondary">TypeScript</p>
              </div>
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-logos:tailwindcss-icon text-2xl mb-1"></div>
                <p className="text-xs text-bolt-elements-textSecondary">Tailwind CSS</p>
              </div>
              <div className="text-center p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <div className="i-ph:database text-2xl mb-1 text-bolt-elements-textSecondary"></div>
                <p className="text-xs text-bolt-elements-textSecondary">Database</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'developer-details',
      title: 'D) Developer Details',
      icon: 'i-ph:code',
      content: (
        <div className="space-y-6">
          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Technical Architecture</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <span className="text-sm text-bolt-elements-textPrimary">Frontend Framework</span>
                <span className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-3 px-2 py-1 rounded">
                  React 18+
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <span className="text-sm text-bolt-elements-textPrimary">Styling</span>
                <span className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-3 px-2 py-1 rounded">
                  Tailwind CSS
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <span className="text-sm text-bolt-elements-textPrimary">State Management</span>
                <span className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-3 px-2 py-1 rounded">
                  React Hooks
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-bolt-elements-background-depth-4 rounded-lg">
                <span className="text-sm text-bolt-elements-textPrimary">Build Tool</span>
                <span className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-3 px-2 py-1 rounded">
                  Vite
                </span>
              </div>
            </div>
          </div>

          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Project Structure</h4>
            <div className="text-xs text-bolt-elements-textSecondary font-mono space-y-1">
              <div>📁 src/</div>
              <div className="ml-4">📁 components/</div>
              <div className="ml-8">📄 App.tsx</div>
              <div className="ml-8">📄 Header.tsx</div>
              <div className="ml-8">📄 Footer.tsx</div>
              <div className="ml-4">📁 pages/</div>
              <div className="ml-8">📄 Home.tsx</div>
              <div className="ml-8">📄 About.tsx</div>
              <div className="ml-4">📁 utils/</div>
              <div className="ml-8">📄 helpers.ts</div>
              <div className="ml-4">📁 styles/</div>
              <div className="ml-8">📄 index.css</div>
            </div>
          </div>

          <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Key Features to Implement</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="i-ph:check text-green-500 text-sm"></div>
                <span className="text-sm text-bolt-elements-textSecondary">Responsive design for all devices</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="i-ph:check text-green-500 text-sm"></div>
                <span className="text-sm text-bolt-elements-textSecondary">Modern UI/UX with smooth animations</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="i-ph:check text-green-500 text-sm"></div>
                <span className="text-sm text-bolt-elements-textSecondary">Accessibility compliance (WCAG 2.1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="i-ph:check text-green-500 text-sm"></div>
                <span className="text-sm text-bolt-elements-textSecondary">Performance optimization</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="i-ph:check text-green-500 text-sm"></div>
                <span className="text-sm text-bolt-elements-textSecondary">SEO-friendly structure</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-4">Solution Design</h1>
        <p className="text-lg text-bolt-elements-textSecondary mb-6">{constructPrompt()}</p>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={classNames(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                activeSection === section.id
                  ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                  : 'bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-4',
              )}
            >
              <div className={section.icon}></div>
              {section.title}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mb-8">{sections.find((section) => section.id === activeSection)?.content}</div>

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-6 border-t border-bolt-elements-borderColor">
        <button
          onClick={onBackToForm}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-4 transition-all duration-200"
        >
          <div className="i-ph:arrow-left"></div>
          Back to Form
        </button>

        <button
          onClick={onProceedToCode}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-all duration-200 font-medium"
        >
          Proceed to Code Generation
          <div className="i-ph:arrow-right"></div>
        </button>
      </div>
    </div>
  );
};
