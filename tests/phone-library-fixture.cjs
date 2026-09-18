'use strict';
// Boundary adapter only: the real npm implementation expects same-realm options.
const library = require('libphonenumber-js/max');
module.exports = { parsePhoneNumberFromString(text, options) {
  return library.parsePhoneNumberFromString(text, JSON.parse(JSON.stringify(options)));
} };
