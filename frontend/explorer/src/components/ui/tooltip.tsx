'use client'

import React, { useState } from 'react'

interface TooltipProps {
  children: React.ReactNode
}

interface TooltipTriggerProps {
  children: React.ReactNode
  asChild?: boolean
}

interface TooltipContentProps {
  children: React.ReactNode
}

const TooltipContext = React.createContext<{
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}>({ isOpen: false, setIsOpen: () => {} })

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function Tooltip({ children }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <TooltipContext.Provider value={{ isOpen, setIsOpen }}>
      <div className="relative inline-block">
        {children}
      </div>
    </TooltipContext.Provider>
  )
}

export function TooltipTrigger({ children, asChild }: TooltipTriggerProps) {
  const { setIsOpen } = React.useContext(TooltipContext)
  
  return (
    <div
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      className="inline-block"
    >
      {children}
    </div>
  )
}

export function TooltipContent({ children }: TooltipContentProps) {
  const { isOpen } = React.useContext(TooltipContext)
  
  if (!isOpen) return null
  
  return (
    <div className="absolute z-50 left-0 top-full mt-1 w-64 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-xs text-gray-700">
      {children}
    </div>
  )
}

