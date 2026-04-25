// Reusable virtualized infinite-scroll table for the admin lists.
// Wraps @tanstack/react-virtual. Uses fixed row height for predictable
// scrolling and renders neon-lime skeleton rows during initial load and at
// the tail when the next page is loading.
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export interface Column<T> {
  /** Stable key used for React.key on header/cell. */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** CSS width — pass a fixed pixel string for predictable layout. */
  width: string;
  /** Optional cell alignment. */
  align?: "left" | "right" | "center";
  /** Render the cell for a row. */
  cell: (row: T, index: number) => ReactNode;
  /** Optional click handler on the header (e.g. sort toggle). */
  onSort?: () => void;
  /** Visual indicator: "asc" | "desc" | undefined. */
  sortDir?: "asc" | "desc";
}

export interface VirtualTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  /** Row height in pixels. Defaults to 56. */
  rowHeight?: number;
  /** Total visible scroll viewport height (px). Defaults to 600. */
  height?: number;
  /** Stable id for React.key. */
  rowId: (row: T, index: number) => string;
  /** Optional class applied to each row. */
  rowClass?: (row: T, index: number) => string | undefined;
  /** Optional inline style applied to each row. */
  rowStyle?: (row: T, index: number) => CSSProperties | undefined;
  /** True while the next page is being fetched. */
  loadingMore?: boolean;
  /** True for the very first load (no rows yet). */
  initialLoading?: boolean;
  /** Are there more rows on the server? */
  hasMore?: boolean;
  /** Called when the user scrolls near the bottom. */
  onLoadMore?: () => void;
  /** Empty-state node when not loading and rows is empty. */
  empty?: ReactNode;
}

export function VirtualTable<T>({
  rows,
  columns,
  rowHeight = 56,
  height = 600,
  rowId,
  rowClass,
  rowStyle,
  loadingMore = false,
  initialLoading = false,
  hasMore = false,
  onLoadMore,
  empty,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const totalRows = rows.length + (hasMore || loadingMore ? 6 : 0);

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  // Trigger onLoadMore when the user scrolls near the end.
  const items = virtualizer.getVirtualItems();
  const lastItem = items[items.length - 1];
  useEffect(() => {
    if (!onLoadMore || !hasMore || loadingMore || initialLoading) return;
    if (!lastItem) return;
    if (lastItem.index >= rows.length - 4) {
      onLoadMore();
    }
  }, [lastItem, rows.length, hasMore, loadingMore, initialLoading, onLoadMore]);

  const totalGridTemplate = columns.map((c) => c.width).join(" ");

  return (
    <div className="vt-wrap a-surface">
      {/* Header */}
      <div
        className="vt-header"
        style={{
          gridTemplateColumns: totalGridTemplate,
          height: 40,
        }}
      >
        {columns.map((c) => (
          <div
            key={c.key}
            className="vt-th"
            style={{
              textAlign: c.align ?? "left",
              cursor: c.onSort ? "pointer" : undefined,
              color: c.sortDir ? "var(--a-accent)" : undefined,
            }}
            onClick={c.onSort}
          >
            {c.header}
            {c.sortDir === "asc" ? " ↑" : c.sortDir === "desc" ? " ↓" : null}
          </div>
        ))}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="vt-scroll" style={{ height, overflow: "auto" }}>
        {initialLoading && rows.length === 0 ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} cols={columns.length} height={rowHeight} grid={totalGridTemplate} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="vt-empty">{empty ?? "No results."}</div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {items.map((vRow) => {
              const isSkeleton = vRow.index >= rows.length;
              if (isSkeleton) {
                return (
                  <div
                    key={`sk-${vRow.index}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                      height: vRow.size,
                    }}
                  >
                    <SkeletonRow cols={columns.length} height={vRow.size} grid={totalGridTemplate} />
                  </div>
                );
              }
              const row = rows[vRow.index];
              const id = rowId(row, vRow.index);
              const cls = rowClass?.(row, vRow.index);
              const styleExtra = rowStyle?.(row, vRow.index);
              return (
                <div
                  key={id}
                  className={`vt-row ${cls ?? ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                    height: vRow.size,
                    display: "grid",
                    gridTemplateColumns: totalGridTemplate,
                    alignItems: "center",
                    ...styleExtra,
                  }}
                >
                  {columns.map((c) => (
                    <div
                      key={c.key}
                      className="vt-td"
                      style={{ textAlign: c.align ?? "left" }}
                    >
                      {c.cell(row, vRow.index)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonRow({ cols, height, grid }: { cols: number; height: number; grid: string }) {
  return (
    <div
      className="vt-row vt-skeleton"
      style={{
        display: "grid",
        gridTemplateColumns: grid,
        alignItems: "center",
        height,
      }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="vt-td">
          <div className="vt-shimmer" />
        </div>
      ))}
    </div>
  );
}
