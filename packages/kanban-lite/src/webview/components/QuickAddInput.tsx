import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { CardStatus, Priority } from '../../shared/types'
import { useStore } from '../store'

interface QuickAddInputProps {
  status: CardStatus
  onAdd: (data: { status: CardStatus; priority: Priority; content: string }) => void
}

export function QuickAddInput({ status, onAdd }: QuickAddInputProps) {
  const { cardSettings } = useStore()
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleSubmit = () => {
    const title = value.trim()
    if (title) {
      // Build content with title as first # heading
      const content = `# ${title}`
      onAdd({
        status,
        priority: cardSettings.defaultPriority,
        content
      })
      setValue('')
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      setValue('')
      setIsEditing(false)
    }
  }

  if (!isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="kb-quick-add-btn"
      >
        <Plus size={13} />
        <span>Add card</span>
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleSubmit}
      onKeyDown={handleKeyDown}
      placeholder="Card title..."
      className="kb-quick-add-input"
    />
  )
}
