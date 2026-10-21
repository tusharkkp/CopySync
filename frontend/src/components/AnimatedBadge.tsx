import React from 'react'
import './AnimatedBadge.css'

export interface AnimatedBadgeProps {
  children: React.ReactNode
  className?: string
}

export const AnimatedBadge: React.FC<AnimatedBadgeProps> = ({ children, className = '' }) => {
  return (
    <span className={`chai-animated-badge ${className}`}>
      <span aria-hidden="true" className="chai-badge-glint" />
      <span className="chai-badge-inner">
        {children}
      </span>
    </span>
  )
}

export default AnimatedBadge
