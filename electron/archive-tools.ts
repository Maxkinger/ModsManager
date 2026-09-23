export interface SevenZipArchiveEntry {
  path: string;
  isLink: boolean;
}

export function parseSevenZipListing(output: string): SevenZipArchiveEntry[] {
  const entrySection = output.split(/^[-]{5,}\r?$/mu).at(-1) ?? "";

  return entrySection
    .split(/\r?\n\r?\n/u)
    .map((record) => ({
      path: record.match(/^Path = (.*)$/mu)?.[1]?.trim() ?? "",
      isLink: /^(?:Symbolic Link|Hard Link) = /mu.test(record)
    }))
    .filter((entry) => entry.path.length > 0);
}
