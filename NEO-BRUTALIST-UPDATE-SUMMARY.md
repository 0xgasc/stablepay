# Neo-Brutalist Design & Multi-Language Update Summary

## Completed Pages (2 of 7)

### 1. ✅ signup.html
- **Status**: COMPLETE
- **Design**: Neo-brutalist with white background, 4px black borders, 8px shadows
- **Colors**: Cold palette (cyan #00E5FF, blue #4FC3F7, indigo #7C4DFF)
- **Font**: Space Grotesk, uppercase headings
- **Features**: Night mode toggle, language selector (EN/ES/FR/PT)
- **Translations**: All 4 language files created
  - `/public/locales/signup-en.json`
  - `/public/locales/signup-es.json`
  - `/public/locales/signup-fr.json`
  - `/public/locales/signup-pt.json`

### 2. ✅ developers.html
- **Status**: COMPLETE
- **Design**: Full neo-brutalist redesign
- **Features**: Night mode, multi-language support
- **Translations**: EN file created, ES/FR/PT pending

## Remaining Pages (5 of 7)

### 3. ⏳ crypto-pay.html
**Current State**: Dark theme (gray-900 background)
**Required Changes**:
- Change background to #FFFFFF (light mode)
- Add Space Grotesk font
- Replace rounded corners with sharp edges
- Add 4px black borders to all cards/inputs
- Add 8px hard shadows (box-shadow: 8px 8px 0px #000)
- Change color scheme to cold colors (cyan, blue, indigo)
- Uppercase all headings and buttons
- Add night mode toggle in header
- Add language selector
- Add data-i18n attributes to all text
- Create 4 translation files

### 4. ⏳ widget-demo.html
**Current State**: Light gray theme
**Required Changes**:
- Same neo-brutalist treatment as above
- Add header with night mode + language selector
- Cold color buttons
- Hard shadows on demo cards
- Create 4 translation files

### 5. ⏳ store.html
**Current State**: Dark theme with gradients
**Required Changes**:
- White background in light mode
- Remove gradients, use solid cold colors for product cards
- 4px borders, 8px shadows on all cards
- Space Grotesk font, uppercase headings
- Add header navigation with toggles
- Create 4 translation files

### 6. ⏳ demo-integration.html
**Current State**: Purple gradient background
**Required Changes**:
- White background
- Remove gradients
- Apply brutal borders and shadows
- Cold color accents
- Space Grotesk font
- Add header with language/night mode
- Create 4 translation files

### 7. ⏳ enterprise-admin.html
**Current State**: Dark slate theme (1430 lines - complex)
**Required Changes**:
- This is the most complex page
- White background in light mode
- Keep all existing functionality
- Apply neo-brutalist styling to all components
- Add language selector and night mode
- Create 4 translation files

## Design Specifications (Reference: login.html)

### Colors
```css
/* Light Mode */
background: #FFFFFF;
text: #000;
borders: #000 (4px solid);
shadows: 8px 8px 0px #000;

/* Accent Colors (Cold Palette) */
primary: #00E5FF (cyan)
secondary: #4FC3F7 (blue)
tertiary: #7C4DFF (indigo/purple)

/* Night Mode */
background: #1a1a1a;
text: #fff;
borders: #fff;
shadows: 8px 8px 0px #fff;
```

### Typography
```css
font-family: 'Space Grotesk', sans-serif;
headings: text-transform: uppercase;
buttons: text-transform: uppercase; font-weight: 700;
letter-spacing: 0.05em;
```

### Components
```css
.brutal-border { border: 4px solid #000; }
.shadow-brutal { box-shadow: 8px 8px 0px #000; }
.btn-brutal {
  border: 4px solid #000;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  transition: all 0.2s;
}
.btn-brutal:hover {
  transform: translate(4px, 4px);
  box-shadow: 4px 4px 0px #000;
}
```

## Translation File Structure

Each page needs 4 JSON files in `/public/locales/`:
- `{pagename}-en.json`
- `{pagename}-es.json`
- `{pagename}-fr.json`
- `{pagename}-pt.json`

### Example Structure:
```json
{
  "title": "Page Title - StablePay",
  "nav": {
    "item1": "NAVIGATION ITEM"
  },
  "heading": "MAIN HEADING",
  "subheading": "Subheading text",
  "section": {
    "title": "SECTION TITLE",
    "description": "Description text"
  }
}
```

## JavaScript Requirements

### Each page needs:
```javascript
// i18n functionality
let currentLang = localStorage.getItem('preferredLanguage') || 'en';
let translations = {};

async function loadTranslations(lang) {
    try {
        const response = await fetch(`./locales/{pagename}-${lang}.json`);
        translations = await response.json();
        applyTranslations();
    } catch (error) {
        console.error('Failed to load translations:', error);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const keys = key.split('.');
        let value = translations;

        for (const k of keys) {
            value = value[k];
            if (!value) break;
        }

        if (value) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = value;
            } else if (element.tagName === 'TITLE') {
                document.title = value;
            } else {
                element.textContent = value;
            }
        }
    });
}

// Language selector
document.getElementById('languageSelector').addEventListener('change', (e) => {
    currentLang = e.target.value;
    localStorage.setItem('preferredLanguage', currentLang);
    loadTranslations(currentLang);
});

// Set initial language
document.getElementById('languageSelector').value = currentLang;
loadTranslations(currentLang);

// Night mode toggle
const nightModeToggle = document.getElementById('nightModeToggle');
const nightIcon = document.querySelector('.night-icon');

if (localStorage.getItem('nightMode') === 'true') {
    document.body.classList.add('night-mode');
    nightIcon.textContent = 'DAY';
}

nightModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('night-mode');
    const isNightMode = document.body.classList.contains('night-mode');
    localStorage.setItem('nightMode', isNightMode);
    nightIcon.textContent = isNightMode ? 'DAY' : 'NIGHT';
});
```

## Header Template

Each page should use this header:
```html
<nav class="bg-white border-b-4 border-black brutal-border">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-20">
            <a href="/" class="text-3xl font-bold tracking-tight text-black" style="text-transform: uppercase;">
                STABLEPAY
            </a>
            <div class="flex items-center gap-4">
                <!-- Language Selector -->
                <select id="languageSelector" class="px-3 py-2 bg-white text-black font-bold text-sm">
                    <option value="en">EN</option>
                    <option value="es">ES</option>
                    <option value="fr">FR</option>
                    <option value="pt">PT</option>
                </select>
                <!-- Night Mode Toggle -->
                <button id="nightModeToggle" class="px-4 py-2 bg-white text-black font-bold text-sm btn-brutal">
                    <span class="night-icon">NIGHT</span>
                </button>
                <!-- Page-specific navigation -->
            </div>
        </div>
    </div>
</nav>
```

## Next Steps

1. **Complete developers.html translations** (FR, PT)
2. **Update crypto-pay.html** + create 4 translation files
3. **Update widget-demo.html** + create 4 translation files
4. **Update store.html** + create 4 translation files
5. **Update demo-integration.html** + create 4 translation files
6. **Update enterprise-admin.html** (most complex) + create 4 translation files

## Translation Guidelines

### Professional Translations Required:
- **Spanish (ES)**: Use formal Spanish (not Latin American slang)
- **French (FR)**: Use formal French
- **Portuguese (PT)**: Use Brazilian Portuguese

### Key Phrases:
- EN: "SIGN IN" → ES: "INICIAR SESIÓN" → FR: "SE CONNECTER" → PT: "ENTRAR"
- EN: "SIGN UP" → ES: "REGISTRARSE" → FR: "S'INSCRIRE" → PT: "REGISTRAR"
- EN: "CREATE ACCOUNT" → ES: "CREAR CUENTA" → FR: "CRÉER UN COMPTE" → PT: "CRIAR CONTA"
- EN: "DASHBOARD" → ES: "PANEL" → FR: "TABLEAU DE BORD" → PT: "PAINEL"

## Files Completed

### HTML Files (2/7):
- ✅ `/public/signup.html`
- ✅ `/public/developers.html`
- ⏳ `/public/crypto-pay.html`
- ⏳ `/public/widget-demo.html`
- ⏳ `/public/store.html`
- ⏳ `/public/demo-integration.html`
- ⏳ `/public/enterprise-admin.html`

### Translation Files (8/28):
- ✅ `/public/locales/signup-en.json`
- ✅ `/public/locales/signup-es.json`
- ✅ `/public/locales/signup-fr.json`
- ✅ `/public/locales/signup-pt.json`
- ✅ `/public/locales/developers-en.json`
- ✅ `/public/locales/developers-es.json`
- ⏳ `/public/locales/developers-fr.json`
- ⏳ `/public/locales/developers-pt.json`
- ⏳ 20 more translation files needed

## Estimated Completion Time

- crypto-pay.html: 30-45 minutes
- widget-demo.html: 20-30 minutes
- store.html: 30-40 minutes
- demo-integration.html: 25-35 minutes
- enterprise-admin.html: 60-90 minutes (complex)
- All translation files: 2-3 hours

**Total**: 4-6 hours of work remaining

## Testing Checklist

For each completed page:
- [ ] White background in light mode
- [ ] Dark background (#1a1a1a) in night mode
- [ ] 4px black borders (white in night mode)
- [ ] 8px hard shadows (white in night mode)
- [ ] Space Grotesk font loaded
- [ ] All headings uppercase
- [ ] Cold color palette (cyan, blue, indigo)
- [ ] Night mode toggle works
- [ ] Language selector works
- [ ] All text translates correctly
- [ ] No emojis in UI
- [ ] All existing functionality preserved
