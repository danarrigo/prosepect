interface CursorPage<T> {
  items: T[]
  next_cursor?: string | null
}

export async function collectCursorPages<T>(
  loadPage: (cursor?: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const items: T[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await loadPage(cursor)
    items.push(...page.items)
    cursor = page.next_cursor ?? undefined
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('API returned a repeated pagination cursor')
    }
    if (cursor) seenCursors.add(cursor)
  } while (cursor)

  return items
}
