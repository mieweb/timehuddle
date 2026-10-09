// Build-time stand-in for google-libphonenumber (see vite.config.ts). The app renders
// no country/phone picker, so these are never reached; fail loudly if that changes.
const unavailable = (): never => {
  throw new Error(
    'google-libphonenumber is stubbed out of the bundle — remove the alias in vite.config.ts to use CountryDropdown/CountryCodeDropdown.',
  );
};

export const PhoneNumberUtil = { getInstance: unavailable };
export const PhoneNumberFormat = {};
