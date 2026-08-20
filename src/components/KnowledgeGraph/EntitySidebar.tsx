import { Check, Pencil, Plus, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import {
  ENTITY_ICONS,
  type Entity,
  type EntityType,
  addMeetingEntity,
  deleteEntity,
  getMeetingEntities,
  upsertEntity,
} from '../../api/knowledgeGraph';

interface EntitySidebarProps {
  meetingId: string | number;
  onEntityClick?: (entity: Entity) => void;
}

export const EntitySidebar: React.FC<EntitySidebarProps> = ({
  meetingId,
  onEntityClick,
}) => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [addName, setAddName] = useState('');
  const [activeAddType, setActiveAddType] = useState<EntityType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchEntities = async () => {
      if (!meetingId) return;
      setLoading(true);
      try {
        const data = await getMeetingEntities(String(meetingId));
        setEntities(data);
      } catch (error) {
        console.error('Failed to fetch meeting entities:', error);
      } finally {
        setLoading(false);
      }
    };

    const handleEntitiesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId?: string | number }>)
        .detail;
      if (!detail?.meetingId) return;
      if (String(detail.meetingId) !== String(meetingId)) return;
      fetchEntities();
    };

    const handleEntitiesProcessing = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          meetingId?: string | number;
          processing?: boolean;
        }>
      ).detail;
      if (!detail?.meetingId) return;
      if (String(detail.meetingId) !== String(meetingId)) return;
      setProcessing(Boolean(detail.processing));
    };

    fetchEntities();
    window.addEventListener('MEETING_ENTITIES_UPDATED', handleEntitiesUpdated);
    window.addEventListener(
      'MEETING_ENTITIES_PROCESSING',
      handleEntitiesProcessing,
    );
    return () => {
      window.removeEventListener(
        'MEETING_ENTITIES_UPDATED',
        handleEntitiesUpdated,
      );
      window.removeEventListener(
        'MEETING_ENTITIES_PROCESSING',
        handleEntitiesProcessing,
      );
    };
  }, [meetingId]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {['People', 'Projects', 'Topics'].map((label, i) => (
          <div key={label} className="space-y-3">
            <div className="text-[10px] font-semibold text-pro-text-muted/30 font-medium px-1">
              {label}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="h-8 w-40 rounded-full bg-pro-surface border border-pro-border/50 shadow-sm" />
              <div className="h-8 w-32 rounded-full bg-pro-surface border border-pro-border/50 shadow-sm" />
              {i === 2 && (
                <div className="h-8 w-52 rounded-full bg-pro-surface border border-pro-border/50 shadow-sm" />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const visibleEntities = entities.filter((entity) => {
    const name = (entity.name || '').trim();
    if (!name) return false;
    if (
      entity.type === 'project' &&
      name.toLowerCase().startsWith('no project name')
    )
      return false;
    return true;
  });

  if (visibleEntities.length === 0) {
    return (
      <div className="space-y-4">
        {processing && (
          <div className="text-[10px] font-semibold text-pro-text-muted/50 font-medium">
            Processing entities...
          </div>
        )}
        <div className="p-6 bg-pro-bg border border-dashed border-pro-border rounded-md text-center">
          <p className="text-[10px] font-semibold text-pro-text-muted/30 font-medium">
            No entities identified
          </p>
        </div>
      </div>
    );
  }

  // Group by type
  const grouped = visibleEntities.reduce(
    (acc, entity) => {
      if (!acc[entity.type]) acc[entity.type] = [];
      acc[entity.type].push(entity);
      return acc;
    },
    {} as Record<string, Entity[]>,
  );

  const typeOrder: Array<Entity['type']> = ['person', 'project', 'topic'];

  return (
    <div className="space-y-6">
      {processing && (
        <div className="text-[10px] font-semibold text-pro-text-muted/50 font-medium">
          Processing entities...
        </div>
      )}
      {typeOrder.map((type) => {
        const typeEntities = grouped[type];
        if (!typeEntities || typeEntities.length === 0) return null;

        const labels: Record<string, string> = {
          person: 'People',
          project: 'Projects',
          topic: 'Topics',
        };

        return (
          <div key={type} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[10px] font-semibold text-pro-text-muted/40 font-medium">
                {labels[type]}
              </h3>
              <div className="flex items-center gap-2">
                {activeAddType === type ? (
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    onBlur={() => {
                      setActiveAddType(null);
                      setAddName('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addName.trim()) {
                        e.preventDefault();
                        void (async () => {
                          setSaving(true);
                          try {
                            const entity = await upsertEntity({
                              type,
                              name: addName.trim(),
                            });
                            await addMeetingEntity({
                              meeting_id: String(meetingId),
                              entity_id: entity.id,
                            });
                            setAddName('');
                            setActiveAddType(null);
                            const data = await getMeetingEntities(
                              String(meetingId),
                            );
                            setEntities(data);
                          } finally {
                            setSaving(false);
                          }
                        })();
                      } else if (e.key === 'Escape') {
                        setActiveAddType(null);
                        setAddName('');
                      }
                    }}
                    placeholder={`Add ${labels[type].toLowerCase()}...`}
                    className="h-8 w-40 px-2.5 rounded-full border border-pro-border bg-pro-surface text-[12px] font-bold text-pro-text-main placeholder:text-pro-text-muted/40"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveAddType(type);
                      setAddName('');
                    }}
                    className="h-7 w-7 rounded-full border border-pro-border/40 bg-pro-surface text-pro-text-muted/50 hover:text-pro-text-main hover:border-pro-accent/30 transition-colors flex items-center justify-center"
                    aria-label={`Add ${labels[type]}`}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {typeEntities.map((entity) => (
                <div key={entity.id} className="flex items-center gap-2">
                  {editId === entity.id ? (
                    <>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 px-3 rounded-full border border-pro-border text-[12px] font-bold"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editName.trim()) return;
                          setSaving(true);
                          try {
                            await upsertEntity({
                              id: entity.id,
                              type: entity.type,
                              name: editName.trim(),
                            });
                            setEditId(null);
                            setEditName('');
                            const data = await getMeetingEntities(
                              String(meetingId),
                            );
                            setEntities(data);
                          } finally {
                            setSaving(false);
                          }
                        }}
                        disabled={saving}
                        className="h-7 w-7 rounded-full border border-pro-border bg-pro-surface text-pro-accent hover:border-pro-accent/40 transition-colors flex items-center justify-center"
                        aria-label="Save edit"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(null);
                          setEditName('');
                        }}
                        className="h-7 w-7 rounded-full border border-pro-border bg-pro-surface text-pro-text-muted/60 hover:text-pro-text-main transition-colors flex items-center justify-center"
                        aria-label="Cancel edit"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <div className="group inline-flex items-center gap-2">
                      <div
                        onClick={() => onEntityClick?.(entity)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onEntityClick?.(entity);
                          }
                        }}
                        className={`
                          inline-flex items-center font-bold rounded-lg border transition-all cursor-pointer
                          px-2.5 py-1 text-[12px] gap-1.5 bg-pro-surface border-pro-border shadow-sm
                          hover:border-pro-accent/40 hover:shadow-md group
                        `}
                        title={entity.name}
                      >
                        <span className="opacity-70">
                          {ENTITY_ICONS[entity.type as EntityType] || '📍'}
                        </span>
                        <span className="text-pro-text-main truncate max-w-[150px]">
                          {entity.name}
                        </span>
                        <div className="flex items-center gap-2 opacity-30 group-hover:opacity-100 transition-opacity ml-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditId(entity.id);
                              setEditName(entity.name);
                            }}
                            className="text-pro-text-muted/70 hover:text-pro-text-main transition-colors"
                            aria-label="Edit entity"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm('Delete this entity?'))
                                return;
                              setSaving(true);
                              try {
                                await deleteEntity(entity.id);
                                const data = await getMeetingEntities(
                                  String(meetingId),
                                );
                                setEntities(data);
                              } finally {
                                setSaving(false);
                              }
                            }}
                            className="text-red-500/70 hover:text-red-500 transition-colors"
                            aria-label="Delete entity"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
