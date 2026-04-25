import React from 'react';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from '~/utils/constants';

interface FrameworkLinkProps {
  template: Template;
}

const FrameworkLink: React.FC<FrameworkLinkProps> = ({ template }) => (
  <div className="items-center justify-center">
    <div
      className={`inline-block ${template.icon} w-8 h-8 text-4xl transition-theme text-white opacity-100 hover:text-purple-500 dark:text-white dark:hover:text-purple-400 transition-all`}
      title={template.label}
    />
  </div>
);

const StarterTemplates: React.FC = () => {
  // Debug: Log available templates and their icons
  React.useEffect(() => {
    console.log(
      'Available templates:',
      STARTER_TEMPLATES.map(t => ({ name: t.name, icon: t.icon }))
    );
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-sm text-white">or start a blank app with your favorite stack</span>
      <div className="flex justify-center">
        <div className="flex w-70 flex-wrap items-center justify-center gap-4">
          {STARTER_TEMPLATES.map(template => (
            <FrameworkLink key={template.name} template={template} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default StarterTemplates;
