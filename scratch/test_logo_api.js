(async () => {
  try {
    const res = await fetch('http://localhost:3000/api/company-settings/1');
    const json = await res.json();
    console.log('API /api/company-settings/1 settings:', json.settings);
    
    // Check if the logo image path is served properly via http://localhost:3000
    const logoUrl = json.settings.CompanyLogoUrl;
    console.log('CompanyLogoUrl:', logoUrl);

    if (logoUrl) {
      const fullLogoUrl = logoUrl.startsWith('http') ? logoUrl : `http://localhost:3000${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
      console.log('Testing fetching image from:', fullLogoUrl);
      const imgRes = await fetch(fullLogoUrl);
      console.log('Logo HTTP status:', imgRes.status, imgRes.headers.get('content-type'));
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
