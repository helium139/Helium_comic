const {defineBoolean} = require("firebase-functions/params");
// Opt-in only at the coordinated authority cutover; no production flag changed.
exports.enforceCurrentAuthority = defineBoolean("ENFORCE_CURRENT_AUTHORITY", {
  default: false,
});
