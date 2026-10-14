// The raw bank name is deliberately neither trimmed nor normalized.
export function createCategoryHistoryLookup({ sql, userId }) {
  return async ({ originalName, provider, sourceEmailId, accountId }) => {
    if (!accountId) return null;
    if (typeof originalName !== 'string' || !originalName) return null;
    const [winner] = await sql`
      SELECT destination.id AS category_id
      FROM movements m
      JOIN categories historical ON historical.id = m.category_id AND historical.space_id = m.space_id
      JOIN accounts account ON account.id = ${accountId}
      JOIN categories destination ON destination.space_id = account.space_id
        AND destination.name = historical.name
      WHERE m.created_by_user_id = ${userId}
        AND m.original_name = ${originalName}
        AND m.category_id IS NOT NULL
        AND NOT (m.source_email_provider IS NOT DISTINCT FROM ${provider}
          AND m.source_email_id IS NOT DISTINCT FROM ${sourceEmailId})
      GROUP BY destination.id
      ORDER BY COUNT(*) DESC, destination.id
      LIMIT 1
    `;
    return winner?.category_id ?? null;
  };
}
