import { useState } from 'react'

/** Renders a value that shows a copy-to-clipboard icon on hover.
 * Clicking the icon or the value itself copies the text to clipboard.
 */
export function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <span
      className="group/val inline-flex items-center gap-1 cursor-pointer"
      onClick={handleCopy}
      title="Click to copy"
    >
      <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
      <span className="opacity-0 group-hover/val:opacity-100 transition-opacity">
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </span>
  )
}
