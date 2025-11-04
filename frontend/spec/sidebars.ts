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
    'introduction',
    {
      type: 'category',
      label: 'Blueprint',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'blueprint/index',
          label: 'Overview',
        },
        'blueprint/constitution',
        'blueprint/vision',
        'blueprint/requirements',
      ],
    },
    {
      type: 'category',
      label: 'Documentation',
      collapsed: false,
      link: {
        type: 'doc',
        id: 'documentation/index',
      },
      items: [
        'documentation/product-overview',
        'documentation/protocol-model',
      ],
    },
    'roadmap',
    'about-us',
  ],
};

export default sidebars;
