import { useEffect, useState } from 'react'

const PAIRS = [
  { prefix: 'Ship the ', before: 'quarterly', after: 'annual', suffix: ' report.' },
  { prefix: 'Save this as the ', before: 'draft', after: 'final', suffix: ' copy.' },
  { prefix: 'Replace ', before: 'hello', after: 'hi', suffix: ' in every file.' },
]

const CYCLE_MS = 3200

export default function AnimatedDiff() {
  const [index, setIndex] = useState(0)
  const [showInsert, setShowInsert] = useState(true)
  const pair = PAIRS[index]

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShowInsert(true)
      return undefined
    }

    setShowInsert(false)
    const insertTimer = setTimeout(() => setShowInsert(true), 280)
    const nextTimer = setTimeout(() => {
      setIndex((i) => (i + 1) % PAIRS.length)
    }, CYCLE_MS)

    return () => {
      clearTimeout(insertTimer)
      clearTimeout(nextTimer)
    }
  }, [index])

  return (
    <p
      className="font-mono text-xl leading-relaxed text-paper sm:text-3xl sm:leading-snug"
      aria-live="polite"
    >
      <span>{pair.prefix}</span>
      <span className="diff-out">{pair.before}</span>
      {showInsert && (
        <>
          {' '}
          <span className="diff-in">{pair.after}</span>
        </>
      )}
      <span>{pair.suffix}</span>
    </p>
  )
}
