interface Source {
  readonly files: readonly { readonly records: readonly { readonly provider: string }[] }[] | null;
}

// Keep provider-major order: the first matching source determines the deduplication bucket.
export function partitionOpenCode<S extends Source>(sources: readonly S[]) {
  return (["opencode", "openrouter"] as const).flatMap((provider) =>
    sources.map((source) => ({
      ...source,
      provider,
      files: source.files?.flatMap((file) => {
        const records = file.records.filter((record) => record.provider === provider);
        return records.length ? [{ ...file, records }] : [];
      }) ?? null,
    })),
  );
}
