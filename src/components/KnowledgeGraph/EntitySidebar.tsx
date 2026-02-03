import React, { useEffect, useState } from 'react'
import { Entity, getMeetingEntities } from '../../api/knowledgeGraph'
import { EntityPill } from './EntityPill'

interface EntitySidebarProps {
  meetingId: string | number
  onEntityClick?: (entity: Entity) => void
}

export const EntitySidebar: React.FC<EntitySidebarProps> = ({ meetingId, onEntityClick }) => {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEntities = async () => {
      if (!meetingId) return
      setLoading(true)
      try {
        const data = await getMeetingEntities(String(meetingId))
        setEntities(data)
      } catch (error) {
        console.error('Failed to fetch meeting entities:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchEntities()
  }, [meetingId])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-pro-bg rounded-xl w-full" />
        ))}
      </div>
    )
  }

  if (entities.length === 0) {
    return (
      <div className="p-6 bg-pro-bg/30 border border-dashed border-pro-border rounded-2xl text-center">
        <p className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.2em]">No entities identified</p>
      </div>
    )
  }

  // Group by type
  const grouped = entities.reduce((acc, entity) => {
    if (!acc[entity.type]) acc[entity.type] = []
    acc[entity.type].push(entity)
    return acc
  }, {} as Record<string, Entity[]>)

  const typeOrder: Array<Entity['type']> = ['person', 'project', 'topic']

  return (
    <div className="space-y-8">
      {typeOrder.map(type => {
        const typeEntities = grouped[type]
        if (!typeEntities || typeEntities.length === 0) return null

        const labels: Record<string, string> = {
          person: 'People',
          project: 'Projects',
          topic: 'Topics'
        }

        return (
          <div key={type} className="space-y-3">
            <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] px-1">
              {labels[type]}
            </h3>
            <div className="flex flex-wrap gap-2">
              {typeEntities.map(entity => (
                <EntityPill 
                  key={entity.id} 
                  entity={entity} 
                  onClick={() => onEntityClick?.(entity)}
                  showStatus={type === 'action_item'}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
