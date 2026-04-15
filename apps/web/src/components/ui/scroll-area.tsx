import * as React from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '@/lib/utils'

function ScrollAreaRoot({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollArea.Root>) {
  return (
    <ScrollArea.Root
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      {children}
      <ScrollArea.Scrollbar
        orientation="vertical"
        className={cn(
          'flex touch-none select-none p-[1px] transition-opacity duration-150',
          'data-[scrolling]:opacity-100 data-[hovering]:opacity-100',
        )}
      >
        <ScrollArea.Thumb className="relative flex-1 rounded-full bg-white/20" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar
        orientation="horizontal"
        className={cn(
          'flex touch-none select-none p-[1px] transition-opacity duration-150',
          'data-[scrolling]:opacity-100 data-[hovering]:opacity-100',
        )}
      >
        <ScrollArea.Thumb className="relative flex-1 rounded-full bg-white/20" />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner />
    </ScrollArea.Root>
  )
}

const ScrollAreaViewport = ScrollArea.Viewport
const ScrollAreaScrollbar = ScrollArea.Scrollbar
const ScrollAreaThumb = ScrollArea.Thumb

export {
  ScrollAreaRoot as ScrollArea,
  ScrollAreaViewport as ScrollAreaViewport,
  ScrollAreaScrollbar as ScrollAreaScrollbar,
  ScrollAreaThumb as ScrollAreaThumb,
}
