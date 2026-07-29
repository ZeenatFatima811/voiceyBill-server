import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import importPlugin from "eslint-plugin-import";
import n from "eslint-plugin-n";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ["src/**/*.ts"],

    plugins: {
      import: importPlugin,
      n,
    },

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",

      globals: {
        ...globals.node,
        ...globals.es2022,
      },

      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      //Unused variables 
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // TypeScript strictness 
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Import order 
      "no-duplicate-imports": "error",
      "import/no-self-import": "error",
      "import/no-cycle": "warn",
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // Node.js
      "n/no-missing-import": "off",
      "n/no-unsupported-features/es-syntax": [
        "error",
        { version: ">=20.0.0", ignores: ["modules"] },
      ],
      "no-process-exit": "error",

      //  Code quality 
      
      "no-multi-assign": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-return-await": "error",
      "prefer-const": "error",
      "no-var": "error",
      curly: ["off", "all"],
      "object-shorthand": ["error", "always"],
      "no-throw-literal": "error",
    },
  },

  {
    files: ["src/seeds/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-process-exit": "off",
    },
  },

  {
    // The e2e suite. Without this block the test files only pick up the
    // `recommended` presets, where the two rules below are errors rather than
    // the warnings the src block sets.
    files: ["test/**/*.ts"],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        project: "./test/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // The suite stubs modules by seeding `require.cache`, so several imports
      // must happen lazily and in a specific order — `src/main.ts` in particular
      // cannot be loaded until the stubs are in place. Hoisted ES imports would
      // defeat that, so `require` is deliberate here, not legacy style.
      "@typescript-eslint/no-require-imports": "off",

      // A decoded JSON response body has no static shape. Typing it precisely
      // would force a cast at every one of the assertions and make the specs
      // harder to read than the thing they are checking.
      "@typescript-eslint/no-explicit-any": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
);