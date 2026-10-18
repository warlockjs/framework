/** Bundled create-warlock snapshots. oxc-toolchain.spec.ts checks template parity. */
export const TOOLCHAIN_TEMPLATES: Readonly<Record<string, string>> = {
  "legacy-eslint.config.js": `import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  // Global configuration
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Node.js globals
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        // ES2021 globals
        Promise: "readonly",
        // Jest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
  },

  // TypeScript files configuration
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      prettier: prettierPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      // Prettier integration
      ...prettierConfig.rules,
      "prettier/prettier": "error",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "explicit" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          disallowTypeAnnotations: false,
        },
      ],
    },
  },

  // Ignore patterns
  {
    ignores: [
      "dist/",
      "node_modules/",
      "**/*.js",
      "!**/*.config.js",
      "!eslint.config.js",
    ],
  },
];
`,
  "legacy-prettierignore": `node_modules
dist


`,
  "legacy-prettierrc.json": `{
  "semi": true,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": false,
  "arrowParens": "always",
  "trailingComma": "all",
  "endOfLine": "lf",
  "plugins": ["@ianvs/prettier-plugin-sort-imports"],
  "importOrder": ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^(app|web|@shared)/", "^[.]"],
  "importOrderParserPlugins": ["typescript", "jsx", "decorators"]
}
`,
  "legacy-vscode-settings.json": `{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "never"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[javascriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[json]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "[css]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "prettier.configPath": ".prettierrc.json",
  "prettier.requireConfig": true,
  "prettier.ignorePath": ".prettierignore",
  "prettier.documentSelectors": ["**/*.{ts,tsx,js,jsx,json,css,md}"],
  "prettier.enable": true,
  "prettier.useEditorConfig": false,
  "prettier.resolveGlobalModules": false,
  "eslint.format.enable": false,
  "eslint.codeActionsOnSave.mode": "all"
}
`,
  "oxc-vscode-settings.json": `{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.oxc": "explicit",
    "source.organizeImports": "never"
  },
  "[typescript]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "[javascript]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "[javascriptreact]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "[json]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "[css]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  },
  "oxc.enable.oxlint": true,
  "oxc.enable.oxfmt": true,
  "oxc.requireConfig": true
}
`,
  "oxfmtrc.json": `{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "semi": true,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": false,
  "arrowParens": "always",
  "trailingComma": "all",
  "endOfLine": "lf",
  "sortImports": {
    "newlinesBetween": false,
    "internalPattern": ["app/", "web/", "@shared/"]
  },
  "ignorePatterns": ["node_modules/", "dist/"]
}
`,
  "oxlintrc.json": `{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "import", "react"],
  "env": { "node": true, "es2021": true },
  "categories": { "correctness": "off" },
  "rules": {
    "typescript/no-explicit-any": "off",
    "no-unused-vars": [
      "warn",
      {
        "vars": "all",
        "varsIgnorePattern": "^_",
        "args": "after-used",
        "argsIgnorePattern": "^_"
      }
    ],
    "typescript/explicit-member-accessibility": ["error", { "accessibility": "explicit" }],
    "typescript/consistent-type-imports": [
      "error",
      { "prefer": "type-imports", "disallowTypeAnnotations": false }
    ]
  },
  "ignorePatterns": ["node_modules/", "dist/"]
}
`,
};
