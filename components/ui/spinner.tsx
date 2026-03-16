import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: React.ComponentProps<'img'>) {
  return (
    <img
      src="/animated_heart_icon.svg"
      alt="Loading"
      role="status"
      className={cn('size-4', className)}
      {...props}
    />
  )
}

export { Spinner }
