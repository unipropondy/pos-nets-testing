const { invalidateCache, getCompanySettings } = require('../backend/utils/settingsCache');

(async () => {
  try {
    invalidateCache();
    const s = await getCompanySettings();
    console.log('CompanySettings CompanyLogoUrl:', s ? s.CompanyLogoUrl : null);
    console.log('Full CompanySettings:', s);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
