# Chrome Extension Install (Unpacked)

## 1) Build extension assets

```bash
cd ExportChatGPT
pnpm install
pnpm --filter @project-archivist/extension build
```

## 2) Load unpacked in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/extension/dist`

## 3) Use on ChatGPT

1. Open `https://chatgpt.com` (or `https://chat.openai.com`)
2. Open the extension side panel
3. Click **Request ChatGPT permission** if prompted
4. Use capture/scan/export buttons

## 4) Import captured bundle into desktop app

- Export bundle from extension
- Open desktop app Import screen
- Import the bundle JSON
