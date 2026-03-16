import { useCallback, useRef, useEffect, useState } from 'react'

export function useChatScroll() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)

  // Setup IntersectionObserver to track if user is at bottom
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        // If sentinel is visible, user is at bottom
        setIsUserAtBottom(entries[0]?.isIntersecting ?? false)
      },
      { root: containerRef.current, threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return

    const container = containerRef.current
    // Use requestAnimationFrame to ensure scroll happens after render
    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      })
    })
  }, [])

  const scrollToBottomIfAtBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (isUserAtBottom) {
        scrollToBottom(behavior)
      }
    },
    [isUserAtBottom, scrollToBottom]
  )

  return { containerRef, sentinelRef, scrollToBottom, scrollToBottomIfAtBottom, isUserAtBottom }
}
