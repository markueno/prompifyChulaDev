import React, { useState } from 'react';
import { classNames } from '~/utils/classNames';

interface GuidedFormProps {
  onProceedToSolutionDesign: (applicationType: string, businessType: string, additionalDetails: string) => void;
}

const APPLICATION_TYPES = [
  { value: 'ecommerce site', label: 'E-commerce Site' },
  { value: 'blog', label: 'Blog' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'landing page', label: 'Landing Page' },
  { value: 'social media platform', label: 'Social Media Platform' },
  { value: 'learning management system', label: 'Learning Management System' },
  { value: 'restaurant website', label: 'Restaurant Website' },
  { value: 'real estate platform', label: 'Real Estate Platform' },
  { value: 'healthcare portal', label: 'Healthcare Portal' },
  { value: 'booking system', label: 'Booking System' },
  { value: 'forum', label: 'Forum' },
  { value: 'news website', label: 'News Website' },
  { value: 'job board', label: 'Job Board' },
  { value: 'marketplace', label: 'Marketplace' },
];

const BUSINESS_TYPES = [
  { value: 'university', label: 'University' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'real estate agency', label: 'Real Estate Agency' },
  { value: 'retail store', label: 'Retail Store' },
  { value: 'consulting firm', label: 'Consulting Firm' },
  { value: 'law firm', label: 'Law Firm' },
  { value: 'accounting firm', label: 'Accounting Firm' },
  { value: 'non-profit organization', label: 'Non-profit Organization' },
  { value: 'startup', label: 'Startup' },
  { value: 'corporate business', label: 'Corporate Business' },
  { value: 'fitness center', label: 'Fitness Center' },
  { value: 'salon/spa', label: 'Salon/Spa' },
  { value: 'automotive dealership', label: 'Automotive Dealership' },
  { value: 'travel agency', label: 'Travel Agency' },
  { value: 'insurance company', label: 'Insurance Company' },
  { value: 'bank/financial institution', label: 'Bank/Financial Institution' },
];

export const GuidedForm: React.FC<GuidedFormProps> = ({ onProceedToSolutionDesign }) => {
  const [selectedApplicationType, setSelectedApplicationType] = useState('');
  const [selectedBusinessType, setSelectedBusinessType] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');

  const constructPrompt = () => {
    if (selectedApplicationType && selectedBusinessType) {
      return `Build me a ${selectedApplicationType} for ${selectedBusinessType}${additionalDetails ? ` - ${additionalDetails}` : ''}`;
    }

    return '';
  };

  const handleProceed = () => {
    if (selectedApplicationType && selectedBusinessType) {
      onProceedToSolutionDesign(selectedApplicationType, selectedBusinessType, additionalDetails);
    }
  };

  const canProceed = selectedApplicationType && selectedBusinessType;

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-4">Let's Build Something Amazing</h1>
        <p className="text-lg text-bolt-elements-textSecondary mb-6">
          Tell us what you want to build and we'll create a comprehensive solution design for you.
        </p>
      </div>

      {/* Form */}
      <div className="bg-bolt-elements-background-depth-2 p-6 rounded-lg border border-bolt-elements-borderColor mb-8">
        <div className="space-y-6">
          {/* Application Type */}
          <div>
            <label htmlFor="applicationType" className="block text-sm font-medium text-bolt-elements-textPrimary mb-3">
              What type of application do you want to build?
            </label>
            <select
              id="applicationType"
              value={selectedApplicationType}
              onChange={e => setSelectedApplicationType(e.target.value)}
              className={classNames(
                'w-full px-4 py-3 rounded-lg border transition-all duration-200',
                'bg-bolt-elements-background-depth-3 border-bolt-elements-borderColor',
                'text-bolt-elements-textPrimary',
                'focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500',
                'hover:border-bolt-elements-borderColorAccent'
              )}
            >
              <option value="">Select an application type...</option>
              {APPLICATION_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Business Type */}
          <div>
            <label htmlFor="businessType" className="block text-sm font-medium text-bolt-elements-textPrimary mb-3">
              What type of business or organization is this for?
            </label>
            <select
              id="businessType"
              value={selectedBusinessType}
              onChange={e => setSelectedBusinessType(e.target.value)}
              className={classNames(
                'w-full px-4 py-3 rounded-lg border transition-all duration-200',
                'bg-bolt-elements-background-depth-3 border-bolt-elements-borderColor',
                'text-bolt-elements-textPrimary',
                'focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500',
                'hover:border-bolt-elements-borderColorAccent'
              )}
            >
              <option value="">Select a business type...</option>
              {BUSINESS_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Additional Details */}
          <div>
            <label
              htmlFor="additionalDetails"
              className="block text-sm font-medium text-bolt-elements-textPrimary mb-3"
            >
              Additional details or specific features (optional)
            </label>
            <textarea
              id="additionalDetails"
              value={additionalDetails}
              onChange={e => setAdditionalDetails(e.target.value)}
              placeholder="e.g., with user authentication, payment integration, mobile responsive design..."
              rows={3}
              className={classNames(
                'w-full px-4 py-3 rounded-lg border transition-all duration-200',
                'bg-bolt-elements-background-depth-3 border-bolt-elements-borderColor',
                'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                'focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500',
                'hover:border-bolt-elements-borderColorAccent',
                'resize-none'
              )}
            />
          </div>
        </div>
      </div>

      {/* Generated Prompt Preview */}
      {canProceed && (
        <div className="bg-bolt-elements-background-depth-3 p-4 rounded-lg border border-bolt-elements-borderColor mb-8">
          <h3 className="font-semibold text-bolt-elements-textPrimary mb-2">Generated Prompt</h3>
          <p className="text-sm text-bolt-elements-textSecondary bg-bolt-elements-background-depth-4 p-3 rounded border border-bolt-elements-borderColor">
            {constructPrompt()}
          </p>
        </div>
      )}

      {/* Action Button */}
      <div className="text-center">
        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className={classNames(
            'flex items-center gap-2 px-8 py-3 rounded-lg font-medium transition-all duration-200',
            canProceed
              ? 'bg-accent-500 text-white hover:bg-accent-600'
              : 'bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary cursor-not-allowed'
          )}
        >
          <div className="i-ph:arrow-right"></div>
          Proceed to Solution Design
        </button>
      </div>
    </div>
  );
};
