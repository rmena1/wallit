import { authMetadata, oauthJson } from '@/lib/mcp/http'
export const dynamic = 'force-dynamic'
export function GET() { return oauthJson(authMetadata()) }
