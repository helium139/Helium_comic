module.exports = {
  parserOptions: {ecmaVersion: 2022, sourceType: "module"},
  env: {es2022: true, node: true},
  globals: {fetch: "readonly", AbortSignal: "readonly"},
  rules: {"require-jsdoc": "off", "max-len": "off"},
};
