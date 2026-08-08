const { resolve } = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const browserRoot = resolve(".localbuddy", "package-cache", "ms-playwright");

module.exports = {
  outDir: resolve(".localbuddy", "forge-out"),
  packagerConfig: {
    name: "LocalBuddy",
    executableName: "LocalBuddy",
    appBundleId: "com.diantou.localbuddy",
    appCategoryType: "public.app-category.developer-tools",
    asar: true,
    prune: true,
    osxSign: {
      identity: "-",
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      continueOnError: false,
      optionsForFile: () => ({ timestamp: "none", hardenedRuntime: false }),
    },
    extraResource: [browserRoot],
    ignore: [
      /^\/\.localbuddy(?:\/|$)/,
      /^\/(?:desktop|docs|fixtures|scripts|src|test)(?:\/|$)/,
      /^\/dist\/test(?:\/|$)/,
      /(?:\.map|\.d\.ts|\.d\.cts)$/,
      /^\/(?:AGENTS\.md|README\.md|tsconfig(?:\.renderer)?\.json|vite\.config\.ts|forge\.config\.cjs|pnpm-lock\.yaml|\.env\.example|\.npmrc)$/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "LocalBuddy",
        setupExe: "LocalBuddy-Setup.exe",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          maintainer: "Diantou Education",
          homepage: "https://github.com/diantou-edu",
          categories: ["Development"],
        },
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
    }),
  ],
};
