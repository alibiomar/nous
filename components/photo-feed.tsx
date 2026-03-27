'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/client';
import { readDeviceCache, removeDeviceCache, writeDeviceCache } from '@/lib/device-cache';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';


interface Post {
  id: string;
  user_id: string;
  caption: string;
  image_url: string;
  created_at: string;
  liked_by_me?: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar_url?: string | null;
  };
  likes?: any[];
  comments?: any[];
}

interface PhotoFeedProps {
  refreshSignal?: number;
  currentUserId: string;
}

const DEVICE_FEED_CACHE_KEY = 'nous:feed:posts';
const DEVICE_FEED_CACHE_TTL_MS = 30_000;

let moduleCachedPosts: Post[] | null = null;
let moduleCachedAt = 0;

export function PhotoFeed({ refreshSignal = 0, currentUserId }: PhotoFeedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Stays false until we've received at least one real response (cache or network).
  // Prevents the empty-state flash while the first fetch is in flight.
  const [isInitialized, setIsInitialized] = useState(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      fetchPosts(false); // Don't force on initial mount; use cache if available
    } else {
      fetchPosts(true); // Force network refresh only when refreshSignal actually changes
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

const fetchPosts = async (force = false) => {
  const now = Date.now();

  // 1. Module-level cache: fast path
  if (!force && moduleCachedPosts !== null && now - moduleCachedAt < DEVICE_FEED_CACHE_TTL_MS) {
    setPosts(moduleCachedPosts);
    setIsLoading(false);
    setIsInitialized(true);
    return;
  }

  // 2. Device cache: show immediately while network loads in background.
  //    This populates posts so the empty-state never flashes for cached users.
  if (!force) {
    const cachedPosts = readDeviceCache<Post[]>(DEVICE_FEED_CACHE_KEY);
    if (cachedPosts !== null) {
      setPosts(cachedPosts);
      moduleCachedPosts = cachedPosts;
      moduleCachedAt = now;
      setIsLoading(false);
      setIsInitialized(true);
      // Don't return — fall through to network refresh in background
    }
  }

  try {
    const response = await fetch('/api/posts');
    if (response.ok) {
      const data = await response.json();
      // Only update posts from network if it returned results, OR if we have
      // no cached posts to show — prevents a slow/empty network response from
      // wiping out a valid cache hit.
      if (data.length > 0 || !isInitialized) {
        setPosts(data);
      }
      moduleCachedPosts = data;
      moduleCachedAt = Date.now();
      writeDeviceCache(DEVICE_FEED_CACHE_KEY, data, DEVICE_FEED_CACHE_TTL_MS);
    }
  } catch (error) {
    console.error('Failed to fetch posts:', error);
  } finally {
    setIsLoading(false);
    setIsInitialized(true);
  }
};
  const handlePostRemoved = (postId: string) => {
    setPosts((current) => current.filter((post) => post.id !== postId));
  };

  const handlePostUpdated = (postId: string, caption: string) => {
    setPosts((current) =>
      current.map((post) => (post.id === postId ? { ...post, caption } : post))
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        {isLoading && !isInitialized ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card overflow-hidden shadow-sm max-w-md mx-auto animate-pulse"
              >
                <div className="px-6 py-4 border-b border-border flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-muted/40" />
                  <div className="flex-1">
                    <div className="h-3 w-1/3 rounded bg-muted/40 mb-2" />
                    <div className="h-3 w-1/4 rounded bg-muted/40" />
                  </div>
                </div>

                <div className="h-48 bg-muted/40 w-full" />

                <div className="px-6 py-4">
                  <div className="h-3 w-3/4 rounded bg-muted/40 mb-3" />
                  <div className="flex items-center gap-4">
                    <div className="h-6 w-12 rounded bg-muted/40" />
                    <div className="h-6 w-12 rounded bg-muted/40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 && isInitialized ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-text-secondary mb-2">No moments yet</p>
            <p className="text-sm text-text-tertiary">
              Tap "Share moment" to post your first memory
            </p>
          </div>
        ) : (
          <>
            <div className="pb-2 border-b border-border">
              <h3 className="font-semibold text-foreground">Recent Moments</h3>
            </div>
            <div className="space-y-6">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={currentUserId}
                onPostRemoved={handlePostRemoved}
                onPostUpdated={handlePostUpdated}
              />
            ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface Comment {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar_url?: string | null;
  };
}

function PostCard({
  post,
  currentUserId,
  onPostRemoved,
  onPostUpdated,
}: {
  post: Post;
  currentUserId: string | null;
  onPostRemoved: (postId: string) => void;
  onPostUpdated: (postId: string, caption: string) => void;
}) {
  const [liked, setLiked] = useState(Boolean(post.liked_by_me));
  const [likeCount, setLikeCount] = useState(getRelationCount(post.likes));
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentCount, setCommentCount] = useState(getRelationCount(post.comments));
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [editingPost, setEditingPost] = useState(false);
  const [editedPostCaption, setEditedPostCaption] = useState(post.caption || '');
  const [updatingPost, setUpdatingPost] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editedCommentContent, setEditedCommentContent] = useState('');
  const likeStateRef = useRef({ liked: Boolean(post.liked_by_me), likeCount: getRelationCount(post.likes) });

  useEffect(() => {
    const nextLiked = Boolean(post.liked_by_me);
    const nextCount = getRelationCount(post.likes);
    setLiked(nextLiked);
    setLikeCount(nextCount);
    likeStateRef.current = { liked: nextLiked, likeCount: nextCount };
    setEditedPostCaption(post.caption || '');
  }, [post.liked_by_me, post.likes, post.caption]);

  const fetchComments = async () => {
    setIsLoadingComments(true);
    try {
      const response = await fetch(`/api/posts/${post.id}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data);
        setCommentCount(data.length);
      }
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    } finally {
      setIsLoadingComments(false);
    }
  };

  const handleToggleComments = async () => {
    if (!showComments && comments.length === 0) {
      await fetchComments();
    }
    setShowComments(!showComments);
  };

  const handlePostComment = async () => {
    if (!newComment.trim()) {
      return;
    }

    setIsPostingComment(true);
    try {
      const response = await fetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment }),
      });

      if (response.ok) {
        const comment = await response.json();
        setComments([comment, ...comments]);
        setCommentCount(commentCount + 1);
        setNewComment('');
        removeDeviceCache(DEVICE_FEED_CACHE_KEY);
        moduleCachedPosts = null;
      }
    } catch (error) {
      console.error('Failed to post comment:', error);
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleLike = async () => {
    const currentLiked = likeStateRef.current.liked;
    const currentCount = likeStateRef.current.likeCount;

    // Optimistic update
    const newLiked = !currentLiked;
    const newCount = currentLiked ? currentCount - 1 : currentCount + 1;

    likeStateRef.current = { liked: newLiked, likeCount: newCount };
    setLiked(newLiked);
    setLikeCount(newCount);

    try {
      const response = await fetch(`/api/posts/${post.id}/like`, {
        method: currentLiked ? 'DELETE' : 'POST',
      });

      if (!response.ok) {
        // Revert on error
        likeStateRef.current = { liked: currentLiked, likeCount: currentCount };
        setLiked(currentLiked);
        setLikeCount(currentCount);
      } else {
        removeDeviceCache(DEVICE_FEED_CACHE_KEY);
        moduleCachedPosts = null;
      }
    } catch (error) {
      console.error('Like error:', error);
      // Revert on error
      likeStateRef.current = { liked: currentLiked, likeCount: currentCount };
      setLiked(currentLiked);
      setLikeCount(currentCount);
    }
  };

  const handleUpdatePost = async () => {
    if (updatingPost) return;

    setUpdatingPost(true);
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: editedPostCaption }),
      });

      if (!response.ok) {
        throw new Error('Failed to update post');
      }

      onPostUpdated(post.id, editedPostCaption);
      setEditingPost(false);
      removeDeviceCache(DEVICE_FEED_CACHE_KEY);
      moduleCachedPosts = null;
    } catch (error) {
      console.error('Failed to update post:', error);
    } finally {
      setUpdatingPost(false);
    }
  };

  const handleDeletePost = async () => {
    if (!confirm('Delete this post?')) return;

    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete post');
      }

      onPostRemoved(post.id);
      removeDeviceCache(DEVICE_FEED_CACHE_KEY);
      moduleCachedPosts = null;
    } catch (error) {
      console.error('Failed to delete post:', error);
    }
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!editedCommentContent.trim()) return;

    try {
      const response = await fetch(`/api/posts/${post.id}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedCommentContent }),
      });

      if (!response.ok) {
        throw new Error('Failed to update comment');
      }

      const updated = await response.json();
      setComments((current) =>
        current.map((comment) => (comment.id === commentId ? updated : comment))
      );
      setEditingCommentId(null);
      setEditedCommentContent('');
      removeDeviceCache(DEVICE_FEED_CACHE_KEY);
      moduleCachedPosts = null;
    } catch (error) {
      console.error('Failed to update comment:', error);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const response = await fetch(`/api/posts/${post.id}/comments/${commentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete comment');
      }

      setComments((current) => current.filter((comment) => comment.id !== commentId));
      setCommentCount((count) => Math.max(0, count - 1));
      removeDeviceCache(DEVICE_FEED_CACHE_KEY);
      moduleCachedPosts = null;
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  };

  const initials = post.user?.name
    ?.split(' ')
    ?.map((word) => word[0])
    ?.join('')
    ?.toUpperCase();
  const isOwnPost = Boolean(currentUserId && post.user_id === currentUserId);

  return (
    <div className="flex justify-center mx-auto">
      <div className="rounded-xl max-w-md container border border-border bg-card overflow-hidden shadow-sm">
      {/* User Info */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-4 group/post">
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarImage src={post.user?.avatar_url || undefined} alt={initials} />
          <AvatarFallback className="text-xs">{initials || 'U'}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">{post.user?.name}</p>
          <p className="text-xs text-text-secondary mt-1">
            {new Date(post.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>

        {isOwnPost && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="opacity-0 transition-opacity group-hover/post:opacity-100 focus-visible:opacity-100"
                title="Post actions"
                aria-label="Post actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingPost((value) => !value)}>
                <Pencil className="w-4 h-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={handleDeletePost}>
                <Trash2 className="w-4 h-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Image */}
      <div className="relative bg-background overflow-hidden">
        {editingPost ? (
          <div className="px-3 py-3 border-b border-border space-y-2">
            <textarea
              value={editedPostCaption}
              onChange={(event) => setEditedPostCaption(event.target.value)}
              rows={2}
              className="w-full resize-none border border-border rounded-lg px-3 py-2 bg-card text-foreground text-[16px]  focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingPost(false);
                  setEditedPostCaption(post.caption || '');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleUpdatePost}
                disabled={updatingPost}
              >
                {updatingPost ? <img src="/animated_heart_icon.svg" alt="Loading" className="w-4 h-4" /> : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          post.caption && (
            <div className="px-3 py-2 border-b border-border">
              <p className="text-foreground text-sm leading-snug">{post.caption}</p>
            </div>
          )
        )}

        <Image
          src={post.image_url}
          alt={post.caption || 'post image'}
          width={400}
          height={300}
          className="w-full object-cover"
          priority
        />
      </div>



      {/* Actions */}
      <div className="px-6 py-4 flex items-center gap-6">
        <button
          onClick={handleLike}
          className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors group"
        >
          <Heart
            className="w-5 h-5 transition-all group-hover:scale-110"
            fill={liked ? 'currentColor' : 'none'}
            color={liked ? 'currentColor' : 'currentColor'}
          />
          <span className="text-sm font-medium">{likeCount}</span>
        </button>

        <button
          onClick={handleToggleComments}
          className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors group"
        >
          <MessageCircle className="w-5 h-5 transition-all group-hover:scale-110" />
          <span className="text-sm font-medium">{commentCount}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="px-6 py-4 border-t border-border bg-secondary space-y-4">
          {/* Comments List */}
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {isLoadingComments ? (
              <div className="flex items-center justify-center gap-2 py-4 text-text-secondary text-sm">
                <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
                <span>Loading comments...</span>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-4 text-text-secondary text-sm">
                No comments yet. Be the first to comment!
              </div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="flex gap-3 group/comment">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={comment.user?.avatar_url || undefined} alt={comment.user?.name || 'User'} />
                    <AvatarFallback className="text-xs">
                      {comment.user?.name
                        ?.split(' ')
                        ?.map((word) => word[0])
                        ?.join('')
                        ?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{comment.user?.name}</p>

                      {currentUserId === comment.user_id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              className="opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100"
                              title="Comment actions"
                              aria-label="Comment actions"
                            >
                              <MoreHorizontal className="w-3 h-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingCommentId(comment.id);
                                setEditedCommentContent(comment.content);
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteComment(comment.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {editingCommentId === comment.id ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          value={editedCommentContent}
                          onChange={(event) => setEditedCommentContent(event.target.value)}
                          rows={2}
                          className="w-full resize-none border border-border rounded-lg px-3 py-2 bg-card text-foreground text-[16px] focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditedCommentContent('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleUpdateComment(comment.id)}
                            disabled={!editedCommentContent.trim()}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-text-secondary mt-0.5">{comment.content}</p>
                    )}

                    <p className="text-xs text-text-tertiary mt-1">
                      {new Date(comment.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Comment Input */}
          <div className="flex gap-2 flex-1 pt-3 border-t border-border">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              rows={1}
              className="flex-1 resize-none border border-border rounded-lg px-3 py-2 bg-card text-foreground text-[16px] focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-text-tertiary"
            />
            <Button
              onClick={handlePostComment}
              disabled={!newComment.trim() || isPostingComment}
              size="sm"
              className="self-start"
            >
              {isPostingComment ? <img src="/animated_heart_icon.svg" alt="Loading" className="w-4 h-4" /> : 'Post'}
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function getRelationCount(value: any[] | { count?: number }[] | undefined) {
  if (!value || value.length === 0) {
    return 0;
  }

  const firstItem = value[0] as { count?: number };
  if (typeof firstItem?.count === 'number') {
    return firstItem.count;
  }

  return value.length;
}