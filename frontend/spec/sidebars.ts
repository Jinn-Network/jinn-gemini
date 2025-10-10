import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // Manually defined sidebar for the Jinn Project Specification
  specSidebar: [
    {
      type: 'category',
      label: 'Overview',
      collapsed: false,
      items: [
        'introduction',
        'principles-and-vision',
        'about-us',
      ],
    },
    {
      type: 'category',
      label: 'MVP',
      collapsed: false,
      items: [
        'demo-application',
        {
          type: 'doc',
          id: 'mvp-spec',
          label: 'Spec'
        },
      ],
    },
    {
      type: 'category',
      label: 'Platform',
      collapsed: false,
      items: [
        'product-overview',
        'technical-architecture',
        'research-questions',
      ],
    },
    'roadmap',
    {
      type: 'category',
      label: 'Code Spec',
      collapsed: false,
      items: [
        'code-spec/spec',
        'code-spec/VIOLATIONS',
        'code-spec/USAGE',
      ],
    },
  ],
};

export default sidebars;
