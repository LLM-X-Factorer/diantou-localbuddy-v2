# LocalBuddy brand icon

The mark combines a gently nodding human profile with three connected nodes: Diantou identity plus local multi-Agent collaboration. It replaces the generic Electron package icon and the earlier `LB` text placeholder without borrowing V1, Craft Agents, or WorkBuddy assets.

## Palette

- Diantou navy: `#0A3472`
- Diantou yellow: `#FFC107`
- Small white motion accents only

## Assets

- `localbuddy-icon.png`: 1024 x 1024 RGBA master and Linux package icon.
- `localbuddy-icon.icns`: macOS app/Dock icon.
- `localbuddy-icon.ico`: Windows app and Setup icon with 16, 24, 32, 48, 64, 128, and 256 px entries.

`forge.config.cjs` selects the native format by build host. Electron Packager currently copies the selected macOS asset into the bundle as `Contents/Resources/electron.icns`; its bytes must match `localbuddy-icon.icns`. The Renderer imports the PNG master and uses it as a decorative mark next to the visible `LocalBuddy` product name.

The master was AI-assisted through the built-in image generation path, then chroma-keyed to alpha and deterministically resized. Keep the strong silhouette, exactly three collaboration nodes, deep-blue/yellow palette, generous padding, and no embedded text when producing future variants.
