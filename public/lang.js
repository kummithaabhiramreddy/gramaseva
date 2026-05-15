/**
 * GramaSeva - Shared Language Engine
 * Reads preferred language from localStorage and applies it to any page.
 * Include this script in every HTML page after the DOM is defined.
 */

window.GS_Lang = (function () {
  let currentLang = localStorage.getItem('gramaseva_lang') || 'en';

  /* ── TRANSLATIONS ─────────────────────────────────────────────
     Add all common text used across pages here.
     Page-specific strings can be added via GS_Lang.register().
  ────────────────────────────────────────────────────────────── */
  const T = {
    // ── NAV ──────────────────────────────────────────────────────
    nav_home:        { en: 'Home',             te: 'హోమ్' },
    nav_dashboard:   { en: 'My Dashboard',     te: 'నా డాష్‌బోర్డ్' },
    nav_register:    { en: 'Register Worker',  te: 'కార్మికుడిగా నమోదు' },
    nav_find:        { en: 'Find Workers',     te: 'కార్మికులను కనుగొనండి' },
    nav_subtitle:    { en: 'Village Worker Connect', te: 'గ్రామ కార్మిక సేవ' },

    // ── LANG TOGGLE ───────────────────────────────────────────────
    lang_en:  { en: 'EN',  te: 'EN' },
    lang_te:  { en: 'తె',  te: 'తె' },

    // ── DASHBOARD LOGIN ───────────────────────────────────────────
    dash_welcome_title:  { en: 'Welcome to Your Dashboard',       te: 'మీ డాష్‌బోర్డ్‌కు స్వాగతం' },
    dash_welcome_desc:   { en: 'Enter your registered phone number to view your profile, incoming jobs, and service requests.', te: 'మీ ప్రొఫైల్, వచ్చే పనులు మరియు సేవా అభ్యర్థనలను చూడటానికి మీ నమోదిత ఫోన్ నంబర్ నమోదు చేయండి.' },
    dash_verify_btn:     { en: 'Verify Phone Number',             te: 'ఫోన్ నంబర్ ధృవీకరించండి' },
    dash_unlock_desc:    { en: 'Click below to unlock your code on this screen using WhatsApp.', te: 'WhatsApp ద్వారా మీ కోడ్ అన్‌లాక్ చేయడానికి క్లింద నొక్కండి.' },
    dash_unlock_btn:     { en: '📩 Unlock Code via WhatsApp',     te: '📩 WhatsApp ద్వారా కోడ్ పొందండి' },
    dash_otp_sent:       { en: '✅ OTP sent to your number!',     te: '✅ OTP మీ నంబర్‌కు పంపబడింది!' },
    dash_otp_placeholder:{ en: 'Enter 4-Digit OTP',               te: '4-అంకె OTP నమోదు చేయండి' },
    dash_access_btn:     { en: 'Access My Dashboard',             te: 'నా డాష్‌బోర్డ్ తెరవండి' },
    dash_change_num:     { en: 'Change Number',                   te: 'నంబర్ మార్చండి' },
    dash_no_account:     { en: "Don't have an account?",          te: 'ఖాతా లేదా?' },
    dash_register_link:  { en: 'Register as Worker',              te: 'కార్మికుడిగా నమోదు' },

    // ── DASHBOARD SECTIONS ────────────────────────────────────────
    dash_your_hub:       { en: 'Your Personal Hub',              te: 'మీ వ్యక్తిగత కేంద్రం' },
    dash_my_dash:        { en: 'My Dashboard',                   te: 'నా డాష్‌బోర్డ్' },
    dash_viewing_for:    { en: 'Viewing data for:',              te: 'డేటా చూస్తున్నారు:' },
    dash_logout:         { en: '[Logout / Change]',              te: '[లాగ్‌అవుట్ / మార్చండి]' },
    dash_book_new:       { en: '+ Book New Service',             te: '+ కొత్త సేవ బుక్ చేయండి' },

    // ── SIDEBAR ───────────────────────────────────────────────────
    sidebar_profile:       { en: 'My Profile',            te: 'నా ప్రొఫైల్' },
    sidebar_profile_sub:   { en: 'View details & verify', te: 'వివరాలు & ధృవీకరణ' },
    sidebar_incoming:      { en: 'Incoming Jobs',          te: 'వచ్చే పనులు' },
    sidebar_incoming_sub:  { en: 'Customers who booked you', te: 'మీకు బుక్ చేసిన వినియోగదారులు' },
    sidebar_requests:      { en: 'My Requests',            te: 'నా అభ్యర్థనలు' },
    sidebar_requests_sub:  { en: 'Workers you have booked', te: 'మీరు బుక్ చేసిన కార్మికులు' },
    sidebar_finance:       { en: 'Platform Funds',         te: 'నిధి వివరాలు' },
    sidebar_finance_sub:   { en: 'Live money & welfare',   te: 'నిధులు & సంక్షేమం' },
    sidebar_earnings:      { en: 'My Earnings History',    te: 'నా సంపాదన చరిత్ర' },
    sidebar_earnings_sub:  { en: 'Detailed ledger of your work', te: 'వివరణాత్మక పని రికార్డు' },
    sidebar_register_new:  { en: 'Register New',           te: 'కొత్తగా నమోదు' },
    sidebar_find_workers:  { en: 'Find Workers',           te: 'కార్మికులను కనుగొనండి' },

    // ── DASHBOARD EMPTY STATES ────────────────────────────────────
    empty_not_worker:      { en: 'Not a Registered Worker',    te: 'నమోదిత కార్మికుడు కాదు' },
    empty_not_worker_desc: { en: "You don't have a worker profile yet. Register to start accepting jobs.", te: 'మీకు ఇంకా కార్మిక ప్రొఫైల్ లేదు. పనులు స్వీకరించడానికి నమోదు చేసుకోండి.' },
    empty_register_btn:    { en: 'Register as Worker',         te: 'కార్మికుడిగా నమోదు' },
    empty_no_jobs:         { en: 'No Incoming Jobs',           te: 'వచ్చే పనులు లేవు' },
    empty_no_jobs_desc:    { en: "You don't have any job requests from customers right now.", te: 'ప్రస్తుతం మీకు వినియోగదారుల నుండి పని అభ్యర్థనలు లేవు.' },
    empty_no_bookings:     { en: 'No Bookings Found',          te: 'బుకింగ్‌లు కనుగొనబడలేదు' },
    empty_no_bookings_desc:{ en: "You haven't booked any workers yet.", te: 'మీరు ఇంకా కార్మికులను బుక్ చేయలేదు.' },
    empty_find_book:       { en: 'Find & Book Workers',        te: 'కార్మికులను కనుగొని బుక్ చేయండి' },
    empty_no_earnings:     { en: 'No Earnings Yet',            te: 'ఇంకా సంపాదన లేదు' },
    empty_no_earnings_desc:{ en: 'Complete your first job to see your earnings history here.', te: 'మీ మొదటి పని పూర్తి చేయండి.' },

    // ── SECTION HEADINGS ──────────────────────────────────────────
    section_incoming_jobs: { en: 'Incoming Job Requests',    te: 'వచ్చే పని అభ్యర్థనలు' },
    section_my_requests:   { en: 'My Service Requests',      te: 'నా సేవా అభ్యర్థనలు' },
    section_earnings:      { en: 'My Earnings History',      te: 'నా సంపాదన చరిత్ర' },
    section_kyc:           { en: '🔐 Aadhaar KYC Verification', te: '🔐 ఆధార్ KYC ధృవీకరణ' },

    // ── BOOKING PAGE ──────────────────────────────────────────────
    book_title:         { en: 'Book a Service',              te: 'సేవ బుక్ చేయండి' },
    book_step1:         { en: 'Step 1: Your Details',        te: 'దశ 1: మీ వివరాలు' },
    book_step2:         { en: 'Step 2: Service Date',        te: 'దశ 2: సేవ తేదీ' },
    book_step3:         { en: 'Step 3: Select Pricing Option', te: 'దశ 3: ధర ఎంచుకోండి' },
    book_confirm:       { en: 'Confirm Booking',             te: 'బుకింగ్ నిర్ధారించండి' },
    book_your_name:     { en: 'Your Name',                   te: 'మీ పేరు' },
    book_phone:         { en: 'Your Phone Number',           te: 'మీ ఫోన్ నంబర్' },
    book_address:       { en: 'Your Address & Landmark',     te: 'మీ చిరునామా & గుర్తింపు' },
    book_village:       { en: 'Village Name',                te: 'గ్రామం పేరు' },
    book_service_date:  { en: 'Date for Service',            te: 'సేవ తేదీ' },
    btn_location:       { en: '📍 Get Live Location',        te: '📍 లైవ్ లొకేషన్ పొందండి' },

    // ── REGISTER PAGE ─────────────────────────────────────────────
    reg_title:         { en: 'Worker Registration',          te: 'కార్మిక నమోదు' },
    reg_individual:    { en: 'Individual',                   te: 'వ్యక్తిగత' },
    reg_group:         { en: 'Group',                        te: 'గ్రూపు' },
    reg_submit_ind:    { en: '✅ Complete Registration →',   te: '✅ నమోదు పూర్తి చేయండి →' },
    reg_submit_grp:    { en: '✅ Complete Group Registration →', te: '✅ గ్రూపు నమোదు పూర్తి చేయండి →' },
  };

  /* ── APPLY TRANSLATIONS ──────────────────────────────────────── */
  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem('gramaseva_lang', lang);

    // 1. data-en / data-te attributes
    document.querySelectorAll('[data-en]').forEach(el => {
      const text = el.getAttribute('data-' + lang);
      if (!text) return;
      if (text.includes('<')) el.innerHTML = text;
      else el.textContent = text;
    });

    // 2. data-placeholder-en / data-placeholder-te attributes
    document.querySelectorAll('[data-placeholder-en]').forEach(el => {
      const ph = el.getAttribute('data-placeholder-' + lang);
      if (ph) el.placeholder = ph;
    });

    // 3. data-gs-key attributes (look up from T table)
    document.querySelectorAll('[data-gs-key]').forEach(el => {
      const key = el.getAttribute('data-gs-key');
      if (T[key] && T[key][lang]) {
        const text = T[key][lang];
        if (text.includes('<')) el.innerHTML = text;
        else el.textContent = text;
      }
    });

    // 4. Update toggle buttons if they exist on this page
    const btnEn = document.getElementById('lang-btn-en');
    const btnTe = document.getElementById('lang-btn-te');
    if (btnEn) btnEn.classList.toggle('active', lang === 'en');
    if (btnTe) btnTe.classList.toggle('active', lang === 'te');

    // 5. Update html lang attribute
    document.documentElement.lang = lang === 'te' ? 'te' : 'en';
  }

  /* ── PUBLIC API ──────────────────────────────────────────────── */
  return {
    get: () => currentLang,
    set: applyLang,
    t: (key) => (T[key] && T[key][currentLang]) || (T[key] && T[key]['en']) || key,
    init: () => {
      applyLang(localStorage.getItem('gramaseva_lang') || 'en');
    }
  };
})();

/* Auto-init as soon as DOM is ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GS_Lang.init());
} else {
  GS_Lang.init();
}
