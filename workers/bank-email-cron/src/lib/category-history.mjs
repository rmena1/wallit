// The raw bank name is deliberately neither trimmed nor normalized.
export function createCategoryHistoryLookup({ sql, userId }) {
  return async ({ originalName, provider, sourceEmailId }) => {
    if (typeof originalName !== 'string' || !originalName) return null;
    const [winner] = await sql`
      SELECT m.category_id
      FROM movements m
      WHERE m.created_by_user_id = ${userId}
        AND m.original_name = ${originalName}
        AND m.category_id IS NOT NULL
        AND NOT (m.source_email_provider IS NOT DISTINCT FROM ${provider}
          AND m.source_email_id IS NOT DISTINCT FROM ${sourceEmailId})
      GROUP BY m.category_id
      ORDER BY COUNT(*) DESC, m.category_id
      LIMIT 1
    `;
    return winner?.category_id ?? null;
  };
}
