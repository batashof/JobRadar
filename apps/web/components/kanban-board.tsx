'use client';

import {
  APPLICATION_STAGES,
  type ApplicationItem,
  type ApplicationStage,
} from '@jobradar/shared';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import { APPLICATION_STAGE_LABELS } from '@/lib/labels';
import {
  deleteApplication,
  listApplications,
  reorderApplications,
  updateApplication,
} from '@/lib/applications';

type Columns = Record<ApplicationStage, ApplicationItem[]>;

function groupByStage(items: ApplicationItem[]): Columns {
  const columns = {} as Columns;
  for (const stage of APPLICATION_STAGES) columns[stage] = [];
  for (const item of [...items].sort((a, b) => a.stageOrder - b.stageOrder)) {
    columns[item.stage].push(item);
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CardProps {
  item: ApplicationItem;
  onNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
}

function SortableCard({ item, onNotes, onDelete }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState(item.notes);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function saveNotes() {
    if (draft !== item.notes) onNotes(item.id, draft);
  }

  return (
    <Card ref={setNodeRef} style={style} className="p-3">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag"
          className="mt-0.5 cursor-grab touch-none text-[var(--color-muted-foreground)]"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">
          <a
            href={item.vacancy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:underline"
            title={item.vacancy.title}
          >
            {item.vacancy.title}
          </a>
          <p className="truncate text-xs text-[var(--color-muted-foreground)]">
            {item.vacancy.company} · {item.vacancy.source}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs">
        <button
          type="button"
          className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          onClick={() => setNotesOpen((o) => !o)}
        >
          {item.notes ? '📝 Notes' : 'Add notes'}
        </button>
        <button
          type="button"
          className="text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
          onClick={() => onDelete(item.id)}
        >
          Remove
        </button>
      </div>

      {notesOpen ? (
        <textarea
          className="mt-2 w-full rounded-md border border-[var(--color-input)] bg-transparent p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          rows={3}
          placeholder="Notes…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveNotes}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function Column({
  stage,
  items,
  onNotes,
  onDelete,
}: {
  stage: ApplicationStage;
  items: ApplicationItem[];
  onNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: stage });

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">{APPLICATION_STAGE_LABELS[stage]}</span>
        <span className="text-xs text-[var(--color-muted-foreground)]">{items.length}</span>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-24 flex-1 flex-col gap-2 rounded-lg bg-[var(--color-muted)] p-2"
        >
          {items.map((item) => (
            <SortableCard key={item.id} item={item} onNotes={onNotes} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function KanbanBoard({ initial }: { initial: ApplicationItem[] }) {
  const [columns, setColumns] = useState<Columns>(() => groupByStage(initial));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startStage = useRef<ApplicationStage | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const isStage = (id: string): id is ApplicationStage =>
    (APPLICATION_STAGES as readonly string[]).includes(id);

  function findContainer(id: string): ApplicationStage | null {
    if (isStage(id)) return id;
    return APPLICATION_STAGES.find((s) => columns[s].some((i) => i.id === id)) ?? null;
  }

  const activeItem = activeId
    ? Object.values(columns)
        .flat()
        .find((i) => i.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    startStage.current = findContainer(id);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setColumns((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((i) => i.id === active.id);
      const item = activeItems[activeIndex];
      if (!item) return prev;

      const overIndex = isStage(String(over.id))
        ? overItems.length
        : overItems.findIndex((i) => i.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;

      return {
        ...prev,
        [activeContainer]: activeItems.filter((i) => i.id !== active.id),
        [overContainer]: [
          ...overItems.slice(0, insertAt),
          { ...item, stage: overContainer },
          ...overItems.slice(insertAt),
        ],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const container = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!container || !overContainer) return;

    let next = columns;
    if (container === overContainer) {
      const items = columns[container];
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = isStage(String(over.id))
        ? items.length - 1
        : items.findIndex((i) => i.id === over.id);
      if (oldIndex !== newIndex && newIndex >= 0) {
        next = { ...columns, [container]: arrayMove(items, oldIndex, newIndex) };
        setColumns(next);
      }
    }

    const affected = Array.from(
      new Set([startStage.current, overContainer].filter(Boolean)),
    ) as ApplicationStage[];
    startStage.current = null;
    void persist(next, affected);
  }

  async function persist(cols: Columns, stages: ApplicationStage[]) {
    setError(null);
    try {
      await reorderApplications({
        columns: stages.map((stage) => ({ stage, orderedIds: cols[stage].map((i) => i.id) })),
      });
    } catch {
      setError('Could not save the change — reloading the board.');
      const fresh = await listApplications().catch(() => null);
      if (fresh) setColumns(groupByStage(fresh));
    }
  }

  async function handleNotes(id: string, notes: string) {
    try {
      await updateApplication(id, { notes });
      setColumns((prev) => mapItem(prev, id, (i) => ({ ...i, notes })));
    } catch {
      setError('Could not save notes.');
    }
  }

  async function handleDelete(id: string) {
    const prev = columns;
    setColumns((c) => removeItem(c, id));
    try {
      await deleteApplication(id);
    } catch {
      setError('Could not remove the card.');
      setColumns(prev);
    }
  }

  const total = Object.values(columns).reduce((n, list) => n + list.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Application board</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Drag cards between stages. Save vacancies from the feed to add them here.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {total === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No applications yet. Open the feed and save a vacancy to your board.
          </div>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="flex gap-3 overflow-x-auto pb-4">
            {APPLICATION_STAGES.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                items={columns[stage]}
                onNotes={handleNotes}
                onDelete={handleDelete}
              />
            ))}
          </div>
          <DragOverlay>
            {activeItem ? (
              <Card className="p-3 shadow-lg">
                <p className="truncate text-sm font-medium">{activeItem.vacancy.title}</p>
                <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                  {activeItem.vacancy.company}
                </p>
              </Card>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function mapItem(
  columns: Columns,
  id: string,
  fn: (item: ApplicationItem) => ApplicationItem,
): Columns {
  const next = { ...columns };
  for (const stage of APPLICATION_STAGES) {
    next[stage] = next[stage].map((i) => (i.id === id ? fn(i) : i));
  }
  return next;
}

function removeItem(columns: Columns, id: string): Columns {
  const next = { ...columns };
  for (const stage of APPLICATION_STAGES) {
    next[stage] = next[stage].filter((i) => i.id !== id);
  }
  return next;
}
