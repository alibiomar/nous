'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from './button'

export function ThemeToggle() {
  const { theme, systemTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const current = theme === 'system' ? systemTheme : theme

  const toggle = () => setTheme(current === 'dark' ? 'light' : 'dark')

  return (
    <Button
    variant={"outline"}
      aria-label="Toggle color scheme"
      onClick={toggle}
      className="inline-flex items-center w-full justify-center rounded-2xl px-2 py-4 "
    >
      {current === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

export default ThemeToggle
