/** @type {import('typedoc').TypeDocOptions} */
module.exports = {
  entryPoints: ['../src/index.ts'],
  out: 'api',
  plugin: ['typedoc-plugin-markdown'],
  
  // Output configuration
  readme: 'none',
  githubPages: false,
  hideGenerator: true,
  
  // Content configuration
  excludePrivate: true,
  excludeProtected: true,
  excludeInternal: true,
  excludeNotDocumented: false,
  
  // File organization
  outputFileStrategy: 'modules',
  flattenOutputFiles: false,
  fileExtension: '.md',
  entryModule: 'index',
  
  // TypeScript configuration
  tsconfig: '../tsconfig.json',
  exclude: [
    '../src/**/*.test.ts',
    '../src/**/*.spec.ts',
    '../tests/**/*',
    '../node_modules/**/*'
  ],
  
  // Markdown formatting
  hideBreadcrumbs: true,
  hideInPageTOC: false,
  publicPath: '/api/',
  
  // Navigation
  navigation: {
    includeCategories: false,
    includeGroups: true
  },
  
  // Theme customization
  theme: 'markdown',
  
  // Performance
  logLevel: 'Error',
  
  // Custom options for clean output
  sort: ['source-order'],
  kindSortOrder: [
    'Class',
    'Interface', 
    'TypeAlias',
    'Function',
    'Variable'
  ]
};