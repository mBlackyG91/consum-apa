// =====================================================================
//  CONFIGURARE — singurul loc din cod unde trebuie să modifici ceva.
// =====================================================================
//  GOOGLE_CLIENT_ID: îl obții din Google Cloud Console (vezi README.md,
//  pasul 4). Arată ca: 1234567890-abc123def456.apps.googleusercontent.com
//  Client ID-ul NU este secret: este normal să stea într-un depozit public.
// =====================================================================
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: '400632947377-fce33mvbb5co4jditm9nn6ee04v5ec0g.apps.googleusercontent.com',

  // Numele fișierului de date din Google Drive.
  DRIVE_FILE_NAME: 'evidenta-apa.json',

  // Întârzierea (ms) după ultima modificare înainte de salvarea în Drive.
  SAVE_DEBOUNCE_MS: 2000,
};
