const { resolve } = require("node:path");
const { MakerDeb } = require("@electron-forge/maker-deb");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const { version: packageVersion } = require("./package.json");

if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error("package.json contains an invalid package version");
}

const browserRoot = resolve(".localbuddy", "package-cache", "ms-playwright");
const brandIcon = resolve(
  "assets",
  "brand",
  process.platform === "darwin"
    ? "localbuddy-icon.icns"
    : process.platform === "win32"
      ? "localbuddy-icon.ico"
      : "localbuddy-icon.png",
);
const windowsBrandIcon = resolve("assets", "brand", "localbuddy-icon.ico");
const linuxBrandIcon = resolve("assets", "brand", "localbuddy-icon.png");

module.exports = {
  outDir: resolve(".localbuddy", "forge-out"),
  packagerConfig: {
    name: "LocalBuddy",
    executableName: "LocalBuddy",
    appBundleId: "com.diantou.localbuddy",
    appCategoryType: "public.app-category.developer-tools",
    icon: brandIcon,
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
    new MakerZIP({}, ["darwin", "win32"]),
    new MakerSquirrel(
      {
        name: "LocalBuddy",
        setupExe: `LocalBuddy-${packageVersion}-Setup.exe`,
        setupIcon: windowsBrandIcon,
      },
      ["win32"],
    ),
    new MakerDeb(
      {
        options: {
          bin: "LocalBuddy",
          maintainer: "Diantou Education",
          homepage: "https://github.com/LLM-X-Factorer/diantou-localbuddy-v2",
          categories: ["Development"],
          depends: ["libsecret-tools"],
          icon: linuxBrandIcon,
        },
      },
      ["linux"],
    ),
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
