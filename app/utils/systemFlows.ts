export interface SystemFlow {
  steps: string[];
  description: string;
}

export const SYSTEM_FLOWS: Record<string, SystemFlow> = {
  'ecommerce site': {
    description: 'Complete e-commerce user journey from browsing to purchase',
    steps: [
      'User Registration/Login',
      'Browse Products/Services',
      'Product Search & Filtering',
      'Add Items to Cart',
      'Review Cart & Checkout',
      'Payment Processing',
      'Order Confirmation',
      'Order Tracking',
      'User Profile Management',
      'Customer Support',
    ],
  },

  blog: {
    description: 'Content-focused platform for articles and reader engagement',
    steps: [
      'User Registration/Login',
      'Browse Articles/Posts',
      'Search & Filter Content',
      'Read Full Articles',
      'Comment & Interact',
      'Share Content',
      'Subscribe to Newsletter',
      'Author Dashboard',
      'Content Management',
      'Analytics & SEO',
    ],
  },

  portfolio: {
    description: 'Personal showcase for skills, projects, and professional information',
    steps: [
      'Homepage Introduction',
      'About Me Section',
      'Skills & Expertise',
      'Project Showcase',
      'Work Experience',
      'Contact Information',
      'Resume Download',
      'Testimonials',
      'Blog/Articles',
      'Social Media Links',
    ],
  },

  dashboard: {
    description: 'Data visualization and management interface',
    steps: [
      'User Authentication',
      'Main Dashboard Overview',
      'Key Metrics Display',
      'Data Visualization',
      'User Management',
      'Settings & Configuration',
      'Reports Generation',
      'Notifications Center',
      'Search & Filter',
      'Export/Import Data',
    ],
  },

  'landing page': {
    description: 'Conversion-focused single page application',
    steps: [
      'Hero Section',
      'Value Proposition',
      'Features Overview',
      'Social Proof',
      'Call-to-Action',
      'Contact Form',
      'FAQ Section',
      'Footer Information',
      'Newsletter Signup',
      'Analytics Tracking',
    ],
  },

  'social media platform': {
    description: 'Community-driven content sharing and networking',
    steps: [
      'User Registration',
      'Profile Creation',
      'Content Creation & Sharing',
      'Feed Browsing',
      'Friend/Connection Management',
      'Messaging System',
      'Notifications',
      'Privacy Settings',
      'Content Moderation',
      'Analytics Dashboard',
    ],
  },

  'learning management system': {
    description: 'Educational platform for course delivery and student management',
    steps: [
      'Student/Teacher Registration',
      'Course Browsing & Enrollment',
      'Learning Dashboard',
      'Video Lessons & Materials',
      'Assignments & Quizzes',
      'Progress Tracking',
      'Discussion Forums',
      'Grade Management',
      'Certificate Generation',
      'Admin Panel',
    ],
  },

  'restaurant website': {
    description: 'Food service platform with ordering and reservation capabilities',
    steps: [
      'Customer Registration',
      'Menu Browsing',
      'Online Ordering',
      'Table Reservations',
      'Payment Processing',
      'Kitchen Order Management',
      'Delivery Tracking',
      'Customer Reviews',
      'Inventory Management',
      'Staff Scheduling',
    ],
  },

  'real estate platform': {
    description: 'Property search and management system',
    steps: [
      'User Registration',
      'Property Search & Filtering',
      'Property Listings',
      'Virtual Tours',
      'Contact Agents',
      'Schedule Viewings',
      'Mortgage Calculator',
      'Saved Properties',
      'Market Analysis',
      'Agent Dashboard',
    ],
  },

  'healthcare portal': {
    description: 'Medical services and patient management system',
    steps: [
      'Patient Registration',
      'Appointment Scheduling',
      'Medical Records Management',
      'Doctor/Staff Dashboard',
      'Prescription Management',
      'Billing & Insurance',
      'Lab Results',
      'Patient Portal',
      'Emergency Contacts',
      'Reporting & Analytics',
    ],
  },

  'booking system': {
    description: 'Appointment and reservation management platform',
    steps: [
      'User Registration',
      'Service/Product Browsing',
      'Availability Check',
      'Booking Selection',
      'Payment Processing',
      'Booking Confirmation',
      'Calendar Management',
      'Reminder Notifications',
      'Cancellation/Rescheduling',
      'Review System',
    ],
  },

  forum: {
    description: 'Community discussion and knowledge sharing platform',
    steps: [
      'User Registration',
      'Browse Categories',
      'Read Discussions',
      'Create New Topics',
      'Reply to Posts',
      'Search Content',
      'User Profiles',
      'Moderation Tools',
      'Notifications',
      'Analytics & Reports',
    ],
  },

  'news website': {
    description: 'Content publishing and news distribution platform',
    steps: [
      'Browse Articles',
      'Category Navigation',
      'Search Functionality',
      'Read Full Articles',
      'Comment System',
      'Newsletter Subscription',
      'Social Sharing',
      'Author Profiles',
      'Content Management',
      'Analytics Dashboard',
    ],
  },

  'job board': {
    description: 'Employment and recruitment platform',
    steps: [
      'User Registration',
      'Job Search & Filtering',
      'Job Listings',
      'Application Process',
      'Resume Upload',
      'Employer Dashboard',
      'Candidate Management',
      'Interview Scheduling',
      'Communication System',
      'Analytics & Reports',
    ],
  },

  marketplace: {
    description: 'Multi-vendor e-commerce and service platform',
    steps: [
      'User Registration',
      'Browse Products/Services',
      'Search & Filter',
      'Product Details',
      'Seller Communication',
      'Transaction Process',
      'Payment Processing',
      'Order Management',
      'Review System',
      'Dispute Resolution',
    ],
  },
};

export const generateSystemFlow = (appType: string, businessType: string): string => {
  const flow = SYSTEM_FLOWS[appType];

  if (flow) {
    return flow.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  }

  // Fallback for unknown application types
  return `1. User Registration
2. Main Dashboard
3. Core Functionality
4. Data Management
5. User Settings
6. Reporting
7. Admin Panel
8. Customer Support
9. Analytics
10. System Maintenance`;
};

export const getSystemFlowDescription = (appType: string): string => {
  return SYSTEM_FLOWS[appType]?.description || 'General application workflow';
};

export const getAvailableApplicationTypes = (): string[] => {
  return Object.keys(SYSTEM_FLOWS);
};
