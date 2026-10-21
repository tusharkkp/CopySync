import React from 'react'
import bg from '../assets/background.svg'

export const Backdrop: React.FC = () => {
  return (
    <img
      src={bg}
      alt=""
      aria-hidden="true"
      className="chai-backdrop"
      fetchPriority="high"
      decoding="async"
    />
  )
}

export default Backdrop
