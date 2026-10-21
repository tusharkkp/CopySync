import React, { useEffect, useState } from 'react'

export const ThemeSwitcher: React.FC = () => {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('chaiui-theme')
    if (saved) return saved === 'dark'
    return document.documentElement.classList.contains('dark') || true
  })

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('chaiui-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('chaiui-theme', 'light')
    }
  }, [isDark])

  const toggleTheme = () => {
    setIsDark((prev) => !prev)
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-switcher-btn"
      aria-label="Toggle theme"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <svg
        className="half-circle-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1 A7 7 0 0 0 8 15 Z" fill="currentColor" />
      </svg>
      <span className="theme-switcher-label">Theme</span>
    </button>
  )
}

export default ThemeSwitcher
