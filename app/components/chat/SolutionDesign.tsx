import React, { useState, useEffect } from 'react';
import { classNames } from '~/utils/classNames';
import { generateSystemFlow } from '~/utils/systemFlows';

// Draggable System Flow Step Component
interface DraggableStepProps {
  step: string;
  index: number;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  isDragging: boolean;
}

const DraggableStep: React.FC<DraggableStepProps> = ({
  step,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging
}) => {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, index)}
      className={classNames(
        'flex items-center gap-3 p-3 bg-white border border-gray-300 rounded-lg cursor-move transition-all duration-200',
        isDragging ? 'opacity-50 scale-95' : 'hover:shadow-md',
        'hover:border-blue-300'
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
        {index + 1}
      </div>
      <span className="flex-1 text-sm text-gray-900">{step}</span>
      <div className="flex-shrink-0 text-gray-400">
        <div className="i-ph:dots-six-vertical text-sm"></div>
      </div>
    </div>
  );
};

interface SolutionDesignProps {
  applicationType: string;
  businessType: string;
  additionalDetails: string;
  onProceedToCode: (prompt: string) => void;
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

  // State for editable fields in Section A
  const [projectOverview, setProjectOverview] = useState(
    `We'll be building a ${applicationType} specifically designed for ${businessType}.${additionalDetails ? ` Additional requirements: ${additionalDetails}` : ''}`
  );
  const [keyFeatures, setKeyFeatures] = useState([
    'Modern, responsive design',
    'User-friendly interface',
    'Industry-specific functionality',
    'Scalable architecture'
  ]);
  const [targetUsers, setTargetUsers] = useState([
    `${businessType} staff and administrators`,
    'End users and customers',
    'Mobile and desktop users',
    'Various technical skill levels'
  ]);



  // State for editable fields in Section B
  const [systemFlowSteps, setSystemFlowSteps] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Initialize system flow steps when application type changes
  useEffect(() => {
    const flowText = generateSystemFlow(applicationType, businessType);
    const steps = flowText.split('\n').map(line => line.replace(/^\d+\.\s*/, ''));
    setSystemFlowSteps(steps);
  }, [applicationType, businessType]);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newSteps = [...systemFlowSteps];
    const draggedStep = newSteps[draggedIndex];
    
    // Remove the dragged item
    newSteps.splice(draggedIndex, 1);
    
    // Insert at the new position
    newSteps.splice(dropIndex, 0, draggedStep);
    
    setSystemFlowSteps(newSteps);
    setDraggedIndex(null);
  };

  // State for editable fields in Section C
  const [framework, setFramework] = useState('React');
  const [useTypeScript, setUseTypeScript] = useState(true);
  const [cssFramework, setCssFramework] = useState('Tailwind CSS');
  const [database, setDatabase] = useState('SQLite');

  const displayPrompt = () => {
    return `Build me a ${applicationType} for ${businessType}${additionalDetails ? ` - ${additionalDetails}` : ''}`;
  };

  const constructPrompt = () => {
    const basePrompt = `Build me a ${applicationType} for ${businessType}${additionalDetails ? ` - ${additionalDetails}` : ''}`;
    
    // Append technology stack selections
    const techStack = [
      `Framework: ${framework}`,
      `Language: ${useTypeScript ? 'TypeScript' : 'JavaScript'}`,
      `Style: ${cssFramework}`,
      `DB: ${database}`
    ].join('\n');
    
    return `${basePrompt}\n\n${techStack}`;
  };

  // Helper function to add new item to array
  const addItem = (array: string[], setArray: (items: string[]) => void, defaultValue: string = '') => {
    setArray([...array, defaultValue]);
  };

  // Helper function to remove item from array
  const removeItem = (array: string[], setArray: (items: string[]) => void, index: number) => {
    setArray(array.filter((_, i) => i !== index));
  };

  // Helper function to update item in array
  const updateItem = (array: string[], setArray: (items: string[]) => void, index: number, value: string) => {
    const newArray = [...array];
    newArray[index] = value;
    setArray(newArray);
  };

  const sections: SolutionSection[] = [
    {
      id: 'summary',
      title: 'A) Summary of the Application',
      icon: 'i-ph:file-text',
      content: (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg border border-gray-300">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Project Overview</h4>
            <textarea
              value={projectOverview}
              onChange={(e) => setProjectOverview(e.target.value)}
              className="w-full p-3 text-sm text-gray-900 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={4}
              placeholder="Enter project overview..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-lg border border-gray-300">
              <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Key Features</h4>
              <div className="space-y-2">
                {keyFeatures.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feature}
                      onChange={(e) => updateItem(keyFeatures, setKeyFeatures, index, e.target.value)}
                      className="flex-1 p-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter feature..."
                    />
                    <button
                      onClick={() => removeItem(keyFeatures, setKeyFeatures, index)}
                      className="p-1 text-red-500 hover:text-red-700"
                      title="Remove feature"
                    >
                      <div className="i-ph:x text-sm"></div>
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addItem(keyFeatures, setKeyFeatures, 'New feature')}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  <div className="i-ph:plus text-sm"></div>
                  Add Feature
                </button>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-gray-300">
              <h4 className="font-semibold text-bolt-elements-textPrimary mb-2">Target Users</h4>
              <div className="space-y-2">
                {targetUsers.map((user, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={user}
                      onChange={(e) => updateItem(targetUsers, setTargetUsers, index, e.target.value)}
                      className="flex-1 p-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter target user..."
                    />
                    <button
                      onClick={() => removeItem(targetUsers, setTargetUsers, index)}
                      className="p-1 text-red-500 hover:text-red-700"
                      title="Remove user"
                    >
                      <div className="i-ph:x text-sm"></div>
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addItem(targetUsers, setTargetUsers, 'New user')}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  <div className="i-ph:plus text-sm"></div>
                  Add User
                </button>
              </div>
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
          <div className="bg-white p-4 rounded-lg border border-gray-300">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">System Flow</h4>
            <p className="text-xs text-gray-500 mb-3">
              Drag and drop the steps to reorder the system flow. The numbered index will automatically update.
            </p>
            <div className="space-y-2">
              {systemFlowSteps.map((step, index) => (
                <DraggableStep
                  key={index}
                  step={step}
                  index={index}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragging={draggedIndex === index}
                />
              ))}
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
          <div className="bg-white p-4 rounded-lg border border-gray-300">
            <h4 className="font-semibold text-bolt-elements-textPrimary mb-3">Technology Stack</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-white border border-gray-300 rounded-lg">
                <div className="text-2xl mb-1">
                  {framework === 'React' && <div className="i-logos:react"></div>}
                  {framework === 'Vue' && <div className="i-logos:vue"></div>}
                  {framework === 'Angular' && <div className="i-logos:angular-icon"></div>}
                  {framework === 'Svelte' && <div className="i-logos:svelte-icon"></div>}
                  {framework === 'Next.js' && <div className="i-logos:nextjs-icon"></div>}
                  {framework === 'Nuxt.js' && <div className="i-logos:nuxt-icon"></div>}
                  {framework === 'Vanilla JavaScript' && <div className="i-logos:javascript"></div>}
                </div>
                <select
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className="w-full text-xs text-gray-900 bg-white border-0 focus:ring-0 focus:outline-none text-center"
                >
                  <option value="React">React</option>
                  <option value="Vue">Vue</option>
                  <option value="Angular">Angular</option>
                  <option value="Svelte">Svelte</option>
                  <option value="Next.js">Next.js</option>
                  <option value="Nuxt.js">Nuxt.js</option>
                  <option value="Vanilla JavaScript">Vanilla JavaScript</option>
                </select>
              </div>
              <div className="text-center p-3 bg-white border border-gray-300 rounded-lg">
                <div className="text-2xl mb-1">
                  {useTypeScript ? <div className="i-logos:typescript-icon"></div> : <div className="i-logos:javascript"></div>}
                </div>
                <select
                  value={useTypeScript ? 'TypeScript' : 'JavaScript'}
                  onChange={(e) => setUseTypeScript(e.target.value === 'TypeScript')}
                  className="w-full text-xs text-gray-900 bg-white border-0 focus:ring-0 focus:outline-none text-center"
                >
                  <option value="TypeScript">TypeScript</option>
                  <option value="JavaScript">JavaScript</option>
                </select>
              </div>
              <div className="text-center p-3 bg-white border border-gray-300 rounded-lg">
                <div className="text-2xl mb-1">
                  {cssFramework === 'Tailwind CSS' && <div className="i-logos:tailwindcss-icon"></div>}
                  {cssFramework === 'Chakra UI' && <div className="i-logos:chakra-ui-icon"></div>}
                </div>
                <select
                  value={cssFramework}
                  onChange={(e) => setCssFramework(e.target.value)}
                  className="w-full text-xs text-gray-900 bg-white border-0 focus:ring-0 focus:outline-none text-center"
                >
                  <option value="Tailwind CSS">Tailwind CSS</option>
                  <option value="Chakra UI">Chakra UI</option>
                </select>
              </div>
              <div className="text-center p-3 bg-white border border-gray-300 rounded-lg">
                <div className="text-2xl mb-1">
                  {database === 'SQLite' && <div className="i-logos:sqlite"></div>}
                  {database === 'PostgreSQL' && <div className="i-logos:postgresql"></div>}
                  {database === 'MySQL' && <div className="i-logos:mysql"></div>}
                  {database === 'MongoDB' && <div className="i-logos:mongodb"></div>}
                  {database === 'Firebase' && <div className="i-logos:firebase"></div>}
                  {database === 'Supabase' && <div className="i-logos:supabase-icon"></div>}
                </div>
                <select
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  className="w-full text-xs text-gray-900 bg-white border-0 focus:ring-0 focus:outline-none text-center"
                >
                  <option value="SQLite">SQLite</option>
                  <option value="PostgreSQL">PostgreSQL</option>
                  <option value="MySQL">MySQL</option>
                  <option value="MongoDB">MongoDB</option>
                  <option value="Firebase">Firebase</option>
                  <option value="Supabase">Supabase</option>
                </select>
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
        <p className="text-lg text-bolt-elements-textSecondary mb-6">{displayPrompt()}</p>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {sections.map(section => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={classNames(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                activeSection === section.id
                  ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                  : 'bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-4'
              )}
            >
              <div className={section.icon}></div>
              {section.title}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mb-8">{sections.find(section => section.id === activeSection)?.content}</div>

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
          onClick={() => onProceedToCode(constructPrompt())}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-all duration-200 font-medium"
        >
          Proceed to Code Generation
          <div className="i-ph:arrow-right"></div>
        </button>
      </div>
    </div>
  );
};
