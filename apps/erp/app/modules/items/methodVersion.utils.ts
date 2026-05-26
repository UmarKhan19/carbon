type MakeMethodVersionSource = {
  id?: string | null;
  itemId?: string | null;
};

export function validateMakeMethodVersionSource({
  source,
  target
}: {
  source: MakeMethodVersionSource;
  target: MakeMethodVersionSource;
}) {
  if (source.itemId === target.itemId) {
    return { error: null };
  }

  return {
    error: {
      message:
        "The source and target make methods must belong to the same item."
    }
  };
}
