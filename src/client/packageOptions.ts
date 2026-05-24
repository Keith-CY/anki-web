export interface ImportPackageOptions {
  includeScheduling: boolean;
}

export interface ExportPackageOptions {
  includeMedia: boolean;
  includeScheduling: boolean;
  legacySupport: boolean;
}

export const defaultImportPackageOptions: ImportPackageOptions = {
  includeScheduling: false
};

export const defaultExportPackageOptions: ExportPackageOptions = {
  includeMedia: true,
  includeScheduling: false,
  legacySupport: true
};

export function importPackagePayload(url: string, options: ImportPackageOptions) {
  return {
    url,
    includeScheduling: options.includeScheduling
  };
}

export function exportPackagePayload(options: ExportPackageOptions) {
  return {
    includeMedia: options.includeMedia,
    includeScheduling: options.includeScheduling,
    legacySupport: options.legacySupport
  };
}

export function exportPackageExtension(options: Pick<ExportPackageOptions, "legacySupport">) {
  return options.legacySupport ? "apkg" : "colpkg";
}

export function exportPackageFileName(baseName: string, options: Pick<ExportPackageOptions, "legacySupport">) {
  return `${baseName}.${exportPackageExtension(options)}`;
}

export function exportPackageTitle(action: string, options: Pick<ExportPackageOptions, "legacySupport">) {
  return `${action} as .${exportPackageExtension(options)}`;
}
