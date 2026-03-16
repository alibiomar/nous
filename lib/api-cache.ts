import { buildCacheKey, invalidateCacheByPrefix } from '@/lib/server-cache';

const FEED_POSTS_PREFIX = 'api-cache:feed-posts';
const MESSAGES_PREFIX = 'api-cache:messages';

export function feedPostsCacheKey(userId: string) {
  return buildCacheKey([FEED_POSTS_PREFIX, userId]);
}

export function messagesCacheKey(params: {
  userId: string;
  before?: string | null;
  limit?: number | null;
}) {
  return buildCacheKey([
    MESSAGES_PREFIX,
    params.userId,
    params.before || '-',
    params.limit ?? '-',
  ]);
}

export function invalidateFeedPostsCache() {
  invalidateCacheByPrefix(FEED_POSTS_PREFIX);
}

export function invalidateMessagesCacheForUsers(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

  for (const userId of uniqueUserIds) {
    invalidateCacheByPrefix(buildCacheKey([MESSAGES_PREFIX, userId]));
  }
}
