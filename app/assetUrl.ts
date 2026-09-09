declare const __ATLAS_BASE_PATH__: string;

const configuredBasePath =
  typeof __ATLAS_BASE_PATH__ === "string" ? __ATLAS_BASE_PATH__ : "/";
const basePath = configuredBasePath.endsWith("/")
  ? configuredBasePath
  : `${configuredBasePath}/`;

export function atlasAssetUrl(path: string): string {
  return `${basePath}${path.replace(/^\/+/, "")}`;
}
