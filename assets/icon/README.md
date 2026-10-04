# OpenTypora application icon

The project uses the user-selected dark green serif **M** on a white paper tile.
`opentypora.png` is the original image generated with the built-in imagegen tool.
The image is distributed under the project's MIT license.

Run `npm run build:icons` to export the runtime and Windows assets without changing
the original artwork:

- `public/app-icon.png`: 256px image for the application window, UI and READMEs.
- `public/favicon.png`: 64px browser icon.
- `build/icon.ico`: 16, 20, 24, 32, 40, 48, 64, 128 and 256px frames for Windows
  application, installer and uninstaller resources.

The exporter uses Electron's native image resizing and preserves transparency.
Executable resource editing is enabled separately from code signing; current
builds remain unsigned.

The generation prompt and style-reference description are recorded in `design.json`.
