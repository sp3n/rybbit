import JSZip from "jszip";
import Papa from "papaparse";

export type PlausibleCsvRows = Record<string, string>[];

export interface ParsedPlausibleCsv {
  headers: string[];
  rows: PlausibleCsvRows;
}

export type ParsedPlausibleArchive = Map<string, ParsedPlausibleCsv>;

export async function parsePlausibleArchive(file: File): Promise<ParsedPlausibleArchive> {
  const zip = await JSZip.loadAsync(file);
  const files: ParsedPlausibleArchive = new Map();

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || !filename.toLowerCase().endsWith(".csv")) continue;

    const csvText = await zipEntry.async("string");
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: "greedy",
    });
    const basename = filename.split("/").at(-1)?.toLowerCase();

    if (!basename || !parsed.meta.fields) continue;
    files.set(basename, {
      headers: parsed.meta.fields,
      rows: parsed.data,
    });
  }

  return files;
}
