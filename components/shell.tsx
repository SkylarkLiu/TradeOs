"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { create } from "zustand";
import { useEffect } from "react";
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
} from "lucide-react";
import { Button } from "./ui/button";
const useShell = create<{
  light: boolean;
  open: boolean;
  toggle: () => void;
  menu: () => void;
}>((set) => ({
  light: false,
  open: false,
  toggle: () => set((s) => ({ light: !s.light })),
  menu: () => set((s) => ({ open: !s.open })),
}));
const groups = [
  {
    title: "Wealth Center",
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
    title: "Trading Center",
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
    title: "FIRE Center",
    links: [
      ["/fire", "财务自由目标", Target],
      ["/fire/forecast", "财富预测", TrendingUp],
    ],
  },
  { title: "系统", links: [["/settings", "设置与数据管理", Settings]] },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(),
    { light, open, toggle, menu } = useShell();
  useEffect(() => {
    const saved = localStorage.getItem("tradeos-theme");
    if (saved === "light") useShell.setState({ light: true });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("tradeos-theme", light ? "light" : "dark");
  }, [light]);
  return (
    <div className="app-shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Link href="/wealth" className="brand">
          <span className="brand-mark">T</span>TradeOS
          <span className="local-dot" title="本地运行" />
        </Link>
        <div className="workspace">个人财富与交易管理</div>
        <nav aria-label="主导航">
          {groups.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.links.map(([href, label, Icon]) => {
                const I = Icon as typeof Wallet;
                return (
                  <Link
                    key={href as string}
                    href={href as string}
                    className={
                      pathname === href ? "nav-link active" : "nav-link"
                    }
                    onClick={() => useShell.setState({ open: false })}
                  >
                    <I size={17} />
                    {label as string}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>数据保存在此设备</span>
          <span className="mono">LOCAL · v1.0</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            onClick={menu}
            className="mobile-menu"
            aria-label="展开导航"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </Button>
          <div className="breadcrumbs">
            TradeOS <span>/</span> 工作台
          </div>
          <div className="top-actions">
            <span className="local-label">
              <span className="local-dot" />
              本地连接
            </span>
            <Button variant="ghost" onClick={toggle} aria-label="切换主题">
              {light ? <Moon size={17} /> : <Sun size={17} />}
            </Button>
          </div>
        </header>
        <main>{children}</main>
        <footer className="main-footer">
          TradeOS · 个人财富操作系统
          <span>估值与预测以录入数据和假设为依据</span>
        </footer>
      </div>
    </div>
  );
}
