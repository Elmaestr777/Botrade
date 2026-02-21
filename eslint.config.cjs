module.exports = [
  {
    ignores: [
      "node_modules/**",
      "runs/**",
      ".cache_heaven/**",
      "heaven_opt/**",
      "tools/**",
      "vendor/**"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        LightweightCharts: "readonly",
        self: "readonly",
        importScripts: "readonly"
      }
    },
    rules: {
      eqeqeq: "off",
      curly: ["warn", "all"],
      "no-undef": "off",
      "no-redeclare": "error",
      "prefer-const": "warn",
      "consistent-return": "warn",
      "no-inner-declarations": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-empty-function": "off",
      "no-useless-escape": "off",
      "no-unused-vars": "off"
    }
  },
  {
    files: ["tools/*.js"],
    languageOptions: {
      sourceType: "script"
    }
  },
  {
    files: ["runner/*.js"],
    languageOptions: {
      sourceType: "module"
    }
  }
];
