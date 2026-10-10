"use client";
import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { compareValues } from "@/lib/utils";
export type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => React.ReactNode;
  sort?: (row: T) => string | number;
};
export function Table<T>({
  rows,
  columns,
  empty = "暂无记录",
  searchable = true,
  scrollHint = "左右滑动查看完整表格",
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  searchable?: boolean;
  scrollHint?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setOverflow(el.scrollWidth > el.clientWidth + 1),
    );
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null),
    [page, setPage] = useState(0);
  let filtered = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
  );
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    if (col?.sort)
      filtered = [...filtered].sort((a, b) => {
        const x = col.sort!(a),
          y = col.sort!(b);
        const result = compareValues(x, y);
        return sort.desc ? -result : result;
      });
  }
  const last = Math.max(0, Math.ceil(filtered.length / 15) - 1),
    current = Math.min(page, last);
  return (
    <>
      <div className="table-tools">
        {searchable && (
          <label>
            <span className="sr-only">搜索记录</span>
            <input
              className="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="搜索名称、账户或标签…"
            />
          </label>
        )}
        <span className="detail">{filtered.length}条记录</span>
      </div>
      {overflow && <p className="detail table-scroll-hint">{scrollHint}</p>}
      <div
        className="table-scroll"
        ref={scrollRef}
        role="region"
        aria-label="可横向滚动的数据表"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  {c.sort ? (
                    <button
                      className="button ghost"
                      onClick={() => {
                        setSort({
                          key: c.key,
                          desc: sort?.key === c.key ? !sort.desc : false,
                        });
                        setPage(0);
                      }}
                    >
                      {c.label}
                      {sort?.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 15, current * 15 + 15).map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>{c.value(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty">
            <strong>{empty}</strong>完成上方录入后，记录会显示在这里。
          </div>
        )}
      </div>
      {filtered.length > 15 && (
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </Button>
          <span className="detail">
            {current + 1} / {last + 1}
          </span>
          <Button
            variant="outline"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  );
}
