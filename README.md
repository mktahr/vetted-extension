# Vetted LinkedIn Scraper Chrome Extension

A Chrome extension that scrapes LinkedIn profile data and sends it to your recruiting database API.

## Features

- ✅ Scrapes LinkedIn profile data (name, location, experience, education, skills)
- ✅ Manual review and editing interface
- ✅ Tag management (skills, focus areas, excellence, domains)
- ✅ Sends data to your API endpoint
- ✅ Built with TypeScript and Manifest V3

## Installation

### 1. Build the Extension

```bash
npm install
npm run build
```

### 2. Create Icons

You need to create PNG icon files in `dist/icons/`:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

**Option 1: Auto-generate (requires canvas library)**
```bash
npm install canvas
npm run icons
```

**Option 2: Manual creation**
- Use any image editor (Photoshop, GIMP, Figma, etc.)
- Create icons with a LinkedIn blue background (#0077b5) and a "V" or your logo
- Save as PNG files with the exact names above

**Option 3: Use the HTML Icon Generator**
Open `icon-generator.html` in your browser and follow the instructions to generate and download PNG icons.

**Option 4: Convert SVG to PNG**
The build process creates SVG placeholders in `dist/icons/`. You can:
- Use an online SVG to PNG converter
- Use ImageMagick: `convert icon16.svg icon16.png` (repeat for all sizes)

### 3. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist` folder from this project
5. The extension should now appear in your extensions list

## Configuration

### Setting the Ingest Secret

Before using the extension, you need to configure the ingest secret:

1. Click the extension icon to open the popup
2. Click the ⚙️ settings button in the header
3. Enter your `INGEST_SECRET` value (from your Next.js environment variables)
4. Click "Save"

The secret is stored locally in your browser and will be used for all API requests.

## Usage

1. Navigate to any LinkedIn profile page (e.g., `https://www.linkedin.com/in/username`)
2. Click the "📥 Scrape Profile" button that appears on the page
3. The extension badge will show "!" when data is ready
4. Click the extension icon to open the popup with all scraped data
5. Review and edit the data as needed:
   - Add/edit tags (comma-separated)
   - Modify any fields
   - Add notes
6. Click "Send to Database" to submit the data
7. You'll see a success/error message

## API Endpoint

The extension sends data to:
- **URL**: `https://vetted-self.vercel.app/api/ingest`
- **Method**: POST
- **Headers**:
  - `Content-Type: application/json`
  - `x-ingest-secret: <your-secret>` (required)
- **Body**:
  ```json
  {
    "linkedin_url": "https://www.linkedin.com/in/username",
    "raw_json": { /* all scraped data as-is */ },
    "canonical_json": { /* normalized data matching schema */ }
  }
  ```

### API Authentication

The extension includes an `x-ingest-secret` header with each request. Your Next.js API should:

1. Read `process.env.INGEST_SECRET`
2. Compare it with the `x-ingest-secret` header
3. Return `401 Unauthorized` if missing or incorrect

Example Next.js API handler:
```typescript
export async function POST(request: Request) {
  const secret = request.headers.get('x-ingest-secret');
  if (secret !== process.env.INGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  // ... rest of your logic
}
```

### Error Handling

The extension includes:
- **Retry logic**: Automatically retries once on network failures
- **Error logging**: Non-200 responses are logged to the console
- **User feedback**: Clear error messages shown in the popup

## Data Schema

The `canonical_json` follows this schema:

```typescript
{
  linkedin_url: string;
  full_name: string | null;
  location_resolved: string | null;
  current_company: string | null;
  current_title: string | null;
  years_experience: number | null;
  years_at_current_company: number | null;
  undergrad_university: string | null;
  secondary_university: string | null;
  phd_university: string | null;
  skills_tags: string[] | null;
  focus_area_tags: string[] | null;
  excellence_tags: string[] | null;
  domain_tags: string[] | null;
  notes: string | null;
}
```

## Development

### Project Structure

```
vetted-extension/
├── src/
│   ├── types.ts          # TypeScript type definitions
│   ├── content.ts        # Content script for scraping
│   ├── content.css       # Styles for injected button
│   ├── background.ts     # Service worker for API calls
│   ├── popup.html        # Popup UI
│   ├── popup.css         # Popup styles
│   └── popup.ts          # Popup logic
├── dist/                 # Built files (generated)
├── manifest.json         # Extension manifest
├── tsconfig.json         # TypeScript config
└── package.json          # Dependencies
```

### Build Commands

- `npm run build` - Build TypeScript and copy assets
- `npm run watch` - Watch mode for development

### Making Changes

1. Edit files in `src/`
2. Run `npm run build`
3. Reload the extension in Chrome (click the reload icon on `chrome://extensions/`)

## Troubleshooting

### Extension not working on LinkedIn

- Make sure you're on a profile page (`linkedin.com/in/*`)
- Check the browser console for errors (F12)
- Verify the extension is enabled in `chrome://extensions/`

### API calls failing

- Check the network tab in Chrome DevTools
- Verify the API endpoint is accessible
- Check for CORS issues (the extension should bypass CORS)

### Data not scraping correctly

LinkedIn's HTML structure may change. You may need to update the selectors in `src/content.ts` if scraping fails.

## License

MIT

