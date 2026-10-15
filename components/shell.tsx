"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { create } from "zustand";
import { useEffect, useRef } from "react";
import {
  Wallet,
  Landmark,
  Coins,
  ArrowLeftRight,
  PieChart,
  History,
  ScanLine,
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  NotebookPen,
  Activity,
  Rewind,
  CheckSquare,
  ChartNoAxesCombined,
  Target,
  TrendingUp,
  Settings,
  Sun,
  Moon,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "./ui/button";
const useShell = create<{
  light: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  light: false,
  open: false,
  setOpen: (open) => set({ open }),
}));
const groups: {
  title: string;
  links: [string, string, LucideIcon][];
}[] = [
  {
    title: "财富管理",
    links: [
      ["/wealth", "总资产", Wallet],
      ["/wealth/platforms", "平台与账户", Landmark],
      ["/wealth/assets", "资产明细", Coins],
      ["/wealth/transactions", "资金流水", ArrowLeftRight],
      ["/wealth/transfers", "内部转账", ArrowLeftRight],
      ["/wealth/allocation", "资产配置", PieChart],
      ["/wealth/history", "历史表现", History],
      ["/wealth/reconciliation", "数据对账", ScanLine],
    ],
  },
  {
    title: "交易管理",
    links: [
      ["/trading/dashboard", "交易总览", LayoutDashboard],
      ["/trading/strategies", "策略库", BookOpen],
      ["/trading/plans", "交易计划", ClipboardList],
      ["/trading/trades", "交易日志", NotebookPen],
      ["/trading/positions", "当前持仓", Activity],
      ["/trading/backtest", "手动回测", Rewind],
      ["/trading/reviews", "交易复盘", CheckSquare],
      ["/trading/analytics", "绩效分析", ChartNoAxesCombined],
    ],
  },
  {
    title: "财务自由",
    links: [
      ["/fire", "财务自由目标", Target],
      ["/fire/forecast", "财富预测", TrendingUp],
    ],
  },
  { title: "系统", links: [["/settings", "设置与数据管理", Settings]] },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    { light, open, setOpen } = useShell(),
    sidebar = useRef<HTMLElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    content = useRef<HTMLElement>(null),
    returnFocus = useRef<"menu" | "content">("menu"),
    previousPath = useRef(pathname),
    activePath =
      pathname === "/wealth/accounts" ? "/wealth/platforms" : pathname,
    currentGroup = groups.find((group) =>
      group.links.some(([href]) => href === activePath),
    ),
    currentPage = currentGroup?.links.find(
      ([href]) => href === activePath,
    )?.[1];

  function closeNavigation(target: "menu" | "content" = "menu") {
    returnFocus.current = target;
    setOpen(false);
  }

  function toggleTheme() {
    const nextLight = !light;
    useShell.setState({ light: nextLight });
    document.documentElement.dataset.theme = nextLight ? "light" : "dark";
    try {
      localStorage.setItem("tradeos-theme", nextLight ? "light" : "dark");
    } catch {
      // Theme switching remains available when browser storage is restricted.
    }
  }

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("tradeos-theme");
    } catch {
      // Use the default dark theme when browser storage is restricted.
    }
    useShell.setState({ light: saved === "light" });
    document.documentElement.dataset.theme =
      saved === "light" ? "light" : "dark";
  }, []);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 720px)");
    const onViewportChange = () => {
      if (!mobile.matches) {
        returnFocus.current = "content";
        useShell.setState({ open: false });
      }
    };
    mobile.addEventListener("change", onViewportChange);
    return () => mobile.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      returnFocus.current = "content";
      useShell.setState({ open: false });
    }
  }, [pathname]);

  useEffect(() => {
    if (!open || !sidebar.current) return;
    const navigation = sidebar.current,
      contentTarget = content.current,
      menuTarget = menuButton.current,
      previousOverflow = document.body.style.overflow,
      focusable = () =>
        Array.from(
          navigation.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
    document.body.style.overflow = "hidden";
    (
      navigation.querySelector<HTMLElement>('[aria-current="page"]') ??
      focusable()[0]
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        returnFocus.current = "menu";
        useShell.setState({ open: false });
      }
      if (event.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!navigation.contains(event.target as Node)) focusable()[0]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
      (returnFocus.current === "content" ? contentTarget : menuTarget)?.focus({
        preventScroll: true,
      });
    };
  }, [open]);

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        inert={open || undefined}
        onClick={() => content.current?.focus()}
      >
        跳至主要内容
      </a>
      {open && (
        <button
          type="button"
          className="navigation-backdrop"
          tabIndex={-1}
          aria-label="关闭导航遮罩"
          onClick={() => closeNavigation()}
        />
      )}
      <aside
        ref={sidebar}
        id="app-navigation"
        className={open ? "sidebar open" : "sidebar"}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label="应用导航"
      >
        <div className="sidebar-heading">
          <Link
            href="/wealth"
            className="brand"
            onClick={() => closeNavigation("content")}
          >
            <span className="brand-mark">T</span>TradeOS
            <span className="local-dot" title="本地运行" />
          </Link>
          <Button
            type="button"
            variant="ghost"
            className="sidebar-close"
            aria-label="关闭导航"
            onClick={() => closeNavigation()}
          >
            <X size={19} aria-hidden="true" />
          </Button>
        </div>
        <div className="workspace">个人财富与交易管理</div>
        <nav aria-label="主导航">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.links.map(([href, label, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  className={
                    activePath === href ? "nav-link active" : "nav-link"
                  }
                  aria-current={activePath === href ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    )
                      closeNavigation("content");
                  }}
                >
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>数据保存在此设备</span>
          <span className="mono">LOCAL · v1.0</span>
        </div>
      </aside>
      <div className="main" inert={open || undefined}>
        <header className="topbar">
          <Button
            ref={menuButton}
            type="button"
            variant="ghost"
            onClick={() => setOpen(!open)}
            className="mobile-menu"
            aria-label={open ? "关闭导航" : "展开导航"}
            aria-expanded={open}
            aria-controls="app-navigation"
          >
            <Menu size={19} aria-hidden="true" />
          </Button>
          <nav className="breadcrumbs" aria-label="当前位置">
            <span className="breadcrumb-group">
              {currentGroup?.title ?? "TradeOS"}
            </span>
            <span className="breadcrumb-separator" aria-hidden="true">
              /
            </span>
            <span className="breadcrumb-current" aria-current="page">
              {currentPage ?? "工作台"}
            </span>
          </nav>
          <div className="top-actions">
            <span className="local-label">
              <span className="local-dot" />
              本地连接
            </span>
            <Button
              type="button"
              variant="ghost"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="切换主题"
              title={light ? "切换为深色主题" : "切换为浅色主题"}
            >
              {light ? (
                <Moon size={18} aria-hidden="true" />
              ) : (
                <Sun size={18} aria-hidden="true" />
              )}
            </Button>
          </div>
        </header>
        <main id="main-content" ref={content} tabIndex={-1}>
          {children}
        </main>
        <footer className="main-footer">
          TradeOS · 个人财富操作系统
          <span>估值与预测以录入数据和假设为依据</span>
        </footer>
      </div>
    </div>
  );
}
